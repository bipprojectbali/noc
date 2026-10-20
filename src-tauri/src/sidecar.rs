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
/// Named because it is both passed through and filled in; see `sidecar_env`.
const DATA_DIR_VAR: &str = "NOC_DATA_DIR";

/// Kept so an orderly quit can release the port at once. It is not the thing
/// that prevents orphans — the sidecar watches our pid for that, because a
/// force-quit or a crash never reaches this code.
#[derive(Default)]
pub struct SidecarProcess {
    child: Mutex<Option<CommandChild>>,
    /// Set once we ask it to stop, so its exit is not reported as a failure.
    stopping: AtomicBool,
}

/// Where the wall database goes when the operator did not choose a place.
///
/// The sidecar's own default is the relative `.noc-data`, and a bundled app is
/// launched by the OS with its working directory at `/`, which the sidecar
/// inherits: the database path then resolves to `/.noc-data/noc.sqlite` on the
/// read-only root volume, and the wall comes up with nothing saved and nothing
/// it can save. A relative default is right for `bun run dev`, where the
/// working directory is the project; it is a trap for every process whose
/// working directory was chosen by something else. The shell is the config
/// authority in production, so it is the shell's job to fill this in.
///
/// The directory is created here rather than left to the sidecar so a
/// permission problem is named by the shell, with the path in it, before the
/// wall is on screen. A failure is printed and the path handed over anyway: the
/// sidecar creates the directory too, and if that also fails its reason names
/// this directory rather than the baffling `/.noc-data`.
fn default_data_dir(app: &AppHandle) -> Option<String> {
    let dir = match app.path().app_data_dir() {
        Ok(dir) => dir,
        Err(error) => {
            eprintln!(
                "Cannot resolve the per-application data directory ({error}). \
                 Set NOC_DATA_DIR to a writable directory."
            );
            return None;
        }
    };

    if let Err(error) = std::fs::create_dir_all(&dir) {
        eprintln!(
            "Cannot create the data directory {} ({error}). \
             Set NOC_DATA_DIR to a writable directory.",
            dir.display()
        );
    }

    match dir.into_os_string().into_string() {
        Ok(path) => Some(path),
        // The spawn environment is UTF-8 only, and a lossy path would point at
        // the wrong directory, which is worse than saying so.
        Err(raw) => {
            eprintln!(
                "The per-application data directory {raw:?} is not valid UTF-8. \
                 Set NOC_DATA_DIR to a writable directory."
            );
            None
        }
    }
}

fn sidecar_env(app: &AppHandle) -> HashMap<String, String> {
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
    for key in [DATA_DIR_VAR, "NOC_DB_FILE", "NOC_LOG_LEVEL"] {
        // An empty value is not a choice — the sidecar reads it as unset — so
        // passing it on would only hide the fill below.
        if let Some(value) = std::env::var(key).ok().filter(|value| !value.is_empty()) {
            env.insert(key.to_string(), value);
        }
    }
    // Fills the gap without ever overruling the operator: see `default_data_dir`.
    if !env.contains_key(DATA_DIR_VAR) {
        if let Some(dir) = default_data_dir(app) {
            env.insert(DATA_DIR_VAR.to_string(), dir);
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
        .envs(sidecar_env(&app));

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
    // Asked of the window and not of `get_webview_window`, which answers None
    // once the window holds more than its own webview — and by the time a
    // sidecar re-announces itself the wall is full of pane children, so the
    // guard would have read "no wall" and tried to build a second one.
    if app.get_window(WALL_WINDOW_LABEL).is_some() {
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
