//! The Content-Security-Policy is a backstop, not the fix: the 2026-09-29
//! export defect was closed by parsing pages in an inert document. What this
//! guards is that a page's code, if some future route lets it into Edtr's own
//! document again, still cannot run there — and so cannot reach the commands,
//! which accept any path.

#[cfg(test)]
mod tests {
    use serde_json::Value;

    fn security() -> Value {
        let raw = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json"),
        )
        .expect("tauri.conf.json must be readable");
        let conf: Value = serde_json::from_str(&raw).expect("tauri.conf.json must be valid JSON");
        conf["app"]["security"].clone()
    }

    fn directive(policy: &Value, name: &str) -> String {
        policy[name]
            .as_str()
            .unwrap_or_else(|| panic!("the policy must state `{name}` explicitly"))
            .to_string()
    }

    #[test]
    fn a_content_security_policy_is_set() {
        assert!(
            security()["csp"].is_object(),
            "`csp` must be a policy, not null — null lets any page code that reaches Edtr's document run"
        );
    }

    #[test]
    fn page_code_cannot_run_in_edtr() {
        let csp = security()["csp"].clone();
        let script = directive(&csp, "script-src");
        assert!(!script.contains("'unsafe-inline'"), "inline scripts and on* handlers must stay blocked: {script}");
        assert!(!script.contains("'unsafe-eval'"), "eval must stay blocked: {script}");
        assert!(!script.contains("http:") && !script.contains("https:"), "no remote scripts: {script}");
        assert_eq!(directive(&csp, "object-src"), "'none'");
        assert_eq!(directive(&csp, "base-uri"), "'none'");
        assert_eq!(directive(&csp, "frame-src"), "'none'");
    }

    #[test]
    fn a_documents_own_styling_still_applies() {
        // HTML Live renders the file's own <style> and style="" attributes.
        let csp = security()["csp"].clone();
        assert!(directive(&csp, "style-src").contains("'unsafe-inline'"));
        // Tauri otherwise adds hashes to style-src, and a hash makes browsers
        // IGNORE 'unsafe-inline' — every document's own styling would vanish.
        let untouched = security()["dangerousDisableAssetCspModification"].clone();
        assert!(
            untouched.as_array().is_some_and(|a| a.iter().any(|v| v == "style-src")),
            "Tauri must be told not to add hashes to style-src"
        );
    }

    #[test]
    fn local_pictures_and_the_command_channel_are_reachable() {
        let csp = security()["csp"].clone();
        let img = directive(&csp, "img-src");
        assert!(img.contains("asset:") && img.contains("http://asset.localhost"), "{img}");
        let connect = directive(&csp, "connect-src");
        assert!(connect.contains("ipc:") && connect.contains("http://ipc.localhost"), "{connect}");
        // Export reads local pictures with fetch() before embedding them.
        assert!(connect.contains("asset:") && connect.contains("http://asset.localhost"), "{connect}");
    }

    #[test]
    fn the_print_window_is_granted_no_commands() {
        // The print window shows a page Edtr did not write, from a `file://`
        // URL. Tauri 2.11 treats that origin as remote and refuses it every
        // command — app commands included — unless a capability names the
        // window or grants `remote` URLs (`tauri` webview/mod.rs, `on_message`).
        // No capability may do either.
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
        let print_label = format!("{}1-0", crate::export::PRINT_LABEL_PREFIX);
        for entry in std::fs::read_dir(&dir).expect("capabilities/ must be readable") {
            let path = entry.unwrap().path();
            let raw = std::fs::read_to_string(&path).unwrap();
            let cap: Value = serde_json::from_str(&raw).unwrap();
            let name = path.display();
            assert!(cap.get("remote").is_none(), "{name} must not grant remote URLs");
            for pattern in cap["windows"].as_array().into_iter().flatten() {
                let pattern = pattern.as_str().unwrap();
                let matches = match pattern.strip_suffix('*') {
                    Some(prefix) => print_label.starts_with(prefix),
                    None => print_label == pattern,
                };
                assert!(!matches, "{name}: window pattern `{pattern}` reaches the print window");
            }
        }
    }
}
