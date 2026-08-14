//! SPIKE — 6c-iii export-to-PDF feasibility. **Delete before the phase ships.**
//!
//! Answers the two questions the design rests on, and nothing else:
//!
//! 1. Does `NSPrintSaveJob` + `NSPrintJobSavingURL` on a WKWebView render the
//!    WHOLE document, or only the visible viewport? The design assumes whole.
//! 2. Does an OFFSCREEN window paginate correctly before it has ever been
//!    shown? The design never shows this window to the user.
//!
//! Triggered by `EDTR_PDF_SPIKE=<output.pdf>`; does nothing otherwise, so a
//! normal run is unaffected.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// `on_page_load` fires more than once (start AND finish, at minimum). Without
/// this the spike started two concurrent print operations against the same
/// output URL — which is a bug in the spike, not a finding about WebKit, and
/// it masked the real question on the first run.
static PRINTED: AtomicBool = AtomicBool::new(false);

/// Multi-page fixture with countable, checkable landmarks: if only the
/// viewport prints, the PDF will hold page 1 and none of the rest.
const PAGES: usize = 5;

fn fixture_html() -> String {
    let blocks: String = (1..=PAGES)
        .map(|i| {
            format!(
                "<section><h1>PAGE-MARKER-{i}</h1><p>Body text for marker {i}. \
                 {filler}</p></section>",
                filler = "Lorem ipsum dolor sit amet. ".repeat(40),
            )
        })
        .collect();
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>spike</title>\
         <style>@page{{size:letter;margin:18mm}}\
         body{{font:12pt/1.5 -apple-system,serif;margin:0}}\
         section{{break-after:page;page-break-after:always}}\
         section:last-child{{break-after:auto;page-break-after:auto}}</style>\
         </head><body>{blocks}</body></html>"
    )
}

/// Print `webview`'s content to `out_path` as a PDF, with no panel.
///
/// Uses a FRESH `NSPrintInfo` rather than `sharedPrintInfo` — wry mutates the
/// shared one (and zeroes its margins), and the shared instance persists for
/// the process, so borrowing it would let printing and exporting corrupt each
/// other's settings.
#[cfg(target_os = "macos")]
fn print_to_pdf(webview_ptr: *mut std::ffi::c_void, out_path: &str) -> bool {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSPrintInfo, NSPrintJobSavingURL, NSPrintOperation, NSPrintSaveJob};
    use objc2_foundation::{NSMutableDictionary, NSString, NSURL};

    unsafe {
        let webview = &*(webview_ptr as *mut AnyObject);

        let info = NSPrintInfo::new();
        info.setJobDisposition(NSPrintSaveJob);

        let url = NSURL::fileURLWithPath(&NSString::from_str(out_path));
        let dict: Retained<NSMutableDictionary<NSString>> = info.dictionary();
        let key = objc2::runtime::ProtocolObject::from_ref(NSPrintJobSavingURL);
        dict.setObject_forKey(&*url, key);

        let op: Option<Retained<NSPrintOperation>> =
            objc2::msg_send![webview, printOperationWithPrintInfo: &*info];
        let Some(op) = op else { return false };
        op.setShowsPrintPanel(false);
        op.setShowsProgressPanel(false);
        op.runOperation()
    }
}

pub fn maybe_run(app: &AppHandle) {
    let Ok(out) = std::env::var("EDTR_PDF_SPIKE") else { return };
    let html_path = std::env::temp_dir().join("edtr-pdf-spike.html");
    if std::fs::write(&html_path, fixture_html()).is_err() {
        eprintln!("SPIKE: could not write fixture");
        return;
    }
    // Isolation: does the runaway come from the print call, or from what was
    // loaded? WebviewUrl::App serves the app's own page through Tauri's
    // protocol, which is known to load.
    let use_app_url = std::env::var("EDTR_PDF_SPIKE_APPURL").is_ok();
    let target = if use_app_url {
        WebviewUrl::App("index.html".into())
    } else {
        let Ok(url) = tauri::Url::parse(&format!("file://{}", html_path.display())) else {
            eprintln!("SPIKE: bad file url");
            return;
        };
        WebviewUrl::External(url)
    };
    eprintln!("SPIKE: loading {}", if use_app_url { "app index.html" } else { "file:// fixture" });

    let app2 = app.clone();
    let out2 = out.clone();
    let res = WebviewWindowBuilder::new(app, "pdf-spike", target)
        .title("spike")
        .inner_size(816.0, 1056.0) // US Letter at 96dpi, so viewport ≈ one page
        .visible(std::env::var("EDTR_PDF_SPIKE_VISIBLE").is_ok()) // question 2, isolated
        .on_page_load(move |_wv, payload| {
            eprintln!("SPIKE: page_load event={:?} url={}", payload.event(), payload.url());
            if PRINTED.swap(true, Ordering::SeqCst) { return; }
            let app3 = app2.clone();
            let out3 = out2.clone();
            // Give WebKit a beat to lay out before asking it to paginate.
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1200));
                let Some(win) = app3.get_webview_window("pdf-spike") else { return };
                let out4 = out3.clone();
                let _ = win.with_webview(move |wv| {
                    #[cfg(target_os = "macos")]
                    {
                        let ok = print_to_pdf(wv.inner(), &out4);
                        eprintln!("SPIKE: runOperation -> {ok}");
                    }
                });
                std::thread::sleep(std::time::Duration::from_millis(2000));
                eprintln!("SPIKE: done");
                app3.exit(0);
            });
        })
        .build();
    if let Err(e) = res {
        eprintln!("SPIKE: window build failed: {e}");
    }
}
