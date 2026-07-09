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
            // (Task 3 rewrites this body — for the spike, the existing broadcast
            // body is fine; the spike doesn't exercise the menu.)
            let event_name = match event.id().0.as_str() {
                "open" => "menu://open",
                "open-folder" => "menu://open-folder",
                "save" => "menu://save",
                "close" => "menu://close",
                _ => return,
            };
            let _ = app.emit(event_name, ());
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
