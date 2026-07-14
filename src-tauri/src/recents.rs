use serde::{Deserialize, Serialize};

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
