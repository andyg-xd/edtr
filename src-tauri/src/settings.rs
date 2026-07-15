use serde::{Deserialize, Serialize};
use std::path::Path;
use std::io::Write;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    pub theme: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { theme: "system".to_string() }
    }
}

const VALID_THEMES: [&str; 3] = ["system", "light", "dark"];

pub fn is_valid_theme(mode: &str) -> bool {
    VALID_THEMES.contains(&mode)
}

/// Read settings from an exact file path. Missing / corrupt / invalid-theme → None
/// (the caller treats None as "no valid persisted settings" → seed from cache).
fn read_settings(path: &Path) -> Option<Settings> {
    let text = std::fs::read_to_string(path).ok()?;
    let s: Settings = serde_json::from_str(&text).ok()?;
    if is_valid_theme(&s.theme) { Some(s) } else { None }
}

/// Atomically write settings to an exact file path (temp + rename; recents.rs pattern).
fn write_settings(path: &Path, settings: &Settings) -> Result<(), String> {
    let dir = path.parent().ok_or("settings path has no parent")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    tmp.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    tmp.as_file().sync_all().map_err(|e| e.to_string())?;
    tmp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod store_tests {
    use super::*;

    #[test]
    fn default_theme_is_system() {
        assert_eq!(Settings::default().theme, "system");
    }

    #[test]
    fn valid_theme_check() {
        assert!(is_valid_theme("system"));
        assert!(is_valid_theme("light"));
        assert!(is_valid_theme("dark"));
        assert!(!is_valid_theme("blue"));
        assert!(!is_valid_theme(""));
    }

    #[test]
    fn parses_valid_settings() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"theme":"dark"}"#).unwrap();
        assert_eq!(read_settings(&path), Some(Settings { theme: "dark".into() }));
    }

    #[test]
    fn missing_file_is_none() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_settings(&dir.path().join("nope.json")), None);
    }

    #[test]
    fn corrupt_json_is_none() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.json");
        std::fs::write(&path, b"not json{{").unwrap();
        assert_eq!(read_settings(&path), None);
    }

    #[test]
    fn invalid_theme_value_is_none() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.json");
        std::fs::write(&path, r#"{"theme":"blue"}"#).unwrap();
        assert_eq!(read_settings(&path), None);
    }

    #[test]
    fn missing_theme_field_is_none() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.json");
        std::fs::write(&path, r#"{}"#).unwrap();
        assert_eq!(read_settings(&path), None);
    }

    #[test]
    fn write_then_read_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let s = Settings { theme: "light".into() };
        write_settings(&path, &s).unwrap();
        assert_eq!(read_settings(&path), Some(s));
    }
}
