//! Export to PDF, by way of macOS's own print pipeline (6c-iii, D7).
//!
//! Nothing here renders a PDF. `buildExport` on the frontend has already
//! produced a standalone, self-contained HTML document; this loads it into a
//! window of its own and asks WebKit to print it, so the system print panel —
//! where "Save as PDF" lives — does the pagination. That is the whole design:
//! macOS is better at paginating a document than we would be, and the window
//! contains ONLY the document, which is why there is no app chrome to strip
//! and why this behaves identically from Code view (D6).
//!
//! **Do not re-attempt a dialog-free PDF write.** `NSPrintSaveJob` +
//! `NSPrintJobSavingURL` against the webview was spiked and rejected: the
//! operation never returned and wrote unbounded output (1.8 GB), reproduced
//! with the window visible, cause never established. The spike is preserved
//! unmerged on `spike-6c-iii-pdf` — read it before spending a day on the same
//! experiment. It is also why this file adds no Objective-C dependency.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Label prefix for every transient print window.
///
/// Load-bearing, not cosmetic: `lib.rs` matches on it to keep these windows
/// out of the atomic-quit poll and out of the "last window closed, so exit"
/// rule. A print window that could vote would wedge ⌘Q — it has no frontend
/// and so can never answer — and one that counted as the last window would
/// keep a windowless app alive.
pub const PRINT_LABEL_PREFIX: &str = "edtr-print-";

/// Distinguishes concurrent prints within one process.
///
/// The process id alone is NOT enough, which is the whole reason this counter
/// exists: two windows printing at once share a pid, so a pid-only name would
/// have them overwrite each other's temp file and collide on the window label
/// (Tauri rejects a duplicate label, so the second print would simply fail).
/// The pid is still in the name so a stale file is attributable to a run.
static PRINT_SEQ: AtomicUsize = AtomicUsize::new(0);

/// The editor window a print came from.
///
/// A print window keeps key status once its panel is dismissed, and it has no
/// frontend of its own, so a menu command arriving in that state has nowhere to
/// go unless we remember where the print started. One slot rather than a map,
/// and that is exact rather than lazy: culling guarantees at most one print
/// window exists, so there is never a second parent to remember.
#[derive(Default)]
pub struct PrintParent(pub std::sync::Mutex<Option<String>>);

/// The editor window the current print came from, if one was recorded.
///
/// The label is NOT checked for liveness here — the caller knows which windows
/// are open and is the one that can check. That split is deliberate: the policy
/// decision (`menu::route_menu_command`) stays pure and testable.
pub fn print_parent(app: &AppHandle) -> Option<String> {
    app.state::<PrintParent>().0.lock().ok().and_then(|p| p.clone())
}

/// A unique (label, temp-file path) pair for one print operation.
pub fn print_identity() -> (String, std::path::PathBuf) {
    let n = PRINT_SEQ.fetch_add(1, Ordering::Relaxed);
    let stem = format!("{PRINT_LABEL_PREFIX}{}-{n}", std::process::id());
    let path = std::env::temp_dir().join(format!("{stem}.html"));
    (stem, path)
}

/// Which of `labels` should a starting print close first?
///
/// Only ever print windows. Kept pure, and separate from the closing itself, so
/// the dangerous case is the one under test: culling an *editor* label would
/// close a user's document — unsaved work and all — without ever passing the
/// unsaved-changes guard.
pub fn labels_to_cull(labels: impl IntoIterator<Item = String>) -> Vec<String> {
    labels.into_iter().filter(|l| is_print_window(l)).collect()
}

/// Print an already-built export document through the native print panel.
///
/// The document is written to a temp file because a webview needs a URL to
/// load; the file is deleted as soon as the page has finished loading, since
/// WebKit prints from the loaded DOM and an export is self-contained (images
/// are already inlined, so nothing is fetched later).
#[tauri::command]
pub fn print_html(
    app: AppHandle,
    window: tauri::WebviewWindow,
    html: String,
) -> Result<(), String> {
    // Who asked. `window` is the CALLING window, injected by Tauri
    // (`WebviewWindow` implements `CommandArg`), so this is the editor the user
    // was looking at rather than a guess about focus.
    if !is_print_window(window.label()) {
        if let Ok(mut p) = app.state::<PrintParent>().0.lock() {
            *p = Some(window.label().to_string());
        }
    }

    // At most one print window can ever exist: a starting print closes the one
    // a previous print left behind (the owner's choice at Task 8's GUI gate).
    // This BOUNDS the stray window rather than removing it — nothing here can
    // tell that a panel was dismissed, and both candidate signals for that were
    // measured and refuted (see PLAN.md's debt entry) — so what it buys is that
    // print windows cannot accumulate one per print.
    //
    // The cost, taken deliberately: two prints can no longer be in flight at
    // once. A print panel is a sheet, and a sheet is window-modal rather than
    // app-modal, so a user genuinely can click back to a document and print
    // again while the first panel is still up; that first panel now goes away
    // with its window.
    let open = app.webview_windows();
    for label in labels_to_cull(open.keys().cloned()) {
        if let Some(w) = open.get(&label) {
            let _ = w.close();
        }
    }

    let (label, path) = print_identity();
    std::fs::write(&path, html).map_err(|e| format!("Could not prepare the document: {e}"))?;

    let url = tauri::Url::parse(&format!("file://{}", path.display()))
        .map_err(|e| format!("Could not prepare the document: {e}"))?;

    // `on_page_load` fires at least twice (Started and Finished) and can fire
    // again for subframes, so the event is matched AND latched. The spike
    // proved starting two print operations against one document is a real
    // hazard rather than a theoretical one.
    let printed = Arc::new(AtomicBool::new(false));
    let temp = path.clone();

    // VISIBLE, deliberately, and not what the plan specified. wry implements
    // `print()` as `runOperationModalForWindow:` — the print panel is a SHEET
    // attached to this window (wry-0.55.1 `wkwebview/mod.rs:891`). A sheet on
    // an off-screen window shows the user nothing, so a hidden window would
    // read as the app hanging. The window is transient and shows only the
    // document, which is what the gate asks the user to confirm.
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url))
        .title("Print")
        .inner_size(816.0, 1056.0) // US Letter at 96dpi — one page per viewport
        .on_page_load(move |win, payload| {
            if payload.event() != tauri::webview::PageLoadEvent::Finished {
                return;
            }
            if printed.swap(true, Ordering::SeqCst) {
                return;
            }
            // The DOM is loaded and self-contained, so the file on disk has
            // done its job. Removing it here rather than on window close means
            // it cannot outlive the process if the window is never closed.
            let _ = std::fs::remove_file(&temp);
            if let Err(e) = win.print() {
                eprintln!("print failed: {e}");
                let _ = win.close();
            }
        })
        .build()
        .map_err(|e| format!("Could not open the print view: {e}"))?;

    Ok(())
}

/// Is `label` one of our transient print windows?
pub fn is_print_window(label: &str) -> bool {
    label.starts_with(PRINT_LABEL_PREFIX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_print_gets_its_own_label_and_path() {
        // The property the pid alone cannot provide. Two prints in ONE process
        // share a pid, so a pid-only name would collide: same temp file, and a
        // duplicate window label that Tauri rejects outright.
        let (label_a, path_a) = print_identity();
        let (label_b, path_b) = print_identity();
        assert_ne!(label_a, label_b, "two prints must not share a window label");
        assert_ne!(path_a, path_b, "two prints must not share a temp file");
    }

    #[test]
    fn the_label_and_the_temp_file_agree() {
        // `lib.rs` recognises a print window by its label prefix, and the temp
        // file is named from the same stem. If these ever drift apart, the
        // quit-poll exclusion silently stops matching.
        let (label, path) = print_identity();
        assert!(is_print_window(&label), "{label} must be recognised as a print window");
        assert_eq!(path.file_name().unwrap().to_string_lossy(), format!("{label}.html"));
    }

    #[test]
    fn the_temp_file_lands_in_the_temp_dir_and_is_named_for_this_process() {
        let (_, path) = print_identity();
        assert!(path.starts_with(std::env::temp_dir()));
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.contains(&std::process::id().to_string()), "{name} must name its process");
        assert!(name.ends_with(".html"), "{name} must be loadable as HTML");
    }

    #[test]
    fn a_starting_print_culls_every_print_window_that_is_still_open() {
        let culled = labels_to_cull(vec![
            "main".to_string(),
            "window-2".to_string(),
            "edtr-print-123-0".to_string(),
            "edtr-print-123-1".to_string(),
        ]);
        assert_eq!(culled.len(), 2, "both print windows must be culled: {culled:?}");
        assert!(culled.iter().all(|l| is_print_window(l)), "{culled:?}");
    }

    #[test]
    fn culling_never_touches_an_editor_window() {
        // Not a cosmetic guard: closing an editor window from here would
        // bypass the unsaved-changes guard completely and lose the buffer.
        let culled = labels_to_cull(vec!["main".to_string(), "window-2".to_string()]);
        assert!(culled.is_empty(), "no editor window may ever be culled: {culled:?}");
    }

    #[test]
    fn only_our_print_labels_are_recognised() {
        // An editor window must never be mistaken for a print window: that
        // would drop a real window from the quit poll and lose its vote.
        for label in ["main", "window-2", "print", "edtr-print", "edtr"] {
            assert!(!is_print_window(label), "{label} must not look like a print window");
        }
        assert!(is_print_window("edtr-print-123-0"));
    }
}
