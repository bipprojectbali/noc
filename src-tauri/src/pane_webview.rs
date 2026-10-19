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

/// Height of the window chrome above the page, in logical pixels.
///
/// The page measures its rect from below the title bar, but a child webview is
/// positioned from the window frame, which still includes the title bar. Left
/// alone, every pane would sit one title bar too high and cover the URL bar.
/// The gap is read from the window itself: the outer frame minus the content
/// area. Nothing here is a hardcoded title bar height.
fn chrome_height(window: &Window<Wry>) -> Result<f64, String> {
    let outer = window
        .outer_size()
        .map_err(|error| format!("Cannot read the wall window size: {error}"))?;
    let inner = window
        .inner_size()
        .map_err(|error| format!("Cannot read the wall window content size: {error}"))?;
    let scale = window
        .scale_factor()
        .map_err(|error| format!("Cannot read the wall window scale: {error}"))?;
    Ok(f64::from(outer.height.saturating_sub(inner.height)) / scale)
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
