use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// What a freshly-opened window should load. Matches the TS `OpenPayload`
/// discriminated union: {kind:'files',paths} | {kind:'folder',path}.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum OpenPayload {
    Files { paths: Vec<String> },
    Folder { path: String },
}

/// Payloads waiting for their not-yet-mounted window to claim them, keyed by
/// window label. A new window pops its payload once on mount.
#[derive(Default)]
pub struct PendingOpen(pub Mutex<HashMap<String, OpenPayload>>);

/// Monotonic counter for minting unique window labels.
#[derive(Default)]
pub struct WindowCounter(pub Mutex<u32>);

/// Spawn a new editor window that will load `payload` on mount.
#[tauri::command]
pub fn open_in_new_window(
    app: AppHandle,
    payload: OpenPayload,
    pending: State<PendingOpen>,
    counter: State<WindowCounter>,
) -> Result<(), String> {
    let label = {
        let mut c = counter.0.lock().map_err(|_| "counter lock poisoned")?;
        *c += 1;
        format!("editor-{}", *c)
    };
    pending
        .0
        .lock()
        .map_err(|_| "pending lock poisoned")?
        .insert(label.clone(), payload);
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("Edtr")
        .inner_size(800.0, 600.0)
        .build()
        .map_err(|e| {
            // Don't leak a stranded payload if the window failed to build.
            let _ = pending.0.lock().map(|mut m| m.remove(&label));
            format!("Could not open window: {e}")
        })?;
    Ok(())
}

/// Pop (and remove) the calling window's pending payload, if any. The new
/// window's frontend calls this once on mount.
#[tauri::command]
pub fn take_pending_open(window: WebviewWindow, pending: State<PendingOpen>) -> Option<OpenPayload> {
    pending.0.lock().ok()?.remove(window.label())
}
