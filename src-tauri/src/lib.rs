mod spike_window; // SPIKE 6c-iv-b Task 0 — throwaway
mod assets;
mod devtools;
mod export;
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
        .manage(menu::MenuModeState::default())
        .menu(|handle| menu::build_menu(handle, &[], menu::MenuModes::default()))
        .setup(|app| {
            // Before any window exists, so the first inspector opened already
            // sees it (see devtools.rs for why this is a preference).
            devtools::prefer_detached_inspector();
            let handle = app.handle();
            // SPIKE 6c-iv-b Task 0 — throwaway. Reports real geometry and runs
            // one grow, so the arithmetic is checked against what actually
            // happened rather than what it was meant to do.
            {
                let h = handle.clone();
                std::thread::spawn(move || {
                    // 15s, not 1.5s: the owner saw flicker on the first 2-3 cycles only.
                    // That is a warm-up shape, so this run starts well past startup to
                    // tell a mechanism problem from a first-paint one.
                    std::thread::sleep(std::time::Duration::from_secs(10));
                    spike_window::log_at_startup(&h);
                    spike_window::run_cycles(&h, 30);
                });
            }
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
                // Print windows are excluded: they have no frontend, so they can
                // never ack or vote, and including one would wedge the poll
                // until the 1500ms grace timer pruned it.
                let labels: Vec<String> = app
                    .webview_windows()
                    .into_keys()
                    .filter(|l| !export::is_print_window(l))
                    .collect();
                let generation = match app.state::<window::QuitPollState>().0.lock() {
                    Ok(mut p) => p.start(labels),
                    Err(_) => return,
                };
                let _ = app.emit("menu://quit-poll", ());
                let app_timer = app.clone();
                std::thread::spawn(move || {
                    // 15s, not 1.5s: the owner saw flicker on the first 2-3 cycles only.
                    // That is a warm-up shape, so this run starts well past startup to
                    // tell a mechanism problem from a first-paint one.
                    std::thread::sleep(std::time::Duration::from_secs(10));
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
            let Some(event_name) = menu::menu_event_name(id.as_str()) else { return };
            // Delivery is by LABEL, never a broadcast: `emit_to(<label>, …)`
            // fires only that window's window-scoped listener (see MenuBridge).
            // Plain `.emit()` is global — do not use it here.
            //
            // A print window is the awkward case. It has no frontend, so it can
            // receive nothing, yet it keeps key status once its panel is
            // dismissed — which is how ⌘P (and every other command) came to be
            // silently dropped while one lingered. `route_menu_command` decides
            // what to do about that; this block only carries the decision out.
            let windows = app.webview_windows();
            let focused_print = windows
                .values()
                .find(|w| export::is_print_window(w.label()) && w.is_focused().unwrap_or(false))
                .map(|w| w.label().to_string());
            let focused_editor = windows
                .values()
                .find(|w| !export::is_print_window(w.label()) && w.is_focused().unwrap_or(false))
                .map(|w| w.label().to_string());
            // Liveness is resolved HERE, not in the policy: the remembered
            // parent may have been closed while the print window lingered.
            let parent = export::print_parent(&app).filter(|p| windows.contains_key(p));
            // Every editor window still open, for the case where the window
            // that printed has since been closed.
            let open_editors: Vec<String> = windows
                .keys()
                .filter(|l| !export::is_print_window(l))
                .cloned()
                .collect();

            let close_focused_print = || {
                if let Some(w) = focused_print.as_ref().and_then(|l| windows.get(l)) {
                    let _ = w.close();
                }
            };
            match menu::route_menu_command(
                id.as_str(),
                focused_print.as_deref(),
                parent.as_deref(),
                focused_editor.as_deref(),
                &open_editors,
            ) {
                menu::MenuRoute::ClosePrintWindow => close_focused_print(),
                menu::MenuRoute::ClearPrintWindowAndDeliver(to) => {
                    close_focused_print();
                    // Hand key status back explicitly rather than leaving it to
                    // whatever macOS promotes next, so the window that is about
                    // to act on the command is the one the user is looking at.
                    if let Some(w) = windows.get(&to) {
                        let _ = w.set_focus();
                    }
                    let _ = app.emit_to(to.as_str(), event_name, ());
                }
                menu::MenuRoute::Deliver(to) => {
                    let _ = app.emit_to(to.as_str(), event_name, ());
                }
                menu::MenuRoute::Drop => {}
            }
        })
        .manage(export::PrintParent::default())
        .invoke_handler(tauri::generate_handler![
            fs::read_text_file,
            fs::write_text_file_atomic,
            fs::read_folder,
            fs::path_exists,
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
            watcher::watcher_available,
            settings::get_settings,
            settings::set_theme,
            menu::sync_view_menu,
            export::print_html,
            spike_window::spike_geometry
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
                // Quit when the last EDITOR window closes (macOS otherwise keeps
                // a windowless app alive). A lingering print window must not
                // hold the app open — it carries no document and no unsaved
                // work — so it is not counted here, and it dies with the
                // process when the app exits.
                let editors_left = app_handle
                    .webview_windows()
                    .into_keys()
                    .any(|l| !export::is_print_window(&l));
                if !editors_left {
                    app_handle.exit(0);
                }
            }
        });
}
