//! What the shipped bundle must declare (6b).
//!
//! These are facts about the artifact recipients receive, and nothing in the
//! build compares them against intent — a wrong value produces a bundle that
//! builds cleanly and is wrong in someone else's hands, which is the worst
//! place to discover it. The 570px window floor drifted for a month in exactly
//! that way, so these read the real files and assert.

#[cfg(test)]
mod tests {
    use serde_json::Value;

    fn conf() -> Value {
        let raw = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json"),
        )
        .expect("tauri.conf.json must be readable");
        serde_json::from_str(&raw).expect("tauri.conf.json must be valid JSON")
    }

    fn info_plist() -> String {
        std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("Info.plist"),
        )
        .expect("Info.plist must be readable")
    }

    /// D3. Tauri's default is 10.13 — a 2017 OS the app has never been near.
    /// An unverifiable claim turns into a crash for the recipient instead of a
    /// clear "needs a newer macOS", so the floor must be stated deliberately.
    ///
    /// 13.0 is where `color-mix()` (Safari 16.2) is guaranteed, which focus
    /// mode's HTML-Live dim uses (`HtmlLiveView.tsx`) along with the table
    /// chrome fade (`canvas.css`). Those degrade rather than break, so this is
    /// a fidelity floor — but a stated one beats an inherited default.
    #[test]
    fn declares_a_deliberate_minimum_macos_version() {
        let c = conf();
        let v = c["bundle"]["macOS"]["minimumSystemVersion"]
            .as_str()
            .expect("bundle.macOS.minimumSystemVersion must be set explicitly");
        assert_ne!(v, "10.13", "10.13 is Tauri's inherited default, not a decision");
        let major: u32 = v.split('.').next().unwrap().parse().expect("major version");
        assert!(major >= 13, "minimumSystemVersion {v} is below the 13.0 floor 6b settled on");
    }

    /// D2. v1 must not ship calling itself 0.1.0 — the version appears in the
    /// DMG filename, the About box and the bundle, and is far cheaper to fix
    /// before anyone holds a copy than after.
    #[test]
    fn ships_a_release_version() {
        let c = conf();
        let v = c["version"].as_str().expect("version must be a string");
        assert!(
            !v.starts_with("0."),
            "version {v} is still pre-1.0; v1 should not ship as a 0.x"
        );
    }

    /// An explicit target list rather than `"all"`, so the build states what it
    /// produces instead of sweeping up whatever the bundler supports.
    ///
    /// HONEST LIMIT, because the plan claimed more than this delivers: on macOS
    /// this changes the OUTPUT almost not at all. `bundle/share/create-dmg` is
    /// written by the DMG bundler itself, not by the target list, and it is
    /// still there after this change — verified against a universal build. The
    /// value here is that the list is now a decision, and that enabling e.g.
    /// the updater later cannot silently add artifacts. `share/` is scaffolding
    /// under `target/` and never reaches a recipient, so it is not worth
    /// fighting the bundler over.
    #[test]
    fn bundles_only_the_deliverables() {
        let c = conf();
        let t = c["bundle"]["targets"]
            .as_array()
            .expect("bundle.targets should be an explicit list, not \"all\"");
        let names: Vec<&str> = t.iter().filter_map(|x| x.as_str()).collect();
        assert!(names.contains(&"app") && names.contains(&"dmg"), "got {names:?}");
    }

    /// Modern macOS apps carry both icon keys; Tauri emits only
    /// `CFBundleIconFile`. Asserted here because it lives in a hand-maintained
    /// file that nothing else validates.
    #[test]
    fn info_plist_declares_both_icon_keys() {
        let p = info_plist();
        assert!(p.contains("CFBundleIconName"), "CFBundleIconName missing from Info.plist");
    }

    /// The document types are why this Info.plist exists at all (5b-iv-a): the
    /// `public.folder` association is what makes a folder dropped on the Dock
    /// fire `RunEvent::Opened`, and `fileAssociations` cannot express it. Pinned
    /// so an edit for an unrelated key cannot quietly cost the folder-drop.
    #[test]
    fn info_plist_still_declares_the_folder_association() {
        let p = info_plist();
        assert!(p.contains("public.folder"), "the folder UTI association was lost");
        assert!(p.contains("CFBundleDocumentTypes"), "document types were lost");
    }
}
