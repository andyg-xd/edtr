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

/// What the View menu's two checkmarks currently SHOW: the focused window's
/// writing modes, as that window last reported them.
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
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MenuModes {
    pub typewriter: bool,
    pub focus: bool,
}

/// The live display cache behind [`MenuModes`], managed in app state.
#[derive(Default)]
pub struct MenuModeState(pub std::sync::Mutex<MenuModes>);

/// Point the View menu's checkmarks at `modes`, and remember them so a later
/// [`rebuild`] redraws the same thing.
///
/// Walks the menu tree rather than using `Menu::get`, which only searches
/// direct children — these two items live inside the View submenu, and that
/// submenu is built without an id of its own, so there is nothing to look it
/// up by. A missing item is ignored rather than an error: the only way it can
/// happen is a build that no longer has a View menu, and failing a mode toggle
/// is not worth propagating over.
pub fn set_mode_checks<R: Runtime>(app: &AppHandle<R>, modes: MenuModes) {
    if let Ok(mut cached) = app.state::<MenuModeState>().0.lock() {
        *cached = modes;
    }
    let Some(menu) = app.menu() else { return };
    let Ok(items) = menu.items() else { return };
    for kind in items {
        let Some(submenu) = kind.as_submenu() else { continue };
        let Ok(children) = submenu.items() else { continue };
        for child in children {
            let Some(check) = child.as_check_menuitem() else { continue };
            match check.id().0.as_str() {
                "toggle-typewriter" => { let _ = check.set_checked(modes.typewriter); }
                "toggle-focus" => { let _ = check.set_checked(modes.focus); }
                _ => {}
            }
        }
    }
}

/// Frontend → Rust: the focused window reporting its own modes so the menu can
/// draw them. Called when a window's modes change AND when it gains focus,
/// since the menu shows whichever window is in front.
#[tauri::command]
pub fn sync_view_menu(app: AppHandle, typewriter: bool, focus: bool) {
    set_mode_checks(&app, MenuModes { typewriter, focus });
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
        "find" => "menu://find",
        "find-next" => "menu://find-next",
        "find-prev" => "menu://find-prev",
        "replace" => "menu://replace",
        // 6c-ii-b: the two writing modes now travel this ordinary path to the
        // FOCUSED window, because per-window state lives in that window. In
        // 6c-ii they were intercepted in lib.rs and never reached here at all.
        "toggle-typewriter" => "menu://toggle-typewriter",
        "toggle-focus" => "menu://toggle-focus",
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
/// editing items (copy/paste/cut/undo/redo/select-all) and adds our custom Find
/// and Replace items that need `on_menu_event` delivery, for the same reason:
/// macOS offers a key equivalent to the menu before the webview, so ⌘F must be owned
/// by a native menu item rather than a webview keymap binding.
pub fn build_menu<R: Runtime>(
    app: &AppHandle<R>,
    recents: &[RecentEntry],
    modes: MenuModes,
) -> tauri::Result<Menu<R>> {
    let quit = MenuItem::with_id(app, "quit", "Quit Edtr", true, Some("Cmd+Q"))?;
    let open = MenuItem::with_id(app, "open", "Open…", true, Some("Cmd+O"))?;
    let open_folder = MenuItem::with_id(app, "open-folder", "Open Folder…", true, Some("Cmd+Shift+O"))?;
    let save = MenuItem::with_id(app, "save", "Save", true, Some("Cmd+S"))?;
    let save_as = MenuItem::with_id(app, "save-as", "Save As…", true, Some("Cmd+Shift+S"))?;
    let close = MenuItem::with_id(app, "close", "Close Window", true, Some("Cmd+W"))?;
    let find = MenuItem::with_id(app, "find", "Find…", true, Some("Cmd+F"))?;
    let find_next = MenuItem::with_id(app, "find-next", "Find Next", true, Some("Cmd+G"))?;
    let find_prev = MenuItem::with_id(app, "find-prev", "Find Previous", true, Some("Cmd+Shift+G"))?;
    let replace = MenuItem::with_id(app, "replace", "Replace…", true, Some("Alt+Cmd+F"))?;
    let recent_menu = build_recent_submenu(app, recents)?;

    let app_menu = SubmenuBuilder::new(app, "Edtr")
        .about(None)
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
        .item(&close)
        .build()?;

    // The Edit submenu keeps the PREDEFINED items so the editors keep
    // copy/paste/cut/undo/redo/select-all, then gains our custom Find and
    // Replace items. The native menu must own ⌘F: macOS offers a key equivalent
    // to the menu before the webview, so a webview binding would never fire
    // (the same reason ⌘Q needed a custom item in Phase 5).
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
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
    let view_menu = SubmenuBuilder::new(app, "View").item(&typewriter).item(&focus).build()?;

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
            "open", "open-folder", "save", "save-as", "close",
            "find", "find-next", "find-prev", "replace",
            "toggle-typewriter", "toggle-focus",
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
        // `quit` and `recent:*` are intercepted before this mapping is reached;
        // returning an event for them would double-handle the click.
        for id in ["quit", "recent:clear", "recent:file:/tmp/a.md", "nonsense"] {
            assert_eq!(menu_event_name(id), None, "{id} must not emit a menu:// event");
        }
    }

    #[test]
    fn the_menu_mode_cache_defaults_to_both_off() {
        // D-A: a window always starts with both modes off, so the checkmarks a
        // freshly built menu draws must start clear too.
        let modes = MenuModes::default();
        assert!(!modes.typewriter);
        assert!(!modes.focus);
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
            ("find", "menu://find"),
            ("find-next", "menu://find-next"),
            ("find-prev", "menu://find-prev"),
            ("replace", "menu://replace"),
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
