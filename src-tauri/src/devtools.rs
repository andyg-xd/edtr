//! Web Inspector presentation defaults (macOS).
//!
//! # Why this exists
//!
//! With the `devtools` feature on, the release build gets a Web Inspector —
//! but WebKit opens it **docked into the webview**. On a window sized for a
//! short Markdown file that leaves Edtr's own content invisible behind the
//! inspector, and recovering means knowing to click the inspector's own
//! undock control. That is not a thing to require of whoever we hand a build
//! to.
//!
//! # Why it is a preference and not an API call
//!
//! The obvious fix would be to detach right after opening the inspector, but
//! there is no call site to hook: the common gesture is **right-click →
//! Inspect Element**, which is WebKit's OWN context menu. Our code never runs
//! for it, and neither does wry's `open_devtools()`
//! (`wry/src/wkwebview/mod.rs:900`, which sends `show` to the private
//! `_inspector` object). A fix hung off that function would work for a menu
//! item we add and silently miss the gesture people actually use.
//!
//! A preference applies however the inspector is opened, which is why this is
//! the shape that works.
//!
//! # Why `registerDefaults` and not a write
//!
//! `registerDefaults:` supplies a fallback that is consulted only when the
//! user has no persisted value of their own. So Edtr's preferred
//! presentation applies out of the box, and anyone who deliberately docks the
//! inspector keeps it docked forever after — WebKit persists that choice and
//! it takes precedence over anything registered here. A plain
//! `setBool:forKey:` would silently overwrite that choice on every launch.
//!
//! # Stability
//!
//! `__WebInspectorPageGroupLevel1__.WebKit.InspectorStartsAttached` is a
//! private, undocumented WebKit preference key, verified by hand against this
//! app's own bundle identifier before this code was written. If a future OS
//! renames or drops it, **the failure mode is benign**: the key stops
//! matching, nothing reads it, and the inspector opens docked exactly as it
//! did before this module existed. Nothing else depends on it.

/// Ask WebKit to open the Web Inspector in its own window rather than docked.
///
/// No-op off macOS.
///
/// **Gated on the platform ONLY, deliberately.** The first version of this
/// also required `any(debug_assertions, feature = "devtools")`, mirroring how
/// tauri and wry gate their own inspector calls. That was wrong in a way that
/// compiled cleanly and would have shipped dead: `feature = "devtools"` names
/// a feature of THIS crate, and `edtr` has none — tauri's feature of that name
/// is a different crate's. In a release build `debug_assertions` is off too,
/// so the whole condition was false and the no-op below compiled **in exactly
/// the build this was written for**. `cargo`'s `unexpected_cfgs` warning
/// caught it; nothing else would have, which makes it the same species as the
/// ⌥⌘F defect (6c-i-b) — plausible code, green build, does nothing.
///
/// Registering a fallback costs nothing where no inspector exists: it puts one
/// key in a defaults dictionary that nothing then reads. That is cheaper than
/// a second knob to keep in sync, which is what created the bug.
#[cfg(target_os = "macos")]
pub fn prefer_detached_inspector() {
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSDictionary, NSNumber, NSString, NSUserDefaults};

    let key = NSString::from_str("__WebInspectorPageGroupLevel1__.WebKit.InspectorStartsAttached");
    let value = NSNumber::numberWithBool(false);
    let value_obj: &AnyObject = &value;
    let registration = NSDictionary::<NSString, AnyObject>::from_slices(&[&*key], &[value_obj]);

    // SAFETY: `registerDefaults:` requires the dictionary's keys to be strings
    // and its values to be property-list types. Both hold here by
    // construction — one NSString key, one NSNumber value — and the
    // dictionary is built immediately above rather than taken from a caller.
    unsafe { NSUserDefaults::standardUserDefaults().registerDefaults(&registration) };
}

/// Not macOS: nothing to arrange.
#[cfg(not(target_os = "macos"))]
pub fn prefer_detached_inspector() {}
