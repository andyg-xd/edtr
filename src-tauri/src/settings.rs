use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    pub theme: String,
    /// Typewriter mode (6c-ii, D5). `#[serde(default)]` so a settings file
    /// written before this phase — which has only `theme` — still parses.
    /// Without it, read_settings returns None and the stored theme is lost.
    #[serde(default)]
    pub typewriter: bool,
    /// Focus mode (6c-ii, D5). Same defaulting rationale as above.
    #[serde(default)]
    pub focus: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { theme: "system".to_string(), typewriter: false, focus: false }
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

/// A copy of `current` with one writing mode set and everything else
/// preserved. `None` when the mode name is unknown.
///
/// This match is the **single source of truth** for which mode names exist —
/// `is_valid_writing_mode` below is defined in terms of it rather than a
/// separately-maintained name list, so there is no second list that could
/// drift out of sync with this one (a real defect in an earlier draft of
/// this file: `is_valid_writing_mode` and this match were once two
/// independently hardcoded lists of "typewriter"/"focus").
pub fn with_mode(current: &Settings, mode: &str, on: bool) -> Option<Settings> {
    match mode {
        "typewriter" => Some(Settings { typewriter: on, ..current.clone() }),
        "focus" => Some(Settings { focus: on, ..current.clone() }),
        _ => None,
    }
}

/// Whether `mode` is a recognized writing-mode name. Delegates to
/// `with_mode` — using a throwaway `Settings::default()` as the base, since
/// only whether the match succeeds matters here — so this can never
/// disagree with what `with_mode` actually handles: there is exactly one
/// list of valid names (the match arms above), not two.
///
/// Defined in terms of `with_mode` so the two can never disagree — do not
/// reintroduce a separate list (e.g. a `VALID_MODES` const) here. An earlier
/// draft of this file had exactly that second list, hardcoded independently
/// of `with_mode`'s match arms, which is what this function exists to rule
/// out structurally rather than by convention.
pub fn is_valid_writing_mode(mode: &str) -> bool {
    with_mode(&Settings::default(), mode, false).is_some()
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
/// caller that only needs a follow-up action on a real change — `set_writing_mode`'s
/// menu rebuild, specifically — doesn't have to run that follow-up
/// unconditionally on every no-op call.
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
/// `set_writing_mode` call takes that same lock, so one poisoned guard wedges
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

/// Persist one writing mode + broadcast settings://changed to all windows,
/// only when the value actually changed (a no-op write must not re-broadcast,
/// or a window adopting a cross-window change echoes forever).
///
/// The whole write path for both modes lives here rather than in the frontend
/// (spec §6.3): the View menu and the chrome toggle both land on this command,
/// so the native checkmark cannot drift from the stored value, and a toggle
/// works even when no window holds focus.
///
/// Validated up front, mirroring `set_theme`: an unknown name is rejected
/// before the lock is even touched. `with_mode` is also given a chance to
/// reject the mode a second time, inside the closure passed to
/// `apply_if_changed` — belt-and-suspenders, not redundant busywork: if a
/// future mode name were ever added to one of `is_valid_writing_mode` /
/// `with_mode` and not the other (which the doc comment on `with_mode`
/// explains shouldn't be possible, since one is defined in terms of the
/// other), this still degrades to a graceful `Err` via `.ok_or_else` rather
/// than an `.expect()` panic while the mutex guard is held.
#[tauri::command]
pub fn set_writing_mode<R: Runtime>(
    app: AppHandle<R>,
    state: State<SettingsState>,
    mode: String,
    on: bool,
) -> Result<(), String> {
    if !is_valid_writing_mode(&mode) {
        return Err(format!("invalid writing mode: {mode}"));
    }
    let changed = apply_if_changed(&app, &state, |current| {
        with_mode(current, &mode, on).ok_or_else(|| format!("invalid writing mode: {mode}"))
    })?;
    // Keep the View menu's checkmarks in step with whichever affordance
    // flipped the mode — the native menu item or the chrome toggle both land
    // on this command (spec §6.3), so this is the one place a rebuild needs
    // to be triggered from. Only rebuild when something actually changed —
    // `rebuild` is idempotent so a rebuild on a no-op wouldn't be wrong, just
    // a wasted main-thread hop and menu reconstruction on every redundant
    // toggle call. `apply_if_changed` has already returned by this point,
    // which drops its settings-mutex guard before this line runs, so this
    // call is never made from inside the locked section. `menu::rebuild`
    // itself hops to the main thread (menu ops must run there), so calling it
    // from here — on whatever thread invoked this command — is safe.
    if changed {
        crate::menu::rebuild(&app);
    }
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
            Some(Settings { theme: "dark".into(), typewriter: false, focus: false })
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
        let s = Settings { theme: "light".into(), typewriter: false, focus: false };
        write_settings(&path, &s).unwrap();
        assert_eq!(read_settings(&path), Some(s));
    }

    #[test]
    fn modes_default_to_off_when_absent_from_the_file() {
        // The owner's settings.json contains only `theme`. Without serde
        // defaults this returns None and the stored theme is silently lost.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"theme":"dark"}"#).unwrap();
        let s = read_settings(&path).expect("a theme-only file must still load");
        assert_eq!(s.theme, "dark");
        assert!(!s.typewriter);
        assert!(!s.focus);
    }

    #[test]
    fn modes_round_trip_through_a_write() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let s = Settings { theme: "light".into(), typewriter: true, focus: true };
        write_settings(&path, &s).unwrap();
        assert_eq!(read_settings(&path), Some(s));
    }

    #[test]
    fn merging_a_theme_preserves_the_modes() {
        // The trap: set_theme used to build a fresh Settings, which would
        // silently switch both modes off whenever the theme changed.
        let current = Settings { theme: "dark".into(), typewriter: true, focus: false };
        let merged = with_theme(&current, "light".into());
        assert_eq!(merged.theme, "light");
        assert!(merged.typewriter, "changing the theme must not clear typewriter");
        assert!(!merged.focus);
    }

    #[test]
    fn merging_a_mode_preserves_the_theme_and_the_other_mode() {
        let current = Settings { theme: "dark".into(), typewriter: false, focus: false };
        let merged = with_mode(&current, "focus", true).unwrap();
        assert_eq!(merged.theme, "dark", "toggling a mode must not touch the theme");
        assert!(merged.focus);
        assert!(!merged.typewriter, "toggling focus must not touch typewriter");
    }

    #[test]
    fn an_unknown_mode_name_is_rejected() {
        let current = Settings::default();
        assert!(with_mode(&current, "zen", true).is_none());
        assert!(is_valid_writing_mode("typewriter"));
        assert!(is_valid_writing_mode("focus"));
        assert!(!is_valid_writing_mode("zen"));
    }
}
