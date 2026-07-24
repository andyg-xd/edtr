mod assets;
mod fs;
mod menu;
mod recents;
mod settings;
mod watcher;
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
        .manage(recents::RecentsState::default())
        .manage(settings::SettingsState::default())
        .menu(|handle| menu::build_menu(handle, &[]))
        .setup(|app| {
            let handle = app.handle();
            let loaded = recents::load(handle);
            if let Ok(mut l) = app.state::<recents::RecentsState>().0.lock() {
                *l = loaded;
            }
            let loaded_settings = settings::load(handle);
            if let Ok(mut g) = app.state::<settings::SettingsState>().0.lock() {
                *g = loaded_settings;
            }
            menu::rebuild(handle); // swap in the menu populated with loaded recents
            match watcher::init(app.handle()) {
                Ok(ws) => { app.manage(ws); }
                Err(e) => { eprintln!("file watcher unavailable: {e}"); } // non-fatal
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().0.clone();
            if id.starts_with("recent:") {
                match menu::parse_recent_id(&id) {
                    Some(menu::RecentClick::Clear) => {
                        let _ = recents::clear(app, &app.state::<recents::RecentsState>());
                        menu::rebuild(app);
                    }
                    Some(menu::RecentClick::Open(entry)) => {
                        if std::path::Path::new(&entry.path).exists() {
                            let payload = match entry.kind {
                                recents::RecentKind::File => window::OpenPayload::Files { paths: vec![entry.path.clone()] },
                                recents::RecentKind::Folder => window::OpenPayload::Folder { path: entry.path.clone() },
                            };
                            window::deliver_open_payload(app, payload);
                            // The frontend's open choke point re-records it (move-to-top).
                        } else {
                            // Prune-missing: tell the user + drop it + rebuild.
                            use tauri_plugin_dialog::DialogExt;
                            let name = std::path::Path::new(&entry.path)
                                .file_name().and_then(|s| s.to_str()).unwrap_or(&entry.path).to_string();
                            app.dialog()
                                .message(format!("The item \"{name}\" can't be found. It may have been moved or deleted."))
                                .title("Item Not Found")
                                .show(|_| {});
                            let _ = recents::remove(app, &app.state::<recents::RecentsState>(), &entry);
                            menu::rebuild(app);
                        }
                    }
                    None => {} // "recent:none" (disabled) or malformed → ignore
                }
                return;
            }
            if id == "quit" {
                // Atomic quit (5b-iii-b) + crash safety net (5f, Item 2):
                // snapshot the windows, start the poll, broadcast the request.
                // Each live window acks immediately then votes; a grace timer
                // prunes any window that never acked (a crashed webview) so a
                // dead webview can't wedge the quit. A window still deliberating
                // on its guard HAS acked, so it is never force-quit.
                let labels: Vec<String> = app.webview_windows().into_keys().collect();
                let generation = match app.state::<window::QuitPollState>().0.lock() {
                    Ok(mut p) => p.start(labels),
                    Err(_) => return,
                };
                let _ = app.emit("menu://quit-poll", ());
                let app_timer = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    let outcome = match app_timer.state::<window::QuitPollState>().0.lock() {
                        Ok(mut p) => p.prune_if(generation),
                        Err(_) => return,
                    };
                    if outcome == window::PollOutcome::Commit {
                        app_timer.exit(0);
                    }
                });
                return;
            }
            let event_name = match id.as_str() {
                "open" => "menu://open",
                "open-folder" => "menu://open-folder",
                "save" => "menu://save",
                "save-as" => "menu://save-as",
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
            window::quit_ack,
            window::take_launch_open,
            window::mark_frontend_ready,
            recents::record_recent,
            watcher::watch_path,
            watcher::unwatch_path,
            settings::get_settings,
            settings::set_theme
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
                        window::deliver_open_payload(app_handle, payload);
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
