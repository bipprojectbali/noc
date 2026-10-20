//! One native child webview per pane.
//!
//! A child webview loads its URL as a top-level document, so `X-Frame-Options`
//! and CSP `frame-ancestors` do not apply to it — that is the reason this shell
//! exists. The cost is that it is an OS-level view, not a DOM node: it always
//! paints above the web layer and ignores CSS clipping, so the wall positions it
//! explicitly and never tries to draw anything on top of it.
//!
//! A webview is created once per pane and then only moved, hidden or navigated.
//! Destroying and rebuilding one would reload the page, which is the single
//! thing the wall's design exists to prevent.
//!
//! Camera and microphone need nothing here, and that is worth writing down
//! because the obvious guess is wrong. wry 0.57 implements WKUIDelegate's
//! `webView:requestMediaCapturePermissionForOrigin:…`, and when no permission
//! handler is registered it answers `WKPermissionDecision::Grant`
//! (`wry/src/wkwebview/class/wry_web_view_ui_delegate.rs`). Tauri only installs
//! a handler if the app sets one, so a plain `WebviewBuilder` already allows
//! capture. What blocks it is one layer lower: without the usage strings in
//! `src-tauri/Info.plist` macOS hands the process no devices at all, and the
//! page reports "device not found" rather than a refusal.
//!
//! The consequence of that default is that a pane gets the camera without
//! asking anyone. If that is ever not wanted, the knob is
//! `tauri::Builder::on_permission_request` in `main.rs` — returning
//! `PermissionResponse::Default` leaves the decision to WebKit's own prompt.
//! Not done here: nobody has yet seen whether WKWebView renders that prompt in
//! a child webview, and guessing wrong turns a silent grant into a silent deny.

use serde::Deserialize;
use tauri::webview::WebviewBuilder;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Position, Rect, Size, Webview, WebviewUrl,
    Window, Wry,
};

use crate::sidecar::WALL_WINDOW_LABEL;

const PANE_LABEL_PREFIX: &str = "pane-";

/// Logical pixels, relative to the wall window's content area — which is what
/// the web layer's `getBoundingClientRect` already reports.
#[derive(Deserialize, Clone, Copy)]
pub struct PaneRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl PaneRect {
    /// `chrome` is the window's title bar height, see `chrome_height`.
    fn position(self, chrome: f64) -> LogicalPosition<f64> {
        LogicalPosition::new(self.x, self.y + chrome)
    }

    fn size(self) -> LogicalSize<f64> {
        LogicalSize::new(self.width, self.height)
    }

    fn bounds(self, chrome: f64) -> Rect {
        Rect {
            position: Position::Logical(self.position(chrome)),
            size: Size::Logical(self.size()),
        }
    }
}

/// How much of the window's content area the title bar covers, in logical
/// pixels. The page's own origin starts below it, a child webview's does not.
///
/// Tauri's default macOS title bar style asks for `fullSizeContentView`, so the
/// content view reaches up behind the title bar: measured here, a frame 875 tall
/// has a content view 875 tall and a `contentLayoutRect` of 847. The page is
/// pushed below the bar because WebKit honours the safe area, but wry places a
/// child webview in raw content-view coordinates — so a rect the page measured
/// lands one title bar too high, over the pane's own URL bar.
///
/// The earlier attempt at this used `outer_size - inner_size`, which is 0 here
/// precisely because the content view already spans the frame. `contentLayoutRect`
/// is the part of it the title bar leaves alone, and is the one number that is
/// non-zero. It is 0 on a window without that style, which is what we want.
#[cfg(target_os = "macos")]
fn chrome_height(window: &Window<Wry>) -> Result<f64, String> {
    use objc2_app_kit::NSWindow;

    let ns_window = window
        .ns_window()
        .map_err(|error| format!("Cannot reach the wall window: {error}"))?
        as *const NSWindow;
    // Tauri hands us the window it owns, and commands run on the main thread,
    // which is the only one allowed to read AppKit geometry.
    let ns_window = unsafe { &*ns_window };
    let content = ns_window
        .contentView()
        .ok_or_else(|| "The wall window has no content view".to_string())?;
    let layout = ns_window.contentLayoutRect();
    let covered = content.frame().size.height - (layout.origin.y + layout.size.height);
    Ok(covered.max(0.0))
}

/// Elsewhere a child webview is already placed from the client area, so the
/// page's origin and the webview's origin are the same point.
#[cfg(not(target_os = "macos"))]
fn chrome_height(_window: &Window<Wry>) -> Result<f64, String> {
    Ok(0.0)
}

/// Pane ids come from the wall page, which is loaded over http. Restricting the
/// label alphabet keeps a malformed id from reaching the window system.
fn pane_label(pane_id: &str) -> Result<String, String> {
    let valid = !pane_id.is_empty()
        && pane_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !valid {
        return Err(format!("Pane id \"{pane_id}\" is not a usable webview label"));
    }
    Ok(format!("{PANE_LABEL_PREFIX}{pane_id}"))
}

fn wall_window(app: &AppHandle) -> Result<Window<Wry>, String> {
    app.get_window(WALL_WINDOW_LABEL)
        .ok_or_else(|| "The wall window is not open".to_string())
}

fn pane_webview(app: &AppHandle, label: &str) -> Option<Webview<Wry>> {
    app.webviews().get(label).cloned()
}

fn parse_url(pane_id: &str, url: &str) -> Result<tauri::Url, String> {
    url.parse::<tauri::Url>()
        .map_err(|error| format!("Pane {pane_id} was given \"{url}\": {error}"))
}

/// Creates the pane's webview at `rect`, or navigates the existing one.
///
/// The caller only sends this when the pane's own URL changes, never on a
/// geometry change: navigating on every move would reload the page, and would
/// also undo wherever the user had browsed to inside the pane.
#[tauri::command]
pub fn pane_webview_show(
    app: AppHandle,
    pane_id: String,
    url: String,
    rect: PaneRect,
) -> Result<(), String> {
    let label = pane_label(&pane_id)?;
    let target = parse_url(&pane_id, &url)?;

    if let Some(webview) = pane_webview(&app, &label) {
        webview
            .navigate(target)
            .map_err(|error| format!("Pane {pane_id} could not navigate: {error}"))?;
        return place(&webview, &pane_id, rect, true);
    }

    let window = wall_window(&app)?;
    let chrome = chrome_height(&window)?;
    window
        .add_child(
            WebviewBuilder::new(&label, WebviewUrl::External(target)),
            rect.position(chrome),
            rect.size(),
        )
        .map_err(|error| format!("Pane {pane_id} could not get a webview: {error}"))?;
    Ok(())
}

/// Moves the pane's webview and sets whether it is on screen.
///
/// Hiding is not destroying: the page keeps running and keeps its state. A pane
/// with no URL has no webview yet, which is not an error — there is simply
/// nothing to place.
#[tauri::command]
pub fn pane_webview_place(
    app: AppHandle,
    pane_id: String,
    rect: PaneRect,
    visible: bool,
) -> Result<(), String> {
    let label = pane_label(&pane_id)?;
    let Some(webview) = pane_webview(&app, &label) else {
        return Ok(());
    };
    place(&webview, &pane_id, rect, visible)
}

/// Destroys the pane's webview. Only a deleted pane should ever reach this.
#[tauri::command]
pub fn pane_webview_close(app: AppHandle, pane_id: String) -> Result<(), String> {
    let label = pane_label(&pane_id)?;
    let Some(webview) = pane_webview(&app, &label) else {
        return Ok(());
    };
    webview
        .close()
        .map_err(|error| format!("Pane {pane_id} could not be closed: {error}"))
}

fn place(
    webview: &Webview<Wry>,
    pane_id: &str,
    rect: PaneRect,
    visible: bool,
) -> Result<(), String> {
    let chrome = chrome_height(&webview.window())?;
    webview
        .set_bounds(rect.bounds(chrome))
        .map_err(|error| format!("Pane {pane_id} could not be placed: {error}"))?;
    let shown = if visible { webview.show() } else { webview.hide() };
    shown.map_err(|error| format!("Pane {pane_id} could not change visibility: {error}"))
}
