use tauri::{
    menu::{Menu, MenuBuilder, MenuItem, Submenu, SubmenuBuilder},
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

/// Build the native macOS menu bar.
///
/// Quit / Open / Save / Close are CUSTOM `MenuItem`s (with ids) — deliberately
/// NOT `PredefinedMenuItem::quit`/etc. — so their accelerators (⌘Q/⌘O/⌘S/⌘W)
/// fire an `on_menu_event` we can guard instead of the OS terminating the
/// process. ⌘Q in particular is a special Apple event Tauri does not otherwise
/// deliver to window/exit events, so owning the menu item is the only robust
/// interception (see the design spec). The Edit submenu uses PREDEFINED items
/// so the editors keep copy/paste/cut/undo/redo/select-all.
pub fn build_menu<R: Runtime>(app: &AppHandle<R>, recents: &[RecentEntry]) -> tauri::Result<Menu<R>> {
    let quit = MenuItem::with_id(app, "quit", "Quit Edtr", true, Some("Cmd+Q"))?;
    let open = MenuItem::with_id(app, "open", "Open…", true, Some("Cmd+O"))?;
    let open_folder = MenuItem::with_id(app, "open-folder", "Open Folder…", true, Some("Cmd+Shift+O"))?;
    let save = MenuItem::with_id(app, "save", "Save", true, Some("Cmd+S"))?;
    let close = MenuItem::with_id(app, "close", "Close Window", true, Some("Cmd+W"))?;
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
        .separator()
        .item(&close)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &window_menu])
        .build()
}

/// Rebuild the whole menu bar from the current recents and swap it in, on the
/// macOS main thread (menu ops must not run off-main-thread). Best-effort.
pub fn rebuild<R: Runtime>(app: &AppHandle<R>) {
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        let recents = crate::recents::get(&app2.state::<RecentsState>());
        if let Ok(menu) = build_menu(&app2, &recents) {
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
