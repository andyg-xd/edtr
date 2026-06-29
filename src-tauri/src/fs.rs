// Filled in by Tasks 2–3.
#[tauri::command]
pub fn read_text_file(_path: String) -> Result<(), String> {
    Err("not implemented".into())
}

#[tauri::command]
pub fn write_text_file_atomic(_path: String, _text: String) -> Result<(), String> {
    Err("not implemented".into())
}
