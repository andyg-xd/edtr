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

    /// The environment a signed release build needs, and the single source of
    /// truth for it. D4 chose the app-specific-password credential over the
    /// App Store Connect API key, so `APPLE_API_KEY`/`APPLE_API_ISSUER`/
    /// `APPLE_API_KEY_PATH` are deliberately absent — the CLI reads them, but
    /// documenting a path nobody uses is how a README starts lying.
    ///
    /// Verified against the shipped CLI binary
    /// (`node_modules/@tauri-apps/cli-darwin-arm64/cli.darwin-arm64.node`),
    /// which references every name below plus `notarytool` and `stapler` —
    /// which is why this phase writes NO notarization script.
    const RELEASE_ENV: [&str; 4] =
        ["APPLE_SIGNING_IDENTITY", "APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"];

    fn readme() -> String {
        std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../README.md"),
        )
        .expect("README.md must be readable from the Rust crate")
    }

    /// Notarization REQUIRES the hardened runtime, and Tauri gives it to us by
    /// default (`tauri-utils-2.9.3/src/config.rs:655` — `default = "default_true"`).
    ///
    /// Stated anyway, for the same reason `minimumSystemVersion` is: an
    /// inherited default is not a decision, and this one is load-bearing in a
    /// way the recipient feels. If a future edit or a Tauri release flips it,
    /// the build still succeeds and notarization fails on ANOTHER machine —
    /// the certificate machine, per D5 — which is the most expensive place in
    /// this project to discover anything.
    #[test]
    fn hardened_runtime_is_stated_not_inherited() {
        let c = conf();
        let hr = &c["bundle"]["macOS"]["hardenedRuntime"];
        assert!(
            !hr.is_null(),
            "bundle.macOS.hardenedRuntime is absent, so notarization depends on a Tauri default"
        );
        assert_eq!(hr.as_bool(), Some(true), "hardenedRuntime must be true for notarization");
    }

    /// The signing identity must NOT be committed. It names a specific
    /// certificate in a specific keychain, and D5 puts that keychain on the
    /// owner's other computer — so a value here is wrong on every machine but
    /// one, and turns a missing certificate into a confusing build failure
    /// rather than an obvious unsigned build.
    ///
    /// It is supplied as `APPLE_SIGNING_IDENTITY` at build time instead.
    #[test]
    fn the_signing_identity_is_supplied_by_the_environment_not_the_repo() {
        let c = conf();
        assert!(
            c["bundle"]["macOS"]["signingIdentity"].is_null(),
            "signingIdentity is committed; it belongs in APPLE_SIGNING_IDENTITY at build time"
        );
    }

    /// "Start with none and prove it" (plan, Task 3). Edtr does its file I/O in
    /// Rust and is not sandboxed for Developer ID distribution, so it should
    /// need no entitlements — but that is a claim notarization tests, not one
    /// this project asserts. If notarization rejects the build, its log names
    /// exactly what is missing and an entitlements file is added THEN.
    ///
    /// This test exists so that adding one is a deliberate act with a reason,
    /// rather than something copied from a tutorial.
    #[test]
    fn ships_without_entitlements_until_notarization_asks_for_them() {
        let c = conf();
        assert!(
            c["bundle"]["macOS"]["entitlements"].is_null(),
            "entitlements were added; record WHY in PLAN.md, since none were needed at v1"
        );
    }

    /// ⚠️ THE RELEASE INSTRUCTIONS MUST LIVE IN THE REPO, AND THIS TEST IS WHY.
    ///
    /// `project-docs/` is deliberately never committed (global Rule 4), and D5
    /// builds the release from a FRESH CLONE on the certificate machine. So
    /// anything the build needs that lives only in `project-docs/` will simply
    /// not be there — the one moment it is needed is the one moment it is
    /// missing. The README is the only documentation that travels.
    ///
    /// Pinned to `RELEASE_ENV` rather than to prose, so adding a variable to
    /// the wiring forces the README to grow with it. Same shape as
    /// `menuCommands.contract.test.ts`, which is the only other test here that
    /// can fail because two files disagree.
    #[test]
    fn the_readme_documents_every_variable_a_signed_build_needs() {
        let r = readme();
        for var in RELEASE_ENV {
            assert!(
                r.contains(var),
                "README.md does not mention {var}, which a signed release build needs. \
                 It will not be in project-docs/ on the certificate machine — that is never cloned."
            );
        }
    }

    /// The crate version and the bundle version must agree.
    ///
    /// They diverged silently: D2 set `tauri.conf.json` to 1.0.0 and left
    /// `Cargo.toml` at 0.1.0, so a release build logged `Compiling edtr
    /// v0.1.0` for an app that ships as 1.0.0. That was inert — the bundle
    /// reads its version from the config, verified in the built app's
    /// Info.plist (`CFBundleShortVersionString` and `CFBundleVersion` both
    /// 1.0.0), and nothing in this codebase reads `CARGO_PKG_VERSION`.
    ///
    /// Pinned anyway, because the divergence is only inert while the config
    /// keeps its `version` key. Drop that key and the bundle silently falls
    /// back to the crate version — a v1 release that calls itself 0.1.0 in
    /// someone else's Applications folder.
    #[test]
    fn the_crate_version_matches_the_bundle_version() {
        let toml = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml"),
        )
        .expect("Cargo.toml must be readable");

        // The FIRST `version =` after `[package]`, so a dependency's version
        // can never be mistaken for the crate's.
        let package = toml
            .split_once("[package]")
            .expect("Cargo.toml must have a [package] section")
            .1;
        let crate_version = package
            .lines()
            .find_map(|l| l.trim().strip_prefix("version"))
            .and_then(|l| l.split('"').nth(1))
            .expect("[package] must declare a version");

        let c = conf();
        let bundle_version = c["version"].as_str().expect("version must be a string");
        assert_eq!(
            crate_version, bundle_version,
            "Cargo.toml says {crate_version} while the bundle ships {bundle_version}"
        );
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
