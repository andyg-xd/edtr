use tauri::{
    menu::{Menu, MenuBuilder, MenuItem, SubmenuBuilder},
    AppHandle, Runtime,
};

/// Build the native macOS menu bar.
///
/// Quit / Open / Save / Close are CUSTOM `MenuItem`s (with ids) — deliberately
/// NOT `PredefinedMenuItem::quit`/etc. — so their accelerators (⌘Q/⌘O/⌘S/⌘W)
/// fire an `on_menu_event` we can guard instead of the OS terminating the
/// process. ⌘Q in particular is a special Apple event Tauri does not otherwise
/// deliver to window/exit events, so owning the menu item is the only robust
/// interception (see the design spec). The Edit submenu uses PREDEFINED items
/// so the editors keep copy/paste/cut/undo/redo/select-all.
pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let quit = MenuItem::with_id(app, "quit", "Quit Edtr", true, Some("Cmd+Q"))?;
    let open = MenuItem::with_id(app, "open", "Open…", true, Some("Cmd+O"))?;
    let save = MenuItem::with_id(app, "save", "Save", true, Some("Cmd+S"))?;
    let close = MenuItem::with_id(app, "close", "Close Window", true, Some("Cmd+W"))?;

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
