use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::io::Write;
use tauri::{AppHandle, Manager, Runtime, State};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecentKind {
    File,
    Folder,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecentEntry {
    pub kind: RecentKind,
    pub path: String,
}

pub const RECENTS_CAP: usize = 10;

/// In-memory recents, most-recent-first. Loaded from disk at startup.
#[derive(Default)]
pub struct RecentsState(pub Mutex<Vec<RecentEntry>>);

/// Read a recents list from an exact file path. Missing/corrupt → empty.
fn read_list(path: &Path) -> Vec<RecentEntry> {
    match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// Atomically write a recents list to an exact file path (temp + rename,
/// the fs.rs/assets.rs pattern). Creates the parent dir if needed.
fn write_list(path: &Path, list: &[RecentEntry]) -> Result<(), String> {
    let dir = path.parent().ok_or("recents path has no parent")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    tmp.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    tmp.as_file().sync_all().map_err(|e| e.to_string())?;
    tmp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

fn recents_file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("recents.json"))
}

/// Load the persisted recents (called once at startup). Missing/corrupt → empty.
pub fn load<R: Runtime>(app: &AppHandle<R>) -> Vec<RecentEntry> {
    match recents_file(app) {
        Ok(p) => read_list(&p),
        Err(_) => Vec::new(),
    }
}

fn save<R: Runtime>(app: &AppHandle<R>, list: &[RecentEntry]) -> Result<(), String> {
    let path = recents_file(app)?;
    write_list(&path, list)
}

/// Current list (clone).
pub fn get(state: &RecentsState) -> Vec<RecentEntry> {
    state.0.lock().map(|l| l.clone()).unwrap_or_default()
}

/// Empty the list + persist; returns the new (empty) list.
pub fn clear<R: Runtime>(app: &AppHandle<R>, state: &RecentsState) -> Result<Vec<RecentEntry>, String> {
    {
        let mut l = state.0.lock().map_err(|_| "recents lock poisoned")?;
        l.clear();
        save(app, &l)?;
    }
    Ok(Vec::new())
}

/// Drop one entry + persist; returns the new list (used by prune-missing).
pub fn remove<R: Runtime>(app: &AppHandle<R>, state: &RecentsState, entry: &RecentEntry) -> Result<Vec<RecentEntry>, String> {
    let updated = {
        let mut l = state.0.lock().map_err(|_| "recents lock poisoned")?;
        l.retain(|e| e != entry);
        save(app, &l)?;
        l.clone()
    };
    Ok(updated)
}

/// Frontend calls this whenever a file/folder is successfully opened. Pushes to
/// the top, persists, and rebuilds the native menu so all windows see it.
#[tauri::command]
pub fn record_recent<R: Runtime>(
    app: AppHandle<R>,
    state: State<RecentsState>,
    entry: RecentEntry,
) -> Result<(), String> {
    {
        let mut l = state.0.lock().map_err(|_| "recents lock poisoned")?;
        *l = push_recent(l.clone(), entry, RECENTS_CAP);
        save(&app, &l)?;
    }
    crate::menu::rebuild(&app);
    Ok(())
}

/// Insert `entry` at the front of the recents list: drop any existing
/// (kind, path) duplicate (move-to-top), then cap the length.
pub fn push_recent(mut list: Vec<RecentEntry>, entry: RecentEntry, cap: usize) -> Vec<RecentEntry> {
    list.retain(|e| e != &entry);
    list.insert(0, entry);
    list.truncate(cap);
    list
}

#[cfg(test)]
mod push_tests {
    use super::*;

    fn file(p: &str) -> RecentEntry { RecentEntry { kind: RecentKind::File, path: p.into() } }
    fn folder(p: &str) -> RecentEntry { RecentEntry { kind: RecentKind::Folder, path: p.into() } }

    #[test]
    fn prepends_most_recent_first() {
        let l = push_recent(vec![file("a")], file("b"), 10);
        assert_eq!(l, vec![file("b"), file("a")]);
    }

    #[test]
    fn dedups_and_moves_to_top() {
        let l = push_recent(vec![file("a"), file("b"), file("c")], file("c"), 10);
        assert_eq!(l, vec![file("c"), file("a"), file("b")]);
    }

    #[test]
    fn file_and_folder_same_path_are_distinct() {
        let l = push_recent(vec![file("x")], folder("x"), 10);
        assert_eq!(l, vec![folder("x"), file("x")]);
    }

    #[test]
    fn caps_length() {
        let start: Vec<RecentEntry> = (0..10).map(|i| file(&i.to_string())).collect();
        let l = push_recent(start, file("new"), 10);
        assert_eq!(l.len(), 10);
        assert_eq!(l[0], file("new"));
        assert_eq!(l.last().unwrap(), &file("8")); // "9" fell off
    }
}

#[cfg(test)]
mod store_tests {
    use super::*;

    #[test]
    fn entry_json_shape_matches_ts() {
        let e = RecentEntry { kind: RecentKind::Folder, path: "/x/proj".into() };
        assert_eq!(serde_json::to_string(&e).unwrap(), r#"{"kind":"folder","path":"/x/proj"}"#);
    }

    #[test]
    fn save_then_load_roundtrips_via_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("recents.json");
        let list = vec![
            RecentEntry { kind: RecentKind::File, path: "/a.md".into() },
            RecentEntry { kind: RecentKind::Folder, path: "/proj".into() },
        ];
        write_list(&path, &list).unwrap();
        assert_eq!(read_list(&path), list);
    }

    #[test]
    fn read_missing_or_corrupt_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_list(&dir.path().join("nope.json")), Vec::<RecentEntry>::new());
        let bad = dir.path().join("bad.json");
        std::fs::write(&bad, b"not json{{").unwrap();
        assert_eq!(read_list(&bad), Vec::<RecentEntry>::new());
    }
}
