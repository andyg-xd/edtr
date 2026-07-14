use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use tauri::{AppHandle, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri::Emitter;

/// What a freshly-opened window should load. Matches the TS `OpenPayload`
/// discriminated union: {kind:'files',paths} | {kind:'folder',path}.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum OpenPayload {
    Files { paths: Vec<String> },
    Folder { path: String },
}

/// Document extensions Edtr auto-opens (mirror of the TS `DOCUMENT_EXTS`, D5).
const DOCUMENT_EXTS: [&str; 4] = ["md", "markdown", "html", "htm"];

/// True if `path`'s extension is an auto-open document type (case-insensitive).
pub fn is_document(path: &str) -> bool {
    match path.rsplit_once('.') {
        Some((_, ext)) => DOCUMENT_EXTS.contains(&ext.to_lowercase().as_str()),
        None => false,
    }
}

/// Turn OS-open paths into a payload: a single existing directory → Folder;
/// otherwise the document files → Files; nothing openable → None.
pub fn assemble_open_payload(paths: Vec<String>) -> Option<OpenPayload> {
    if let [only] = paths.as_slice() {
        if std::path::Path::new(only).is_dir() {
            return Some(OpenPayload::Folder { path: only.clone() });
        }
    }
    let docs: Vec<String> = paths.into_iter().filter(|p| is_document(p)).collect();
    if docs.is_empty() { None } else { Some(OpenPayload::Files { paths: docs }) }
}

/// Set true once a window's frontend has registered its listeners, so an
/// `Opened` event can push to it instead of stashing for a cold claim.
#[derive(Default)]
pub struct ReadyState(pub Mutex<bool>);

/// A cold-launch payload waiting for the first window to claim it on mount.
#[derive(Default)]
pub struct LaunchOpen(pub Mutex<Option<OpenPayload>>);

/// Payloads waiting for their not-yet-mounted window to claim them, keyed by
/// window label. A new window pops its payload once on mount.
#[derive(Default)]
pub struct PendingOpen(pub Mutex<HashMap<String, OpenPayload>>);

/// Monotonic counter for minting unique window labels.
#[derive(Default)]
pub struct WindowCounter(pub Mutex<u32>);

/// Spawn a new editor window that will load `payload` on mount.
#[tauri::command]
pub fn open_in_new_window(
    app: AppHandle,
    payload: OpenPayload,
    pending: State<PendingOpen>,
    counter: State<WindowCounter>,
) -> Result<(), String> {
    let label = {
        let mut c = counter.0.lock().map_err(|_| "counter lock poisoned")?;
        *c += 1;
        format!("editor-{}", *c)
    };
    pending
        .0
        .lock()
        .map_err(|_| "pending lock poisoned")?
        .insert(label.clone(), payload);
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("Edtr")
        .inner_size(800.0, 600.0)
        .build()
        .map_err(|e| {
            // Don't leak a stranded payload if the window failed to build.
            let _ = pending.0.lock().map(|mut m| m.remove(&label));
            format!("Could not open window: {e}")
        })?;
    Ok(())
}

/// Pop (and remove) the calling window's pending payload, if any. The new
/// window's frontend calls this once on mount.
#[tauri::command]
pub fn take_pending_open(window: WebviewWindow, pending: State<PendingOpen>) -> Option<OpenPayload> {
    pending.0.lock().ok()?.remove(window.label())
}

/// The first window to mount claims a cold-launch payload, if any. Pops once
/// (server-side), so only one window wins.
#[tauri::command]
pub fn take_launch_open(launch: State<LaunchOpen>) -> Option<OpenPayload> {
    launch.0.lock().ok().and_then(|mut o| o.take())
}

/// The frontend calls this once its listeners are live; flips ReadyState so a
/// subsequent OS `Opened` pushes to a window rather than stashing it cold.
#[tauri::command]
pub fn mark_frontend_ready(
    ready: State<ReadyState>,
    launch: State<LaunchOpen>,
) -> Option<OpenPayload> {
    if let Ok(mut r) = ready.0.lock() {
        *r = true;
    }
    // A cold open stashed during setup would otherwise be stranded (the
    // window's on-mount claim already ran) — hand it back so the frontend can
    // route it through the normal open path.
    launch.0.lock().ok().and_then(|mut o| o.take())
}

/// A window's vote in a two-phase quit poll.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Vote {
    Ready,
    Cancel,
}

/// Result of recording a vote (or dropping a window) into the poll.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PollOutcome {
    Pending, // still waiting on votes
    Commit,  // every expected window voted Ready → exit the app
    Abort,   // a Cancel arrived (or the vote was stale) → restore everything
}

/// Managed registry for the atomic-⌘Q two-phase vote (5b-iii-b).
#[derive(Default)]
pub struct QuitPollState(pub Mutex<QuitPoll>);

/// `expected` = window labels snapshotted when ⌘Q started the poll; `votes`
/// accumulates their votes. Discard/clean both vote `Ready` WITHOUT closing —
/// nothing is destroyed until Commit, which is what makes Abort atomic.
#[derive(Default)]
pub struct QuitPoll {
    pub active: bool,
    pub expected: HashSet<String>,
    pub votes: HashMap<String, Vote>,
}

impl QuitPoll {
    /// Begin a poll over `labels`, discarding any prior poll.
    pub fn start(&mut self, labels: impl IntoIterator<Item = String>) {
        self.active = true;
        self.expected = labels.into_iter().collect();
        self.votes.clear();
    }

    /// Record a window's vote and return the resulting outcome.
    pub fn record(&mut self, label: &str, vote: Vote) -> PollOutcome {
        if !self.active {
            return PollOutcome::Abort; // stale vote (poll already resolved)
        }
        if vote == Vote::Cancel {
            self.reset();
            return PollOutcome::Abort;
        }
        self.votes.insert(label.to_string(), Vote::Ready);
        self.decide()
    }

    /// A window closed mid-poll: it can no longer vote, so drop it from the
    /// expected set and re-evaluate (prevents a stuck poll).
    pub fn drop_window(&mut self, label: &str) -> PollOutcome {
        if !self.active {
            return PollOutcome::Pending;
        }
        self.expected.remove(label);
        self.votes.remove(label);
        self.decide()
    }

    /// Commit once every still-expected window has voted Ready.
    fn decide(&mut self) -> PollOutcome {
        let all_ready = self
            .expected
            .iter()
            .all(|l| self.votes.get(l) == Some(&Vote::Ready));
        if all_ready {
            self.reset();
            PollOutcome::Commit
        } else {
            PollOutcome::Pending
        }
    }

    fn reset(&mut self) {
        self.active = false;
        self.expected.clear();
        self.votes.clear();
    }
}

/// A window's vote in the atomic-quit poll. `vote` is "ready" | "cancel"
/// (anything other than "cancel" is treated as ready). The window label is
/// taken from the caller, like `take_pending_open`. On Commit the app exits; on
/// Abort we broadcast `menu://quit-abort` so any open quit prompt dismisses.
#[tauri::command]
pub fn quit_vote(app: AppHandle, window: WebviewWindow, vote: String, poll: State<QuitPollState>) {
    let vote = if vote == "cancel" { Vote::Cancel } else { Vote::Ready };
    let outcome = match poll.0.lock() {
        Ok(mut p) => p.record(window.label(), vote),
        Err(_) => return,
    };
    match outcome {
        PollOutcome::Commit => app.exit(0),
        PollOutcome::Abort => {
            let _ = app.emit("menu://quit-abort", ());
        }
        PollOutcome::Pending => {}
    }
}

#[cfg(test)]
mod quit_poll_tests {
    use super::*;

    #[test]
    fn all_expected_ready_commits() {
        let mut p = QuitPoll::default();
        p.start(["a".to_string(), "b".to_string()]);
        assert_eq!(p.record("a", Vote::Ready), PollOutcome::Pending);
        assert_eq!(p.record("b", Vote::Ready), PollOutcome::Commit);
        assert!(!p.active, "poll resets after commit");
    }

    #[test]
    fn single_window_ready_commits_immediately() {
        let mut p = QuitPoll::default();
        p.start(["only".to_string()]);
        assert_eq!(p.record("only", Vote::Ready), PollOutcome::Commit);
    }

    #[test]
    fn any_cancel_aborts_and_clears() {
        let mut p = QuitPoll::default();
        p.start(["a".to_string(), "b".to_string()]);
        assert_eq!(p.record("a", Vote::Ready), PollOutcome::Pending);
        assert_eq!(p.record("b", Vote::Cancel), PollOutcome::Abort);
        assert!(!p.active);
        assert!(p.votes.is_empty());
    }

    #[test]
    fn vote_without_active_poll_is_stale_abort() {
        let mut p = QuitPoll::default();
        assert_eq!(p.record("a", Vote::Ready), PollOutcome::Abort);
    }

    #[test]
    fn dropping_last_unvoted_window_commits() {
        let mut p = QuitPoll::default();
        p.start(["a".to_string(), "b".to_string()]);
        assert_eq!(p.record("a", Vote::Ready), PollOutcome::Pending);
        // b closes before voting → drop it → only a remains and it's ready
        assert_eq!(p.drop_window("b"), PollOutcome::Commit);
    }

    #[test]
    fn drop_without_active_poll_is_pending_noop() {
        let mut p = QuitPoll::default();
        assert_eq!(p.drop_window("a"), PollOutcome::Pending);
    }

    #[test]
    fn restart_replaces_prior_poll() {
        let mut p = QuitPoll::default();
        p.start(["a".to_string(), "b".to_string()]);
        assert_eq!(p.record("a", Vote::Ready), PollOutcome::Pending);
        p.start(["c".to_string()]); // ⌘Q again after windows changed
        assert!(p.votes.is_empty());
        assert_eq!(p.record("c", Vote::Ready), PollOutcome::Commit);
    }
}

#[cfg(test)]
mod open_payload_tests {
    use super::*;

    #[test]
    fn is_document_matches_d4_set_case_insensitive() {
        assert!(is_document("/a/notes.md"));
        assert!(is_document("R.MARKDOWN"));
        assert!(is_document("/x/p.HtmL"));
        assert!(is_document("x.htm"));
        assert!(!is_document("/a/log.txt")); // txt is NOT auto-open (D4/D5)
        assert!(!is_document("/a/pic.png"));
        assert!(!is_document("/a/noext"));
    }

    #[test]
    fn assemble_filters_non_documents_into_files() {
        let p = assemble_open_payload(vec![
            "/a/one.md".into(), "/a/pic.png".into(), "/a/two.html".into(),
        ]);
        assert_eq!(p, Some(OpenPayload::Files { paths: vec!["/a/one.md".into(), "/a/two.html".into()] }));
    }

    #[test]
    fn assemble_none_when_no_documents() {
        assert_eq!(assemble_open_payload(vec!["/a/pic.png".into(), "/a/x.zip".into()]), None);
        assert_eq!(assemble_open_payload(vec![]), None);
    }
}
