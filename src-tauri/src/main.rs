// The release build must not open a console window on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cookie_import;
mod pane_webview;
mod sidecar;

use tauri::{Manager, RunEvent};

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            pane_webview::pane_webview_show,
            pane_webview::pane_webview_place,
            pane_webview::pane_webview_close,
            cookie_import::cookie_import,
        ])
        .setup(|app| {
            app.manage(sidecar::SidecarProcess::default());
            // Outlives the wall page, which is the whole point of it.
            app.manage(pane_webview::PaneNavigations::default());
            // The window is opened by the sidecar watcher, once the server has
            // announced the port it actually bound.
            sidecar::start(app.handle().clone())?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("the NOC shell could not start");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            sidecar::stop(handle);
        }
    });
}
