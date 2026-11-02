//! Which window has each document open, so a file is never open in two
//! windows at once (safety packet B2).
//!
//! Two windows on one file was a real data-loss route: each kept its own
//! buffer, and the later save silently replaced the earlier one. Every open
//! gesture is routed through here first; a file some window already has is
//! shown in that window instead of being opened again.
//!
//! Entries are fed by the frontend's own reconciliation of its open documents
//! (`register_open_path` / `release_open_path`), deliberately NOT by the file
//! watcher's commands: those need the watcher's state, which does not exist
//! when the watcher failed to start, and the registry must not depend on it.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::window::OpenPayload;

/// One open document: the path as its window spelled it, and that window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub path: String,
    pub label: String,
}

#[derive(Default)]
pub struct OpenRegistry(pub Mutex<Vec<Entry>>);

/// Do two paths name the same file on disk?
///
/// Decided live, by device and inode, so a symlink or a different letter case
/// on a case-insensitive volume still matches. Not by an inode stored at
/// registration: Edtr's own atomic save replaces the file, and its inode with
/// it. A path that cannot be read (deleted, say) falls back to its spelling.
pub fn same_file(a: &str, b: &str) -> bool {
    use std::os::unix::fs::MetadataExt;
    match (std::fs::metadata(a), std::fs::metadata(b)) {
        (Ok(x), Ok(y)) => x.dev() == y.dev() && x.ino() == y.ino(),
        _ => a == b,
    }
}

/// The open document `path` refers to, among windows `live` says still exist.
pub fn owner_of<'a>(
    entries: &'a [Entry],
    path: &str,
    same: impl Fn(&str, &str) -> bool,
    live: impl Fn(&str) -> bool,
) -> Option<&'a Entry> {
    entries.iter().find(|e| live(&e.label) && same(&e.path, path))
}

pub fn register(entries: &mut Vec<Entry>, path: &str, label: &str) {
    if !entries.iter().any(|e| e.path == path && e.label == label) {
        entries.push(Entry { path: path.into(), label: label.into() });
    }
}

/// A window releases the same spelling it registered, so this matches exactly.
pub fn release(entries: &mut Vec<Entry>, path: &str, label: &str) {
    entries.retain(|e| !(e.path == path && e.label == label));
}

pub fn release_window(entries: &mut Vec<Entry>, label: &str) {
    entries.retain(|e| e.label != label);
}

/// Paths already open somewhere (to be shown there), and the rest (to open).
#[derive(Debug, PartialEq, Eq)]
pub struct Split {
    pub show: Vec<Entry>,
    pub rest: Vec<String>,
}

pub fn split_owned(
    entries: &[Entry],
    paths: &[String],
    same: impl Fn(&str, &str) -> bool,
    live: impl Fn(&str) -> bool,
) -> Split {
    let mut split = Split { show: Vec::new(), rest: Vec::new() };
    for p in paths {
        match owner_of(entries, p, &same, &live) {
            Some(owner) => split.show.push(owner.clone()),
            None => split.rest.push(p.clone()),
        }
    }
    split
}

#[derive(Clone, serde::Serialize)]
struct ShowPayload {
    path: String,
}

/// Bring every window that already has one of `payload`'s files to the front
/// and have it show that file; return what is left to open, if anything.
/// Folder payloads pass through: a folder window opens nothing until a file in
/// it is clicked, and that click is routed on its own.
pub fn route_open(app: &AppHandle, payload: OpenPayload) -> Option<OpenPayload> {
    let OpenPayload::Files { paths } = payload else {
        return Some(payload);
    };
    let registry = app.state::<OpenRegistry>();
    let split = {
        let Ok(entries) = registry.0.lock() else {
            return Some(OpenPayload::Files { paths });
        };
        split_owned(&entries, &paths, same_file, |l| app.get_webview_window(l).is_some())
    };
    for e in split.show {
        if let Some(w) = app.get_webview_window(&e.label) {
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
        // The owner's own spelling, so it can find the document by plain
        // comparison. The owner only selects; it never routes again.
        let _ = app.emit_to(e.label.as_str(), "open://show", ShowPayload { path: e.path });
    }
    if split.rest.is_empty() { None } else { Some(OpenPayload::Files { paths: split.rest }) }
}

/// For a window about to open files into itself (an empty window, or a folder
/// window's sidebar): what is left after routing to windows that have them.
#[tauri::command]
pub fn route_open_payload(app: AppHandle, payload: OpenPayload) -> Option<OpenPayload> {
    route_open(&app, payload)
}

#[tauri::command]
pub fn register_open_path(window: WebviewWindow, path: String, registry: State<OpenRegistry>) {
    if let Ok(mut e) = registry.0.lock() {
        register(&mut e, &path, window.label());
    }
}

#[tauri::command]
pub fn release_open_path(window: WebviewWindow, path: String, registry: State<OpenRegistry>) {
    if let Ok(mut e) = registry.0.lock() {
        release(&mut e, &path, window.label());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str, label: &str) -> Entry {
        Entry { path: path.into(), label: label.into() }
    }
    fn exact(a: &str, b: &str) -> bool {
        a == b
    }
    fn all_live(_: &str) -> bool {
        true
    }

    #[test]
    fn a_registered_file_has_an_owner_and_an_unknown_one_does_not() {
        let mut e = Vec::new();
        register(&mut e, "/d/a.md", "editor-1");
        assert_eq!(owner_of(&e, "/d/a.md", exact, all_live), Some(&entry("/d/a.md", "editor-1")));
        assert_eq!(owner_of(&e, "/d/b.md", exact, all_live), None);
    }

    #[test]
    fn registering_twice_keeps_one_entry() {
        let mut e = Vec::new();
        register(&mut e, "/d/a.md", "editor-1");
        register(&mut e, "/d/a.md", "editor-1");
        assert_eq!(e.len(), 1);
    }

    #[test]
    fn releasing_frees_the_file_but_only_for_that_window() {
        let mut e = vec![entry("/d/a.md", "editor-1"), entry("/d/b.md", "editor-2")];
        release(&mut e, "/d/a.md", "editor-2");
        assert_eq!(e.len(), 2, "another window cannot release editor-1's document");
        release(&mut e, "/d/a.md", "editor-1");
        assert_eq!(e, vec![entry("/d/b.md", "editor-2")]);
    }

    #[test]
    fn a_closed_window_releases_everything_it_had() {
        let mut e = vec![entry("/d/a.md", "editor-1"), entry("/d/b.md", "editor-2"), entry("/d/c.md", "editor-1")];
        release_window(&mut e, "editor-1");
        assert_eq!(e, vec![entry("/d/b.md", "editor-2")]);
    }

    #[test]
    fn a_window_that_no_longer_exists_owns_nothing() {
        let e = vec![entry("/d/a.md", "editor-1")];
        assert_eq!(owner_of(&e, "/d/a.md", exact, |l| l != "editor-1"), None);
    }

    #[test]
    fn sameness_is_asked_of_the_file_system_not_the_spelling() {
        let e = vec![entry("/d/a.md", "editor-1")];
        let same = |a: &str, b: &str| a.to_lowercase() == b.to_lowercase();
        assert_eq!(owner_of(&e, "/D/A.md", same, all_live).map(|o| o.label.as_str()), Some("editor-1"));
    }

    #[test]
    fn a_payload_splits_into_files_to_show_and_files_to_open() {
        let e = vec![entry("/d/a.md", "editor-1"), entry("/d/c.md", "editor-2")];
        let paths = vec!["/d/a.md".to_string(), "/d/b.md".to_string(), "/d/c.md".to_string()];
        assert_eq!(
            split_owned(&e, &paths, exact, all_live),
            Split {
                show: vec![entry("/d/a.md", "editor-1"), entry("/d/c.md", "editor-2")],
                rest: vec!["/d/b.md".to_string()],
            }
        );
    }

    #[test]
    fn the_owner_is_shown_its_own_spelling() {
        let e = vec![entry("/d/a.md", "editor-1")];
        let same = |a: &str, b: &str| a.to_lowercase() == b.to_lowercase();
        let split = split_owned(&e, &["/D/A.md".to_string()], same, all_live);
        assert_eq!(split.show, vec![entry("/d/a.md", "editor-1")]);
        assert!(split.rest.is_empty());
    }

    #[test]
    fn same_file_sees_through_a_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("notes.md");
        std::fs::write(&real, "x").unwrap();
        let link = dir.path().join("link.md");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert!(same_file(real.to_str().unwrap(), link.to_str().unwrap()));
    }

    #[test]
    fn same_file_tells_two_files_apart() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.md");
        let b = dir.path().join("b.md");
        std::fs::write(&a, "x").unwrap();
        std::fs::write(&b, "x").unwrap();
        assert!(!same_file(a.to_str().unwrap(), b.to_str().unwrap()));
    }

    #[test]
    fn same_file_matches_another_letter_case_where_the_volume_ignores_case() {
        let dir = tempfile::tempdir().unwrap();
        let lower = dir.path().join("notes.md");
        std::fs::write(&lower, "x").unwrap();
        let upper = dir.path().join("NOTES.md");
        // On a case-sensitive volume NOTES.md is simply another (absent) file,
        // and the two must not match; macOS's default volume ignores case.
        let expected = upper.exists();
        assert_eq!(same_file(lower.to_str().unwrap(), upper.to_str().unwrap()), expected);
    }

    #[test]
    fn same_file_survives_an_atomic_replace() {
        // Edtr saves by writing a temp file and renaming it over the original,
        // which gives the file a new inode. Both spellings must still agree.
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("notes.md");
        std::fs::write(&real, "old").unwrap();
        let link = dir.path().join("link.md");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let tmp = dir.path().join(".notes.md.tmp");
        std::fs::write(&tmp, "new").unwrap();
        std::fs::rename(&tmp, &real).unwrap();
        assert!(same_file(real.to_str().unwrap(), link.to_str().unwrap()));
    }

    #[test]
    fn a_missing_file_falls_back_to_its_spelling() {
        assert!(same_file("/nonexistent/edtr/a.md", "/nonexistent/edtr/a.md"));
        assert!(!same_file("/nonexistent/edtr/a.md", "/nonexistent/edtr/b.md"));
    }
}
