//! Owns the Bun server process and the window that shows it.
//!
//! The shell is the config authority in production: it resolves every value and
//! hands it to the sidecar in the spawn environment. The sidecar takes an
//! ephemeral port because a fixed one can already be in use by another copy of
//! the app, and the real port is read back from the ready line on stdout.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Must stay in step with `READY_LINE_PREFIX` in `src/server/server.ready.ts`.
const READY_LINE_PREFIX: &str = "noc-ready ";
/// The `externalBin` entry in `tauri.conf.json`, without its path or triple.
const SIDECAR_NAME: &str = "noc-server";

pub const WALL_WINDOW_LABEL: &str = "wall";
const WALL_WINDOW_TITLE: &str = "NOC wall";
const WALL_WIDTH: f64 = 1440.0;
const WALL_HEIGHT: f64 = 900.0;

const DEFAULT_HOST: &str = "127.0.0.1";
/// `0` asks the OS for a free port. See the module comment.
const EPHEMERAL_PORT: &str = "0";

/// Kept so an orderly quit can release the port at once. It is not the thing
/// that prevents orphans — the sidecar watches our pid for that, because a
/// force-quit or a crash never reaches this code.
#[derive(Default)]
pub struct SidecarProcess {
    child: Mutex<Option<CommandChild>>,
    /// Set once we ask it to stop, so its exit is not reported as a failure.
    stopping: AtomicBool,
}

fn sidecar_env() -> HashMap<String, String> {
    let mut env = HashMap::new();
    env.insert(
        "NOC_HOST".to_string(),
        std::env::var("NOC_HOST").unwrap_or_else(|_| DEFAULT_HOST.to_string()),
    );
    env.insert(
        "NOC_PORT".to_string(),
        std::env::var("NOC_PORT").unwrap_or_else(|_| EPHEMERAL_PORT.to_string()),
    );
    env.insert("NOC_PARENT_PID".to_string(), std::process::id().to_string());
    // Operator overrides are passed through; the sidecar validates them.
    for key in ["NOC_DATA_DIR", "NOC_LOG_LEVEL"] {
        if let Ok(value) = std::env::var(key) {
            env.insert(key.to_string(), value);
        }
    }
    env
}

/// Spawns the sidecar and opens the wall window once it reports its origin.
pub fn start(app: AppHandle) -> Result<(), String> {
    let command = app
        .shell()
        .sidecar(SIDECAR_NAME)
        .map_err(|error| format!("Cannot resolve the {SIDECAR_NAME} sidecar: {error}"))?
        .envs(sidecar_env());

    let (mut events, child) = command
        .spawn()
        .map_err(|error| format!("Cannot start the {SIDECAR_NAME} sidecar: {error}"))?;

    if let Ok(mut slot) = app.state::<SidecarProcess>().child.lock() {
        *slot = Some(child);
    }

    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => on_stdout(&app, &String::from_utf8_lossy(&bytes)),
                CommandEvent::Stderr(bytes) => {
                    eprintln!("[noc-server] {}", String::from_utf8_lossy(&bytes).trim_end());
                }
                CommandEvent::Error(error) => {
                    fail(&app, &format!("The sidecar failed: {error}"));
                }
                CommandEvent::Terminated(status) => {
                    if app.state::<SidecarProcess>().stopping.load(Ordering::SeqCst) {
                        return;
                    }
                    // Still running but with no server: every pane would go dead,
                    // so there is nothing useful left to show.
                    fail(&app, &format!("The sidecar exited: {status:?}"));
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// Kills the sidecar on an orderly quit. Safe to call more than once.
pub fn stop(app: &AppHandle) {
    let state = app.state::<SidecarProcess>();
    state.stopping.store(true, Ordering::SeqCst);
    // Taken out of the lock before use, so the guard is not held across the kill.
    let child = state.child.lock().ok().and_then(|mut slot| slot.take());
    if let Some(child) = child {
        if let Err(error) = child.kill() {
            eprintln!("Could not stop the sidecar: {error}");
        }
    }
}

fn on_stdout(app: &AppHandle, chunk: &str) {
    for line in chunk.lines() {
        match line.trim().strip_prefix(READY_LINE_PREFIX) {
            Some(url) => open_wall(app, url.trim()),
            None => println!("[noc-server] {line}"),
        }
    }
}

fn open_wall(app: &AppHandle, url: &str) {
    if app.get_webview_window(WALL_WINDOW_LABEL).is_some() {
        // A reloaded sidecar re-announces itself; the window already points at it.
        return;
    }

    let parsed = match url.parse::<tauri::Url>() {
        Ok(parsed) => parsed,
        Err(error) => {
            fail(app, &format!("The sidecar announced \"{url}\": {error}"));
            return;
        }
    };

    let handle = app.clone();
    // Windows must be built on the main thread; this runs on the async runtime.
    let dispatched = app.run_on_main_thread(move || {
        let built = WebviewWindowBuilder::new(
            &handle,
            WALL_WINDOW_LABEL,
            WebviewUrl::External(parsed.clone()),
        )
        .title(WALL_WINDOW_TITLE)
        .inner_size(WALL_WIDTH, WALL_HEIGHT)
        .build();

        match built {
            // The wall is the app's only window, and the process is started
            // without being activated. Without this the window is created on
            // whatever Space the launch inherited and stays there, off screen,
            // with no way for the user to find it but the Dock.
            Ok(window) => {
                if let Err(error) = window.set_focus() {
                    eprintln!("Could not bring the wall window forward: {error}");
                }
            }
            Err(error) => fail(&handle, &format!("Cannot open the wall window: {error}")),
        }
    });

    if let Err(error) = dispatched {
        fail(app, &format!("Cannot reach the main thread: {error}"));
    }
}

/// There is no usable app without the wall, so a failure here is terminal
/// rather than a blank window with no explanation.
fn fail(app: &AppHandle, message: &str) {
    eprintln!("{message}");
    stop(app);
    app.exit(1);
}
