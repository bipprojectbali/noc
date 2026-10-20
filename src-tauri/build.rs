// The wall page is served over http by the sidecar, so to Tauri it is a remote
// origin, and a remote origin reaches no command the ACL does not name. Listing
// the commands here is what generates the `allow-*` permissions that
// `capabilities/default.json` grants. Without it every `invoke` is refused with
// "not allowed. Plugin not found" and no pane webview is ever created.
const COMMANDS: &[&str] = &[
    "pane_webview_show",
    "pane_webview_place",
    "pane_webview_close",
    "cookie_import",
];

fn main() {
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
