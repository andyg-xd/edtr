mod assets;
mod fs;
mod menu;

use tauri::Emitter;

/// Quit the whole app. Called from the frontend only AFTER the unsaved-changes
/// guard has been satisfied (Save succeeded, or the user chose Discard, or the
/// document was clean).
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .menu(|handle| menu::build_menu(handle))
        .on_menu_event(|app, event| {
            // Map our custom menu ids to frontend events. The frontend runs the
            // real logic (open dialog, save, close/quit guard) because dirty
            // state lives in the React session model, not in Rust.
            let event_name = match event.id().0.as_str() {
                "open" => "menu://open",
                "open-folder" => "menu://open-folder",
                "save" => "menu://save",
                "close" => "menu://close",
                "quit" => "menu://quit",
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
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
