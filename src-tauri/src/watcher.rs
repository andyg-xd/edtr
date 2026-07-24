use std::collections::HashMap;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

#[derive(Debug, PartialEq, Eq)]
pub enum WatchAction {
    StartDir(PathBuf),
    StopDir(PathBuf),
    None,
}

fn dir_has_watched_file(counts: &HashMap<PathBuf, usize>, dir: &Path) -> bool {
    counts.keys().any(|p| p.parent() == Some(dir))
}

/// Register one open-instance of `path`. Returns StartDir(parent) iff this is
/// the first watched file in that directory (so the caller starts the OS watch).
pub fn record_watch(counts: &mut HashMap<PathBuf, usize>, path: &Path) -> WatchAction {
    let dir = path.parent().map(Path::to_path_buf);
    let start = dir.as_ref().map_or(false, |d| !dir_has_watched_file(counts, d));
    *counts.entry(path.to_path_buf()).or_insert(0) += 1;
    match dir {
        Some(d) if start => WatchAction::StartDir(d),
        _ => WatchAction::None,
    }
}

/// Deregister one open-instance of `path`. Returns StopDir(parent) iff no
/// watched file remains in that directory (so the caller stops the OS watch).
pub fn record_unwatch(counts: &mut HashMap<PathBuf, usize>, path: &Path) -> WatchAction {
    let key = path.to_path_buf();
    match counts.get_mut(&key) {
        Some(c) if *c > 1 => { *c -= 1; WatchAction::None }
        Some(_) => {
            counts.remove(&key);
            let dir = path.parent().map(Path::to_path_buf);
            let stop = dir.as_ref().map_or(false, |d| !dir_has_watched_file(counts, d));
            match dir {
                Some(d) if stop => WatchAction::StopDir(d),
                _ => WatchAction::None,
            }
        }
        None => WatchAction::None,
    }
}

pub struct WatcherState {
    watcher: Mutex<RecommendedWatcher>,
    counts: Arc<Mutex<HashMap<PathBuf, usize>>>,
}

#[derive(Clone, Serialize)]
struct ChangedPayload { path: String }

/// Collect the watched-file paths named by one notify event.
fn watched_paths_in(ev: &Event, counts: &Arc<Mutex<HashMap<PathBuf, usize>>>, out: &mut HashSet<PathBuf>) {
    if let Ok(c) = counts.lock() {
        for p in &ev.paths {
            if c.contains_key(p) {
                out.insert(p.clone());
            }
        }
    }
}

/// Coalesce a burst (~200ms) and emit one `fs://changed` per affected watched file.
fn debounce_loop<R: Runtime>(app: AppHandle<R>, rx: Receiver<notify::Result<Event>>, counts: Arc<Mutex<HashMap<PathBuf, usize>>>) {
    while let Ok(first) = rx.recv() {
        let mut paths: HashSet<PathBuf> = HashSet::new();
        if let Ok(ev) = first { watched_paths_in(&ev, &counts, &mut paths); }
        // drain the settle window
        loop {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(Ok(ev)) => watched_paths_in(&ev, &counts, &mut paths),
                Ok(Err(_)) => {}          // watcher error event — ignore
                Err(_) => break,          // timed out (settled) or channel closed
            }
        }
        for p in paths {
            let _ = app.emit("fs://changed", ChangedPayload { path: p.to_string_lossy().into_owned() });
        }
    }
}

pub fn init<R: Runtime>(app: &AppHandle<R>) -> notify::Result<WatcherState> {
    let (tx, rx) = channel::<notify::Result<Event>>();
    let watcher = RecommendedWatcher::new(tx, notify::Config::default())?;
    let counts: Arc<Mutex<HashMap<PathBuf, usize>>> = Arc::new(Mutex::new(HashMap::new()));
    let thread_counts = Arc::clone(&counts);
    let thread_app = app.clone();
    std::thread::spawn(move || debounce_loop(thread_app, rx, thread_counts));
    Ok(WatcherState { watcher: Mutex::new(watcher), counts })
}

#[tauri::command]
pub fn watch_path(path: String, state: State<WatcherState>) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let action = {
        let mut c = state.counts.lock().map_err(|_| "counts lock poisoned")?;
        record_watch(&mut c, &p)
    };
    if let WatchAction::StartDir(dir) = action {
        let res = state
            .watcher
            .lock()
            .map_err(|_| "watcher lock poisoned".to_string())
            .and_then(|mut w| w.watch(&dir, RecursiveMode::NonRecursive).map_err(|e| e.to_string()));
        if let Err(e) = res {
            // Roll back the count we just recorded, so this directory isn't left
            // phantom-watched and the next file opened here retries the watch.
            if let Ok(mut c) = state.counts.lock() {
                record_unwatch(&mut c, &p);
            }
            return Err(e);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn unwatch_path(path: String, state: State<WatcherState>) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let action = {
        let mut c = state.counts.lock().map_err(|_| "counts lock poisoned")?;
        record_unwatch(&mut c, &p)
    };
    if let WatchAction::StopDir(dir) = action {
        // Unwatch is best-effort: the dir may already be gone.
        let _ = state.watcher.lock().map_err(|_| "watcher lock poisoned")?.unwatch(&dir);
    }
    Ok(())
}

/// True if the file watcher initialized at startup. When false, external-change
/// detection is off for the whole session (setup logged the failure); the
/// frontend surfaces a one-time notice. Read-only; touches no state.
#[tauri::command]
pub fn watcher_available(app: AppHandle) -> bool {
    app.try_state::<WatcherState>().is_some()
}

#[cfg(test)]
mod refcount_tests {
    use super::*;

    fn pb(s: &str) -> PathBuf { PathBuf::from(s) }

    #[test]
    fn first_file_in_dir_starts_dir_watch() {
        let mut c = HashMap::new();
        assert_eq!(record_watch(&mut c, &pb("/d/a.md")), WatchAction::StartDir(pb("/d")));
        assert_eq!(c.get(&pb("/d/a.md")), Some(&1));
    }

    #[test]
    fn second_file_same_dir_no_new_watch() {
        let mut c = HashMap::new();
        record_watch(&mut c, &pb("/d/a.md"));
        assert_eq!(record_watch(&mut c, &pb("/d/b.md")), WatchAction::None);
    }

    #[test]
    fn same_file_twice_counts_two_no_new_watch() {
        let mut c = HashMap::new();
        record_watch(&mut c, &pb("/d/a.md"));
        assert_eq!(record_watch(&mut c, &pb("/d/a.md")), WatchAction::None); // 2nd window
        assert_eq!(c.get(&pb("/d/a.md")), Some(&2));
    }

    #[test]
    fn unwatch_last_file_stops_dir() {
        let mut c = HashMap::new();
        record_watch(&mut c, &pb("/d/a.md"));
        assert_eq!(record_unwatch(&mut c, &pb("/d/a.md")), WatchAction::StopDir(pb("/d")));
        assert!(!c.contains_key(&pb("/d/a.md")));
    }

    #[test]
    fn unwatch_one_instance_keeps_watch() {
        let mut c = HashMap::new();
        record_watch(&mut c, &pb("/d/a.md"));
        record_watch(&mut c, &pb("/d/a.md")); // count 2
        assert_eq!(record_unwatch(&mut c, &pb("/d/a.md")), WatchAction::None); // back to 1
        assert_eq!(c.get(&pb("/d/a.md")), Some(&1));
    }

    #[test]
    fn unwatch_one_of_two_files_keeps_dir() {
        let mut c = HashMap::new();
        record_watch(&mut c, &pb("/d/a.md"));
        record_watch(&mut c, &pb("/d/b.md"));
        assert_eq!(record_unwatch(&mut c, &pb("/d/a.md")), WatchAction::None); // b.md still in /d
    }

    #[test]
    fn unwatch_unknown_is_none() {
        let mut c = HashMap::new();
        assert_eq!(record_unwatch(&mut c, &pb("/d/x.md")), WatchAction::None);
    }
}
