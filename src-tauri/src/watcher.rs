use std::collections::HashMap;
use std::path::{Path, PathBuf};

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
