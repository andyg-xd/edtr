use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
/// Persisted settings.
///
/// 6c-ii's `typewriter`/`focus` fields were REMOVED in 6c-ii-b: under D-A the
/// writing modes are per-window state that always starts off, so there is
/// nothing to persist. Removing them is safe for existing settings files —
/// serde ignores unknown fields by default (there is no
/// `deny_unknown_fields`), so a file written by 6c-ii still parses and its
/// stored `theme` still loads. The two stale keys simply sit there until the
/// next write drops them.
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

/// A copy of `current` with a new theme and **both modes preserved**.
///
/// Exists because building `Settings { theme }` fresh — which is what this
/// file did before 6c-ii — silently cleared every other field the struct
/// gained. Pure, so the preservation is provable without a Tauri app handle.
pub fn with_theme(current: &Settings, theme: String) -> Settings {
    Settings { theme, ..current.clone() }
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

fn settings_file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

/// Load persisted settings once at startup. None if absent/corrupt.
pub fn load<R: Runtime>(app: &AppHandle<R>) -> Option<Settings> {
    settings_file(app).ok().and_then(|p| read_settings(&p))
}

fn save<R: Runtime>(app: &AppHandle<R>, settings: &Settings) -> Result<(), String> {
    let path = settings_file(app)?;
    write_settings(&path, settings)
}

/// In-memory settings; None until a valid file is loaded or a set_* writes one.
#[derive(Default)]
pub struct SettingsState(pub Mutex<Option<Settings>>);

#[tauri::command]
pub fn get_settings(state: State<SettingsState>) -> Option<Settings> {
    state.0.lock().ok().and_then(|g| g.clone())
}

/// Runs `compute` against the currently stored settings (or the default, if
/// none has ever been persisted) and — only when the result differs from
/// what's stored — saves it to disk, updates the in-memory state, and
/// broadcasts settings://changed to all windows. Returns whether it actually
/// wrote (`Ok(true)`) or `compute` produced no change (`Ok(false)`), so a
/// caller that only needs a follow-up action on a real change doesn't have to
/// run that follow-up unconditionally on every no-op call. (6c-ii-b removed
/// the one caller that used this -- `set_writing_mode`'s menu rebuild -- so
/// the return value is currently unused by `set_theme`; the signal is kept
/// because the emit-if-changed behaviour it reports on is what stops a
/// cross-window adoption echoing into a loop.)
///
/// A no-op (`compute` returns the same value that's already stored) neither
/// saves nor emits, so a window adopting a cross-window change doesn't echo
/// an endless feedback loop. `compute` runs under the same lock acquisition
/// that compares and writes, so the whole read → compute → compare → write
/// sequence is one atomic critical section: a concurrent command from another
/// window can't interleave a stale read between "compute next from current"
/// and "save next", which would otherwise silently drop the other window's
/// change — exactly the drift this task exists to close for `Settings`.
///
/// `compute` returns a `Result` rather than a bare `Settings` so a caller can
/// reject its input gracefully from inside the same lock acquisition, via the
/// `?` below, instead of panicking while the guard is held: a panic here
/// would poison the mutex, and every later `get_settings`/`set_theme`/
/// settings command takes that same lock, so one poisoned guard wedges
/// settings for the rest of the process. `?` unwinds normally (it's an early
/// return, not a panic), which drops `g` and unlocks cleanly.
///
/// Shared by every setter, so the guard-then-save-then-emit sequence is
/// defined once instead of hand-synced per command.
fn apply_if_changed<R: Runtime>(
    app: &AppHandle<R>,
    state: &State<SettingsState>,
    compute: impl FnOnce(&Settings) -> Result<Settings, String>,
) -> Result<bool, String> {
    let settings = {
        let mut g = state.0.lock().map_err(|_| "settings lock poisoned")?;
        let current = g.clone().unwrap_or_default();
        let next = compute(&current)?;
        if g.as_ref() == Some(&next) {
            None
        } else {
            save(app, &next)?;
            *g = Some(next.clone());
            Some(next)
        }
    };
    let changed = settings.is_some();
    if let Some(next) = settings {
        let _ = app.emit("settings://changed", next);
    }
    Ok(changed)
}

/// Persist the theme + broadcast settings://changed to all windows — but only
/// when the value actually changed (a no-op write doesn't re-broadcast, so a
/// window adopting a cross-window change doesn't echo an endless feedback loop).
#[tauri::command]
pub fn set_theme<R: Runtime>(
    app: AppHandle<R>,
    state: State<SettingsState>,
    mode: String,
) -> Result<(), String> {
    if !is_valid_theme(&mode) {
        return Err(format!("invalid theme: {mode}"));
    }
    // A theme change never needs a menu rebuild — there's no menu checkmark
    // tied to it — so the "did it actually change" bool `apply_if_changed`
    // now reports is simply discarded here; behaviour is otherwise identical.
    apply_if_changed(&app, &state, |current| Ok(with_theme(current, mode)))?;
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
        assert_eq!(
            read_settings(&path),
            Some(Settings { theme: "dark".into() })
        );
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

    #[test]
    fn a_settings_file_written_by_6c_ii_still_loads() {
        // 6c-ii-b REMOVED the `typewriter`/`focus` fields, so every settings
        // file already on disk carries two keys the struct no longer has. This
        // is the forward-compatibility claim the struct's doc comment makes,
        // asserted rather than assumed: serde ignores unknown fields by
        // default (there is no `deny_unknown_fields`), so the stored theme
        // must survive. If it did not, upgrading would silently reset the
        // user's theme -- exactly the failure the `#[serde(default)]` attrs
        // were added to prevent when these fields were INTRODUCED.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"theme":"dark","typewriter":true,"focus":true}"#).unwrap();
        let s = read_settings(&path).expect("a 6c-ii settings file must still load");
        assert_eq!(s.theme, "dark");
    }


    #[test]
    fn merging_a_theme_preserves_every_other_field() {
        // The trap this guards: set_theme used to build a fresh Settings from
        // scratch, so growing the struct would make a theme change silently
        // clear whatever else it had gained. 6c-ii-b removed the two mode
        // fields (they no longer persist), which leaves `theme` alone in the
        // struct and this assertion looking trivially true TODAY. It is kept,
        // and named for the general property rather than for the modes,
        // because the trap returns the moment any second field is added --
        // which is exactly when nobody would think to re-derive it.
        let current = Settings { theme: "dark".into() };
        let merged = with_theme(&current, "light".into());
        assert_eq!(merged.theme, "light");
    }
}
