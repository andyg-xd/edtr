//! ⚠️ SPIKE — 6c-iv-b Task 0. THROWAWAY. Not to be merged as-is.
//!
//! Answers, on real hardware, the questions reading the crate source cannot:
//! is `work_area` correct with the macOS menu bar and Dock, what is the actual
//! scale factor, does the position/size arithmetic land where predicted, and
//! does a maximized window behave.
//!
//! Flicker is deliberately NOT answered here — only a human watching can.

use serde::Serialize;
use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

#[derive(Debug, Serialize)]
pub struct Geometry {
    pub label: String,
    pub scale_factor: f64,
    pub is_maximized: bool,
    pub outer_pos: (i32, i32),
    pub outer_size: (u32, u32),
    pub monitor_name: Option<String>,
    pub monitor_size: (u32, u32),
    pub monitor_pos: (i32, i32),
    pub work_area_pos: (i32, i32),
    pub work_area_size: (u32, u32),
    pub monitor_count: usize,
}

fn read(win: &WebviewWindow) -> Result<Geometry, String> {
    let scale = win.scale_factor().map_err(|e| e.to_string())?;
    let pos = win.outer_position().map_err(|e| e.to_string())?;
    let size = win.outer_size().map_err(|e| e.to_string())?;
    let mon = win.current_monitor().map_err(|e| e.to_string())?;
    let all = win.available_monitors().map_err(|e| e.to_string())?;
    let m = mon.ok_or_else(|| "no current monitor".to_string())?;
    Ok(Geometry {
        label: win.label().to_string(),
        scale_factor: scale,
        is_maximized: win.is_maximized().map_err(|e| e.to_string())?,
        outer_pos: (pos.x, pos.y),
        outer_size: (size.width, size.height),
        monitor_name: m.name().cloned(),
        monitor_size: (m.size().width, m.size().height),
        monitor_pos: (m.position().x, m.position().y),
        work_area_pos: (m.work_area().position.x, m.work_area().position.y),
        work_area_size: (m.work_area().size.width, m.work_area().size.height),
        monitor_count: all.len(),
    })
}

#[tauri::command]
pub fn spike_geometry(window: WebviewWindow) -> Result<Geometry, String> {
    read(&window)
}

/// One symmetric open/close: grow by `delta_logical`, then put it back (D1).
/// Re-reads scale and maximized state EVERY call, so dragging the window to
/// another display or maximizing it mid-run is captured rather than assumed.
pub fn spike_cycle(window: &WebviewWindow, delta_logical: f64) -> Result<String, String> {
    let g = read(window)?;

    // D3: a maximized window compresses instead. Log the decision, do nothing.
    if g.is_maximized {
        return Ok(format!(
            "MAXIMIZED -> would compress (no move). scale={} pos={:?} size={:?}",
            g.scale_factor, g.outer_pos, g.outer_size
        ));
    }

    let scale = g.scale_factor;
    let delta = (delta_logical * scale).round() as i32;
    let (x, y) = g.outer_pos;
    let (w, h) = g.outer_size;
    let (wax, _) = g.work_area_pos;
    let (waw, _) = g.work_area_size;

    let room_left = x - wax;
    let room_right = (wax + waw as i32) - (x + w as i32);
    let (open_x, strategy) = if room_left >= delta {
        (x - delta, "left")
    } else if room_right >= delta {
        (x, "right")
    } else {
        (x, "compress")
    };

    if strategy == "compress" {
        return Ok(format!(
            "NO ROOM -> would compress. scale={scale} room_l={room_left} room_r={room_right}"
        ));
    }

    // OPEN: position first, then size.
    window.set_position(PhysicalPosition::new(open_x, y)).map_err(|e| e.to_string())?;
    window.set_size(PhysicalSize::new(w + delta as u32, h)).map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(900));

    // CLOSE (D1, symmetric): exact reverse.
    window.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    window.set_size(PhysicalSize::new(w, h)).map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(900));

    let after = read(window)?;
    let restored = after.outer_pos == g.outer_pos && after.outer_size == g.outer_size;
    Ok(format!(
        "grew-{strategy} scale={scale} delta_phys={delta} monitor={:?} restored_exactly={restored}",
        g.monitor_name
    ))
}

/// Log geometry once at startup so the numbers land in the dev console without
/// anyone having to drive the GUI.
pub fn log_at_startup(app: &tauri::AppHandle) {
    if let Some(win) = app.webview_windows().values().next() {
        match read(win) {
            Ok(g) => eprintln!("[SPIKE-GEOMETRY] {}", serde_json::to_string(&g).unwrap_or_default()),
            Err(e) => eprintln!("[SPIKE-GEOMETRY] error: {e}"),
        }
    }
}

/// Cycle open/close repeatedly so flicker is actually observable, and so the
/// owner can drag the window to another display or maximize it mid-run.
pub fn run_cycles(app: &tauri::AppHandle, count: u32) {
    let Some(win) = app.webview_windows().values().next().cloned() else { return };
    eprintln!("[SPIKE-CYCLES] starting {count} open/close cycles — watch for flicker");
    for i in 1..=count {
        match spike_cycle(&win, 200.0) {
            Ok(msg) => eprintln!("[SPIKE-CYCLE {i}/{count}] {msg}"),
            Err(e) => eprintln!("[SPIKE-CYCLE {i}/{count}] error: {e}"),
        }
    }
    eprintln!("[SPIKE-CYCLES] done");
}
