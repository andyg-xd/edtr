mod assets;
mod fs;
mod menu;
mod window;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(window::PendingOpen::default())
        .manage(window::WindowCounter::default())
        .menu(|handle| menu::build_menu(handle))
        .on_menu_event(|app, event| {
            let id = event.id().0.clone();
            if id == "quit" {
                // Quit sweep: broadcast to every window's (window-scoped) listener.
                // Each window destroys itself on proceed; exit-on-zero (in
                // .run) quits once the last is gone. Non-atomic by design
                // (5b-iii-a); atomic quit is 5b-iii-b.
                let _ = app.emit("menu://close", ());
                return;
            }
            let event_name = match id.as_str() {
                "open" => "menu://open",
                "open-folder" => "menu://open-folder",
                "save" => "menu://save",
                "close" => "menu://close",
                _ => return,
            };
            // Deliver to the FOCUSED window only. `emit_to(<label>, …)` targets
            // that label; only that window's window-scoped listener (see
            // MenuBridge) fires. (Plain `.emit()` is a global broadcast — do not
            // use it here.)
            if let Some(w) = app
                .webview_windows()
                .into_values()
                .find(|w| w.is_focused().unwrap_or(false))
            {
                let label = w.label().to_string();
                let _ = app.emit_to(label.as_str(), event_name, ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            fs::read_text_file,
            fs::write_text_file_atomic,
            fs::read_folder,
            assets::copy_image_into_assets,
            assets::write_image_into_assets,
            window::open_in_new_window,
            window::take_pending_open
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Quit when the last window closes (macOS otherwise keeps a
            // windowless app alive).
            if let tauri::RunEvent::WindowEvent {
                event: tauri::WindowEvent::Destroyed,
                ..
            } = event
            {
                if app_handle.webview_windows().is_empty() {
                    app_handle.exit(0);
                }
            }
        });
}
