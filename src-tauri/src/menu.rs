use tauri::{
    menu::{CheckMenuItem, Menu, MenuBuilder, MenuItem, Submenu, SubmenuBuilder},
    AppHandle, Manager, Runtime,
};
use crate::recents::{RecentEntry, RecentKind, RecentsState};

#[derive(Debug)]
pub enum RecentClick {
    Open(RecentEntry),
    Clear,
}

/// Menu item id for a recent entry: "recent:<kind>:<path>". The path may contain
/// colons; parsing splits only on the FIRST colon after the kind.
pub fn recent_id(entry: &RecentEntry) -> String {
    let kind = match entry.kind {
        RecentKind::File => "file",
        RecentKind::Folder => "folder",
    };
    format!("recent:{kind}:{}", entry.path)
}

/// Parse a "recent:*" menu id back into an action.
pub fn parse_recent_id(id: &str) -> Option<RecentClick> {
    let rest = id.strip_prefix("recent:")?;
    if rest == "clear" {
        return Some(RecentClick::Clear);
    }
    let (kind, path) = rest.split_once(':')?;
    let kind = match kind {
        "file" => RecentKind::File,
        "folder" => RecentKind::Folder,
        _ => return None,
    };
    Some(RecentClick::Open(RecentEntry { kind, path: path.to_string() }))
}

fn basename(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string()
}

/// Build the "Open Recent ▸" submenu: files, separator, folders, separator,
/// "Clear Menu". Empty → a single disabled "No Recent Items".
fn build_recent_submenu<R: Runtime>(app: &AppHandle<R>, recents: &[RecentEntry]) -> tauri::Result<Submenu<R>> {
    let mut builder = SubmenuBuilder::new(app, "Open Recent");
    if recents.is_empty() {
        let none = MenuItem::with_id(app, "recent:none", "No Recent Items", false, None::<&str>)?;
        return builder.item(&none).build();
    }
    // Hold items alive until build().
    let files: Vec<RecentEntry> = recents.iter().filter(|e| e.kind == RecentKind::File).cloned().collect();
    let folders: Vec<RecentEntry> = recents.iter().filter(|e| e.kind == RecentKind::Folder).cloned().collect();
    let mut items: Vec<MenuItem<R>> = Vec::new();
    for e in files.iter().chain(folders.iter()) {
        items.push(MenuItem::with_id(app, recent_id(e), basename(&e.path), true, None::<&str>)?);
    }
    let file_count = files.len();
    for (i, item) in items.iter().enumerate() {
        if i == file_count && file_count > 0 && !folders.is_empty() {
            builder = builder.separator(); // between files and folders
        }
        builder = builder.item(item);
    }
    let clear = MenuItem::with_id(app, "recent:clear", "Clear Menu", true, None::<&str>)?;
    builder.separator().item(&clear).build()
}

/// What the View menu's checkmarks currently SHOW: the focused window's
/// writing modes and Code view wrapping, as that window last reported them.
///
/// This is a display cache, **not** the source of truth. Under 6c-ii-b's D-A
/// the modes are per-window React state that never persists; Rust holds this
/// only because a macOS menu bar is app-global and has to render *someone's*
/// state. It exists so `rebuild` (which fires on unrelated events, like the
/// recents list changing) redraws the checkmarks as they were rather than
/// resetting them.
///
/// 6c-ii's design had Rust own the modes outright — persist, broadcast, and
/// set the checkmark, with no hop through any window's frontend. That was
/// correct while the state was app-wide and is wrong now: with per-window
/// state there is no single value to own, so ownership moves to the window and
/// Rust keeps only what it must draw.
///
/// `wrap` is per-window too. The stored `codeWrap` setting is only the state a
/// new window starts in, so it seeds this cache at launch and nothing more.
/// In Live view the window reports the caret's code block instead, and
/// `wrap_enabled` is false wherever a wrap command would do nothing there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MenuModes {
    pub typewriter: bool,
    pub focus: bool,
    pub wrap: bool,
    pub wrap_enabled: bool,
}

impl Default for MenuModes {
    fn default() -> Self {
        MenuModes { typewriter: false, focus: false, wrap: true, wrap_enabled: true }
    }
}

impl MenuModes {
    /// These marks with a window's report applied. A window reports its
    /// writing modes and its wrapping from separate places, so a field left
    /// `None` keeps what is shown.
    pub fn with_report(
        self,
        typewriter: Option<bool>,
        focus: Option<bool>,
        wrap: Option<bool>,
        wrap_enabled: Option<bool>,
    ) -> Self {
        MenuModes {
            typewriter: typewriter.unwrap_or(self.typewriter),
            focus: focus.unwrap_or(self.focus),
            wrap: wrap.unwrap_or(self.wrap),
            wrap_enabled: wrap_enabled.unwrap_or(self.wrap_enabled),
        }
    }
}

/// The live display cache behind [`MenuModes`], managed in app state.
#[derive(Default)]
pub struct MenuModeState(pub std::sync::Mutex<MenuModes>);

/// Apply a window's report to the View menu's checkmarks, and remember the
/// result so a later [`rebuild`] redraws the same thing.
///
/// Walks the menu tree rather than using `Menu::get`, which only searches
/// direct children — these items live inside the View submenu, and that
/// submenu is built without an id of its own, so there is nothing to look it
/// up by. A missing item is ignored rather than an error: the only way it can
/// happen is a build that no longer has a View menu, and failing a mode toggle
/// is not worth propagating over.
pub fn set_mode_checks<R: Runtime>(
    app: &AppHandle<R>,
    typewriter: Option<bool>,
    focus: Option<bool>,
    wrap: Option<bool>,
    wrap_enabled: Option<bool>,
) {
    let state = app.state::<MenuModeState>();
    let modes = {
        let Ok(mut cached) = state.0.lock() else { return };
        *cached = cached.with_report(typewriter, focus, wrap, wrap_enabled);
        *cached
    };
    set_check(app, "toggle-typewriter", modes.typewriter);
    set_check(app, "toggle-focus", modes.focus);
    set_check(app, WRAP_ID, modes.wrap);
    with_check_item(app, WRAP_ID, |item| {
        let _ = item.set_enabled(modes.wrap_enabled);
    });
}

/// Point the check item with `id` at `checked`; a menu or item that is missing
/// is ignored (see [`set_mode_checks`]).
fn set_check<R: Runtime>(app: &AppHandle<R>, id: &str, checked: bool) {
    with_check_item(app, id, |item| {
        let _ = item.set_checked(checked);
    });
}

fn with_check_item<R: Runtime>(app: &AppHandle<R>, id: &str, f: impl Fn(&CheckMenuItem<R>)) {
    let Some(menu) = app.menu() else { return };
    let Ok(items) = menu.items() else { return };
    for kind in items {
        let Some(submenu) = kind.as_submenu() else { continue };
        let Ok(children) = submenu.items() else { continue };
        for child in children {
            let Some(check) = child.as_check_menuitem() else { continue };
            if check.id().0.as_str() == id {
                f(check);
            }
        }
    }
}

/// Frontend → Rust: the focused window reporting its own state so the menu can
/// draw it. Called when that state changes AND when the window gains focus,
/// since the menu shows whichever window is in front. The writing modes and
/// wrapping are reported separately, so each argument may be left out.
#[tauri::command]
pub fn sync_view_menu(
    app: AppHandle,
    typewriter: Option<bool>,
    focus: Option<bool>,
    wrap: Option<bool>,
    wrap_enabled: Option<bool>,
) {
    set_mode_checks(&app, typewriter, focus, wrap, wrap_enabled);
}

/// Edtr never checks for updates itself (no network access); this item only
/// opens the newest release in the browser, where the version can be compared
/// with the one in About Edtr. Intercepted in `lib.rs`, so it needs no window.
pub const CHECK_UPDATES_ID: &str = "check-updates";
pub const WRAP_ID: &str = "toggle-wrap";
/// Needs ⌘: macOS hands an ⌥-only key equivalent to text input (it types Ω) before the menu sees it.
pub const WRAP_ACCELERATOR: &str = "Alt+Cmd+Z";
pub const RELEASES_URL: &str = "https://github.com/andyg-xd/edtr/releases/latest";

/// Put the Wrap Lines checkmark back to the focused window's last report.
pub fn redraw_wrap_check<R: Runtime>(app: &AppHandle<R>) {
    let wrap = app.state::<MenuModeState>().0.lock().map(|m| m.wrap).unwrap_or(true);
    set_check(app, WRAP_ID, wrap);
}

/// Map a custom menu item's id to the `menu://` event the frontend listens for.
///
/// Extracted from `lib.rs`'s `on_menu_event` closure so the mapping is unit
/// testable: a typo here is otherwise a silent no-op at runtime. `quit` and
/// `recent:*` are intercepted before this is reached, so both return None.
pub fn menu_event_name(id: &str) -> Option<&'static str> {
    Some(match id {
        "open" => "menu://open",
        "open-folder" => "menu://open-folder",
        "save" => "menu://save",
        "save-as" => "menu://save-as",
        "close" => "menu://close",
        "print" => "menu://print",
        "find" => "menu://find",
        "find-next" => "menu://find-next",
        "find-prev" => "menu://find-prev",
        "replace" => "menu://replace",
        // 6c-ii-b: the two writing modes now travel this ordinary path to the
        // FOCUSED window, because per-window state lives in that window. In
        // 6c-ii they were intercepted in lib.rs and never reached here at all.
        "toggle-typewriter" => "menu://toggle-typewriter",
        "toggle-focus" => "menu://toggle-focus",
        WRAP_ID => "menu://toggle-wrap",
        "undo" => "menu://undo",
        "redo" => "menu://redo",
        _ => return None,
    })
}

/// Build the native macOS menu bar.
///
/// Quit / Open / Save / Close are CUSTOM `MenuItem`s (with ids) — deliberately
/// NOT `PredefinedMenuItem::quit`/etc. — so their accelerators (⌘Q/⌘O/⌘S/⌘W)
/// fire an `on_menu_event` we can guard instead of the OS terminating the
/// process. ⌘Q in particular is a special Apple event Tauri does not otherwise
/// deliver to window/exit events, so owning the menu item is the only robust
/// interception (see the design spec). The Edit submenu keeps the PREDEFINED
/// clipboard items (cut/copy/paste/select-all), owns Undo / Redo (see the
/// comment at the Edit submenu), and adds our custom Find and Replace items that need `on_menu_event` delivery, for the same reason:
/// macOS offers a key equivalent to the menu before the webview, so ⌘F must be owned
/// by a native menu item rather than a webview keymap binding.
/// Where a menu command should go, given who holds focus.
///
/// Pure, and separate from acting on it, because the interesting cases are all
/// about a window that cannot receive anything: a print window has no frontend,
/// so a command delivered to it is a command silently lost. That is exactly how
/// a second print became impossible — the print window keeps key status after
/// its panel is dismissed, and the router handled only its close.
#[derive(Debug, PartialEq, Eq)]
pub enum MenuRoute {
    /// Close the focused print window; deliver nothing.
    ClosePrintWindow,
    /// Clear the transient print window, then deliver to the editor it came from.
    ClearPrintWindowAndDeliver(String),
    /// Deliver to the focused editor window.
    Deliver(String),
    /// No window can take this command.
    Drop,
}

/// Decide where `id` goes.
///
/// `print_parent` must already have been checked for liveness by the caller —
/// only it knows which windows are open. Every label handed back is a window
/// the caller resolved, never one invented here.
pub fn route_menu_command(
    id: &str,
    focused_print_window: Option<&str>,
    print_parent: Option<&str>,
    focused_editor: Option<&str>,
    open_editors: &[String],
) -> MenuRoute {
    if focused_print_window.is_some() {
        // ⌘W means "dismiss this window", the one command a print window is
        // genuinely the subject of.
        if id == "close" {
            return MenuRoute::ClosePrintWindow;
        }
        // Anything else is aimed at the document, so the transient window is
        // cleared out of the way and the command follows the user's intent back
        // to the editor it started from. When the parent is gone, the window is
        // still cleared — there is simply nowhere to deliver.
        return match print_parent {
            Some(p) if !crate::export::is_print_window(p) => {
                MenuRoute::ClearPrintWindowAndDeliver(p.to_string())
            }
            // The window that printed is gone. Clearing the stray and
            // delivering nothing is indistinguishable from the command being
            // ignored — which is the whole defect this routing exists to fix —
            // so when exactly ONE editor remains there is nothing ambiguous
            // about where the user meant it to go. With several open there
            // genuinely is, and guessing would be worse than doing nothing.
            _ => match open_editors {
                [only] => MenuRoute::ClearPrintWindowAndDeliver(only.clone()),
                _ => MenuRoute::ClosePrintWindow,
            },
        };
    }
    match focused_editor {
        Some(e) => MenuRoute::Deliver(e.to_string()),
        None => MenuRoute::Drop,
    }
}

pub fn build_menu<R: Runtime>(
    app: &AppHandle<R>,
    recents: &[RecentEntry],
    modes: MenuModes,
) -> tauri::Result<Menu<R>> {
    let quit = MenuItem::with_id(app, "quit", "Quit Edtr", true, Some("Cmd+Q"))?;
    let check_updates = MenuItem::with_id(app, CHECK_UPDATES_ID, "Check for Updates…", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open…", true, Some("Cmd+O"))?;
    let open_folder = MenuItem::with_id(app, "open-folder", "Open Folder…", true, Some("Cmd+Shift+O"))?;
    let save = MenuItem::with_id(app, "save", "Save", true, Some("Cmd+S"))?;
    let save_as = MenuItem::with_id(app, "save-as", "Save As…", true, Some("Cmd+Shift+S"))?;
    let close = MenuItem::with_id(app, "close", "Close Window", true, Some("Cmd+W"))?;
    let print = MenuItem::with_id(app, "print", "Print…", true, Some("Cmd+P"))?;
    let find = MenuItem::with_id(app, "find", "Find…", true, Some("Cmd+F"))?;
    let find_next = MenuItem::with_id(app, "find-next", "Find Next", true, Some("Cmd+G"))?;
    let find_prev = MenuItem::with_id(app, "find-prev", "Find Previous", true, Some("Cmd+Shift+G"))?;
    let replace = MenuItem::with_id(app, "replace", "Replace…", true, Some("Alt+Cmd+F"))?;
    let undo = MenuItem::with_id(app, "undo", "Undo", true, Some("Cmd+Z"))?;
    let redo = MenuItem::with_id(app, "redo", "Redo", true, Some("Cmd+Shift+Z"))?;
    let recent_menu = build_recent_submenu(app, recents)?;

    let app_menu = SubmenuBuilder::new(app, "Edtr")
        .about(None)
        .item(&check_updates)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&quit)
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&open)
        .item(&open_folder)
        .item(&recent_menu)
        .item(&save)
        .item(&save_as)
        .separator()
        .item(&print)
        .separator()
        .item(&close)
        .build()?;

    // Undo and Redo are CUSTOM items: the predefined ones run WebKit's own undo
    // stack, which fills only from native typing and which both editors cancel
    // in favour of their own, so from the menu they often did nothing (Redo
    // never could). The frontend routes them (`runMenuHistory`). Cut, copy,
    // paste and select-all stay PREDEFINED, then our custom Find and Replace
    // items. The native menu must own ⌘F: macOS offers a key equivalent
    // to the menu before the webview, so a webview binding would never fire
    // (the same reason ⌘Q needed a custom item in Phase 5).
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&undo)
        .item(&redo)
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&find)
        .item(&find_next)
        .item(&find_prev)
        .item(&replace)
        .build()?;

    // Checkmarked writing modes. PER-WINDOW as of 6c-ii-b (D-A): these show
    // the focused window's state, pushed up by that window via
    // `sync_view_menu`, and a click is delivered to that window like any other
    // menu command. No accelerators — an
    // earlier phase verified every real shortcut against the app; these two
    // don't have one. Delivered to the focused window (see `menu_event_name`
    // and `lib.rs`'s menu-event handler) — never routed through `menu://`.
    let typewriter = CheckMenuItem::with_id(
        app, "toggle-typewriter", "Typewriter Mode", true, modes.typewriter, None::<&str>,
    )?;
    let focus = CheckMenuItem::with_id(
        app, "toggle-focus", "Focus Mode", true, modes.focus, None::<&str>,
    )?;
    // Per-window like the two modes above: the mark shows the focused
    // window's Code view wrapping.
    let wrap = CheckMenuItem::with_id(
        app, WRAP_ID, "Wrap Lines", modes.wrap_enabled, modes.wrap, Some(WRAP_ACCELERATOR),
    )?;
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&wrap)
        .separator()
        .item(&typewriter)
        .item(&focus)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])
        .build()
}

/// Rebuild the whole menu bar from the current recents and settings and swap
/// it in, on the macOS main thread (menu ops must not run off-main-thread).
/// Best-effort.
///
/// The checkmarks come from [`MenuModeState`], the display cache, NOT from
/// persisted settings — under 6c-ii-b's D-A the modes never persist. This
/// matters because `rebuild` fires on events with nothing to do with writing
/// modes (the recents list changing, most often): reading the cache means such
/// a rebuild redraws the focused window's modes as they are, instead of
/// clearing both checkmarks while the window is still in those modes.
pub fn rebuild<R: Runtime>(app: &AppHandle<R>) {
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        let recents = crate::recents::get(&app2.state::<RecentsState>());
        let modes = app2
            .state::<MenuModeState>()
            .0
            .lock()
            .map(|m| *m)
            .unwrap_or_default();
        if let Ok(menu) = build_menu(&app2, &recents, modes) {
            let _ = app2.set_menu(menu);
        }
    });
}

#[cfg(test)]
mod recent_id_tests {
    use super::*;
    use crate::recents::{RecentEntry, RecentKind};

    #[test]
    fn round_trips_file_and_folder_incl_paths_with_colons() {
        for e in [
            RecentEntry { kind: RecentKind::File, path: "/a/b.md".into() },
            RecentEntry { kind: RecentKind::Folder, path: "/x:y/proj".into() }, // colon in path
        ] {
            let id = recent_id(&e);
            match parse_recent_id(&id) {
                Some(RecentClick::Open(parsed)) => assert_eq!(parsed, e),
                other => panic!("expected Open, got {other:?}"),
            }
        }
    }

    #[test]
    fn parses_clear() {
        assert!(matches!(parse_recent_id("recent:clear"), Some(RecentClick::Clear)));
    }

    #[test]
    fn rejects_non_recent_ids() {
        assert!(parse_recent_id("open").is_none());
        assert!(parse_recent_id("recent:bogus:/p").is_none());
    }
}

#[cfg(test)]
mod view_menu_tests {
    use super::*;

    #[test]
    fn the_two_view_ids_now_emit_to_the_focused_window() {
        // 6c-ii-b inverted this. Under 6c-ii these ids were intercepted in
        // lib.rs and `menu_event_name` returned None for them, because Rust
        // owned app-wide mode state end to end. Per-window state (D-A) means
        // the click has to reach the window that owns the state, so they now
        // travel the same ordinary path as Find and Save.
        assert_eq!(menu_event_name("toggle-typewriter"), Some("menu://toggle-typewriter"));
        assert_eq!(menu_event_name("toggle-focus"), Some("menu://toggle-focus"));
    }

    #[test]
    fn every_emitted_event_is_the_id_with_a_prefix() {
        // The frontend derives its listeners from a list of BARE command names
        // and subscribes to `menu://<name>`, so any id whose event name is not
        // exactly that prefix plus the id would emit into silence. This holds
        // the naming convention that keeps the two sides mechanically
        // comparable (see menuCommands.contract.test.ts, which reads this file
        // and asserts the two lists match).
        for id in [
            "open", "open-folder", "save", "save-as", "close", "print",
            "find", "find-next", "find-prev", "replace",
            "toggle-typewriter", "toggle-focus", "toggle-wrap", "undo", "redo",
        ] {
            assert_eq!(
                menu_event_name(id),
                Some(format!("menu://{id}").as_str()),
                "{id} must emit menu://{id}",
            );
        }
    }

    #[test]
    fn ids_handled_elsewhere_emit_nothing() {
        // `quit`, `check-updates` and `recent:*` are intercepted before this
        // mapping is reached; returning an event for them would double-handle
        // the click.
        for id in ["quit", "check-updates", "recent:clear", "recent:file:/tmp/a.md", "nonsense"] {
            assert_eq!(menu_event_name(id), None, "{id} must not emit a menu:// event");
        }
    }

    #[test]
    fn close_dismisses_a_focused_print_window_and_delivers_nothing() {
        assert_eq!(
            route_menu_command("close", Some("edtr-print-1-0"), Some("main"), None, &[]),
            MenuRoute::ClosePrintWindow
        );
    }

    #[test]
    fn any_other_command_clears_the_print_window_and_follows_the_user_back() {
        // The defect this fixes: every one of these used to be dropped on the
        // floor, so with a print window open the app's menu went dead.
        for id in ["print", "save", "find", "open", "toggle-focus"] {
            assert_eq!(
                route_menu_command(id, Some("edtr-print-1-0"), Some("main"), None, &[]),
                MenuRoute::ClearPrintWindowAndDeliver("main".to_string()),
                "{id} must reach the editor it came from"
            );
        }
    }

    #[test]
    fn a_command_is_never_delivered_to_a_print_window() {
        // A print window has no frontend, so "delivering" there loses the
        // command exactly as silently as dropping it. Guarded because the
        // parent label is remembered state and could go stale.
        assert_eq!(
            route_menu_command("save", Some("edtr-print-1-0"), Some("edtr-print-1-1"), None, &[]),
            MenuRoute::ClosePrintWindow
        );
    }

    #[test]
    fn a_closed_parent_still_gets_the_stray_window_cleared() {
        assert_eq!(
            route_menu_command("save", Some("edtr-print-1-0"), None, None, &[]),
            MenuRoute::ClosePrintWindow
        );
    }

    #[test]
    fn a_lost_parent_falls_back_to_the_one_remaining_editor() {
        // The exact shape of the defect reported on 2026-08-21: the stray
        // window closes and nothing is saved, which reads as the command being
        // swallowed. With one editor left there is no ambiguity to respect.
        let editors = vec!["editor-1".to_string()];
        assert_eq!(
            route_menu_command("save", Some("edtr-print-1-0"), None, None, &editors),
            MenuRoute::ClearPrintWindowAndDeliver("editor-1".to_string())
        );
    }

    #[test]
    fn a_lost_parent_with_several_editors_declines_to_guess() {
        let editors = vec!["editor-1".to_string(), "editor-2".to_string()];
        assert_eq!(
            route_menu_command("save", Some("edtr-print-1-0"), None, None, &editors),
            MenuRoute::ClosePrintWindow
        );
    }

    #[test]
    fn with_no_print_window_focused_nothing_about_delivery_changes() {
        assert_eq!(
            route_menu_command("save", None, Some("main"), Some("window-2"), &[]),
            MenuRoute::Deliver("window-2".to_string())
        );
        assert_eq!(route_menu_command("save", None, Some("main"), None, &[]), MenuRoute::Drop);
    }

    #[test]
    fn the_menu_mode_cache_defaults_to_both_off() {
        // D-A: a window always starts with both modes off, so the checkmarks a
        // freshly built menu draws must start clear too.
        let modes = MenuModes::default();
        assert!(!modes.typewriter);
        assert!(!modes.focus);
    }

    #[test]
    fn the_menu_mode_cache_starts_with_wrap_on() {
        // Wrapping is on by default, so before any window reports, Wrap Lines
        // is drawn checked.
        assert!(MenuModes::default().wrap);
    }

    #[test]
    fn a_wrap_report_moves_only_the_wrap_mark() {
        // The wrap state and the writing modes are reported by separate parts
        // of a window, so each report must leave the other's marks alone.
        let shown = MenuModes { typewriter: true, focus: true, wrap: true, wrap_enabled: true };
        assert_eq!(
            shown.with_report(None, None, Some(false), None),
            MenuModes { typewriter: true, focus: true, wrap: false, wrap_enabled: true },
        );
    }

    #[test]
    fn a_writing_mode_report_leaves_the_wrap_mark_alone() {
        let shown = MenuModes { typewriter: false, focus: false, wrap: false, wrap_enabled: false };
        assert_eq!(
            shown.with_report(Some(true), Some(false), None, None),
            MenuModes { typewriter: true, focus: false, wrap: false, wrap_enabled: false },
        );
    }

    #[test]
    fn wrap_lines_starts_enabled() {
        // Code view, and a window with no document, can always wrap.
        assert!(MenuModes::default().wrap_enabled);
    }

    #[test]
    fn a_live_view_report_can_grey_out_wrap_lines() {
        // Live view with the caret outside a code block, or HTML Live: the
        // command does nothing there, so the item is disabled, not just unchecked.
        let shown = MenuModes::default();
        let greyed = shown.with_report(None, None, Some(false), Some(false));
        assert!(!greyed.wrap_enabled);
        assert_eq!(greyed.with_report(Some(true), None, None, None).wrap_enabled, false);
        assert!(greyed.with_report(None, None, Some(true), Some(true)).wrap_enabled);
    }
}

#[cfg(test)]
mod wrap_accelerator_tests {
    use super::WRAP_ACCELERATOR;

    #[test]
    fn wrap_lines_uses_option_command_z() {
        assert_eq!(WRAP_ACCELERATOR, "Alt+Cmd+Z");
    }
}

#[cfg(test)]
mod menu_event_name_tests {
    use super::menu_event_name;

    #[test]
    fn maps_every_custom_item_to_its_event() {
        for (id, event) in [
            ("open", "menu://open"),
            ("open-folder", "menu://open-folder"),
            ("save", "menu://save"),
            ("save-as", "menu://save-as"),
            ("close", "menu://close"),
            ("print", "menu://print"),
            ("find", "menu://find"),
            ("find-next", "menu://find-next"),
            ("find-prev", "menu://find-prev"),
            ("replace", "menu://replace"),
            ("undo", "menu://undo"),
            ("redo", "menu://redo"),
        ] {
            assert_eq!(menu_event_name(id), Some(event), "id {id}");
        }
    }

    #[test]
    fn returns_none_for_ids_handled_elsewhere_or_unknown() {
        // "quit" and "recent:*" are intercepted before this mapping runs.
        assert_eq!(menu_event_name("quit"), None);
        assert_eq!(menu_event_name("recent:clear"), None);
        assert_eq!(menu_event_name("nonsense"), None);
    }
}

#[cfg(test)]
mod check_updates_tests {
    use super::*;

    #[test]
    fn check_for_updates_opens_this_repos_latest_release() {
        assert_eq!(RELEASES_URL, "https://github.com/andyg-xd/edtr/releases/latest");
    }

    #[test]
    fn check_for_updates_has_its_own_menu_id() {
        assert_eq!(CHECK_UPDATES_ID, "check-updates");
    }
}
