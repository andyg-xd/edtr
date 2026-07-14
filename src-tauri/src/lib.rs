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
        .manage(window::QuitPollState::default())
        .manage(window::ReadyState::default())
        .manage(window::LaunchOpen::default())
        .menu(|handle| menu::build_menu(handle))
        .on_menu_event(|app, event| {
            let id = event.id().0.clone();
            if id == "quit" {
                // Atomic quit (5b-iii-b): snapshot the current windows and poll
                // them. Each votes ready/cancel WITHOUT closing; quit_vote
                // commits (exit) or aborts. Replaces the 5b-iii-a sweep.
                let labels: Vec<String> = app.webview_windows().into_keys().collect();
                if let Ok(mut p) = app.state::<window::QuitPollState>().0.lock() {
                    p.start(labels);
                }
                let _ = app.emit("menu://quit-poll", ());
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
            window::take_pending_open,
            window::quit_vote,
            window::take_launch_open,
            window::mark_frontend_ready
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Opened { urls } = &event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                if let Some(payload) = window::assemble_open_payload(paths) {
                    let ready = app_handle
                        .state::<window::ReadyState>()
                        .0
                        .lock()
                        .map(|r| *r)
                        .unwrap_or(false);
                    if ready {
                        // Warm: push to the focused window (fallback: any window);
                        // it runs the ⌘O fill-or-spawn path.
                        if let Some(w) = app_handle
                            .webview_windows()
                            .into_values()
                            .find(|w| w.is_focused().unwrap_or(false))
                            .or_else(|| app_handle.webview_windows().into_values().next())
                        {
                            let label = w.label().to_string();
                            let _ = app_handle.emit_to(label.as_str(), "menu://open-payload", payload);
                        }
                    } else {
                        // Cold: stash for the first window to claim on mount.
                        if let Ok(mut slot) = app_handle.state::<window::LaunchOpen>().0.lock() {
                            *slot = Some(payload);
                        }
                    }
                }
            }
            if let tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Destroyed,
                ..
            } = &event
            {
                // If a quit poll is active, a window that just closed can no
                // longer vote — drop it and re-check (may complete the poll).
                let dropped = app_handle
                    .state::<window::QuitPollState>()
                    .0
                    .lock()
                    .ok()
                    .map(|mut p| p.drop_window(label));
                if let Some(window::PollOutcome::Commit) = dropped {
                    app_handle.exit(0);
                    return;
                }
                // Quit when the last window closes (macOS otherwise keeps a
                // windowless app alive).
                if app_handle.webview_windows().is_empty() {
                    app_handle.exit(0);
                }
            }
        });
}
