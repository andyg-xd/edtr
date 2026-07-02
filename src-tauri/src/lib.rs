mod assets;
mod fs;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            fs::read_text_file,
            fs::write_text_file_atomic,
            assets::copy_image_into_assets,
            assets::write_image_into_assets
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
