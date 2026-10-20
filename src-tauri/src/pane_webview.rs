//! Two native child webviews per pane: the page, and the ⋮ that operates it.
//!
//! A child webview loads its URL as a top-level document, so `X-Frame-Options`
//! and CSP `frame-ancestors` do not apply to it — that is the reason this shell
//! exists. The cost is that it is an OS-level view, not a DOM node: it always
//! paints above the web layer and ignores CSS clipping, so nothing the wall page
//! draws can be seen on top of one.
//!
//! That is why the pane's chrome is a webview too. The wall page draws a
//! floating ⋮ in every pane's top-right corner, and over an iframe that is all
//! it takes; over a child webview the button is not dim or behind, it is absent.
//! The alternative this replaces was a 20px row reserved above the page — space
//! the pane could not spend on content, which is what made a wall of webview
//! panes read as stitched together out of boxes. A second child webview, 40px
//! square, costs no space at all: wry appends each child with `addSubview`, so
//! creation order is paint order and a chrome created after its page sits above
//! it. It is transparent, it is same-origin with the wall page (the sidecar
//! serves it), and a click on it reaches the wall over a `BroadcastChannel` —
//! so it needs no command of its own, and the frontend→native surface stays at
//! four. See `src/pane/pane.chrome-channel.ts` for the other end.
//!
//! Everything below therefore comes in pairs: a pane that is shown, moved,
//! hidden or closed takes its chrome with it, and the frontend never learns
//! that the chrome exists. It sends one rect per pane, as it always did, and
//! the corner is derived from it here.
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

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Deserialize;
use tauri::webview::WebviewBuilder;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Position, Rect, Size, Webview, WebviewUrl,
    Window, Wry,
};

use crate::sidecar::WALL_WINDOW_LABEL;

const PANE_LABEL_PREFIX: &str = "pane-";
/// Prefixed onto the pane's own label, so the two are one lookup apart.
const CHROME_LABEL_PREFIX: &str = "chrome-";
/// Must stay in step with `PANE_CHROME_PATH` in `src/server/server.chrome-page.ts`.
const CHROME_PATH: &str = "/pane-chrome";
/// The side of the chrome webview, logical pixels.
///
/// It stands in for the floating ⋮ box the web layer draws over an iframe pane,
/// which is 40px square counting its padding — same number so that the moment
/// the webviews hide and the DOM chrome appears, the button does not move.
const CHROME_BOX: f64 = 40.0;

/// The address each pane's webview was last sent to.
///
/// This has to live in the shell rather than in the page, because the two have
/// different lifetimes: the wall page's JavaScript forgets every pane it has
/// opened each time that page reloads, while the child webviews it created go on
/// living — they are children of the window, not of the page.
///
/// Without this map the first `pane_webview_show` after a wall reload navigates
/// every pane back to the address the layout holds, throwing away wherever the
/// user had browsed to inside it. A user who had just logged in watches the pane
/// return to the login page, which is indistinguishable from a session that was
/// never kept. Remembering the last address makes a repeat `show` for the same
/// one a no-op, so only a real change of address — or an explicit request —
/// replaces the page.
#[derive(Default)]
pub struct PaneNavigations(Mutex<HashMap<String, String>>);

impl PaneNavigations {
    /// True when this pane's webview has already been sent to `url`.
    ///
    /// A lock we cannot take answers "no", which navigates: losing an address
    /// the user asked for is a visible break, where a redundant navigation is
    /// the behaviour this shell had all along.
    fn is_current(&self, label: &str, url: &str) -> bool {
        match self.0.lock() {
            Ok(map) => map.get(label).is_some_and(|last| last == url),
            Err(_) => false,
        }
    }

    fn remember(&self, label: &str, url: &str) {
        if let Ok(mut map) = self.0.lock() {
            map.insert(label.to_string(), url.to_string());
        }
    }

    /// The webview is gone, so the next `show` for this label has to open one.
    fn forget(&self, label: &str) {
        if let Ok(mut map) = self.0.lock() {
            map.remove(label);
        }
    }
}

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

    /// The corner the chrome webview occupies, or `None` when there is no room.
    ///
    /// Clamped to the pane rather than allowed to overhang it: the narrowest
    /// pane the wall will make is about 96px, but a pane mid-drag or mid-layout
    /// can measure anything at all, and a chrome wider than its own pane would
    /// sit over the neighbour and take that pane's clicks. A rect with no area
    /// has no corner — the pane is not on screen, so neither is its button.
    fn chrome_corner(self) -> Option<PaneRect> {
        let side = CHROME_BOX.min(self.width).min(self.height);
        if side <= 0.0 {
            return None;
        }
        Some(PaneRect {
            x: self.x + self.width - side,
            y: self.y,
            width: side,
            height: side,
        })
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

/// The chrome webview's own label. Derived from the pane's, which has already
/// been through `pane_label`, so the alphabet is still safe.
fn chrome_label(pane_label: &str) -> String {
    format!("{CHROME_LABEL_PREFIX}{pane_label}")
}

/// Where the chrome page lives, taken from the wall window rather than stored.
///
/// The sidecar takes an ephemeral port, so the origin is only known at runtime —
/// and asking the window for it means a sidecar that came back on another port
/// cannot leave this pointing at the old one. `pane_id` reached us through
/// `pane_label`, which allows ASCII alphanumerics, `-` and `_` only, so it needs
/// no escaping to go in a query string.
fn chrome_url(app: &AppHandle, pane_id: &str) -> Result<tauri::Url, String> {
    let wall = app
        .get_webview_window(WALL_WINDOW_LABEL)
        .ok_or_else(|| "The wall window is not open".to_string())?;
    let mut url = wall
        .url()
        .map_err(|error| format!("Cannot read the wall's own address: {error}"))?;
    url.set_path(CHROME_PATH);
    url.set_query(Some(&format!("site={pane_id}")));
    url.set_fragment(None);
    Ok(url)
}

/// Creates the pane's chrome webview if it has none yet.
///
/// Called after the page's webview, always, because that order is the paint
/// order: wry appends children with `addSubview`, so the last one created is the
/// top one. A chrome that cannot be built is reported but not fatal — a pane
/// showing its page with no ⋮ is worth more than a pane that refused to open,
/// and the wall page's own hidden ⋮ comes back as soon as a menu is opened
/// anywhere.
fn ensure_chrome(app: &AppHandle, pane_id: &str, label: &str, rect: PaneRect) {
    let label = chrome_label(label);
    if pane_webview(app, &label).is_some() {
        return;
    }
    let Some(corner) = rect.chrome_corner() else {
        return;
    };
    let built = chrome_url(app, pane_id).and_then(|url| {
        let window = wall_window(app)?;
        let offset = chrome_height(&window)?;
        window
            .add_child(
                WebviewBuilder::new(&label, WebviewUrl::External(url)).transparent(true),
                corner.position(offset),
                corner.size(),
            )
            .map_err(|error| error.to_string())
    });
    if let Err(error) = built {
        eprintln!("Pane {pane_id} could not get its chrome button: {error}");
    }
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

/// Creates the pane's webview at `rect`, or places the existing one.
///
/// The caller only sends this when the pane's own URL changes, never on a
/// geometry change: navigating on every move would reload the page, and would
/// also undo wherever the user had browsed to inside the pane.
///
/// `navigate` is how the caller says it means to replace the page — the reload
/// button, or a URL the user typed. Left unset, an existing webview that is
/// already at `url` is only placed, never navigated, because the caller cannot
/// tell a first call from a repeat one: the page that tracks which panes it has
/// opened is itself reloadable, and a reload of it would otherwise send every
/// pane back to the address the layout holds. See `PaneNavigations`.
#[tauri::command]
pub fn pane_webview_show(
    app: AppHandle,
    pane_id: String,
    url: String,
    rect: PaneRect,
    navigate: Option<bool>,
) -> Result<(), String> {
    let label = pane_label(&pane_id)?;
    let target = parse_url(&pane_id, &url)?;
    let history = app.state::<PaneNavigations>();

    if let Some(webview) = pane_webview(&app, &label) {
        if navigate == Some(true) || !history.is_current(&label, &url) {
            webview
                .navigate(target)
                .map_err(|error| format!("Pane {pane_id} could not navigate: {error}"))?;
            history.remember(&label, &url);
        }
        // Not only on the create path: a pane whose chrome failed to build, or
        // one first shown while it had no area to put a corner in, gets one here.
        ensure_chrome(&app, &pane_id, &label, rect);
        return place_pane(&app, &pane_id, &label, rect, true);
    }

    let window = wall_window(&app)?;
    let offset = chrome_height(&window)?;
    window
        .add_child(
            WebviewBuilder::new(&label, WebviewUrl::External(target)),
            rect.position(offset),
            rect.size(),
        )
        .map_err(|error| format!("Pane {pane_id} could not get a webview: {error}"))?;
    history.remember(&label, &url);
    // After the page and never before it: creation order is paint order.
    ensure_chrome(&app, &pane_id, &label, rect);
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
    if pane_webview(&app, &label).is_none() {
        return Ok(());
    }
    place_pane(&app, &pane_id, &label, rect, visible)
}

/// Destroys the pane's webview and its chrome. Only a deleted pane reaches this.
#[tauri::command]
pub fn pane_webview_close(app: AppHandle, pane_id: String) -> Result<(), String> {
    let label = pane_label(&pane_id)?;
    // Dropped before the webview is, so a pane id that comes back around (a
    // close that raced a create) cannot inherit the old address as "current".
    app.state::<PaneNavigations>().forget(&label);
    // The chrome goes first and unconditionally: left behind it would be a
    // button floating over whatever pane moves into that space, and it holds no
    // state worth keeping — it is a 40px page with one button on it.
    if let Some(chrome) = pane_webview(&app, &chrome_label(&label)) {
        if let Err(error) = chrome.close() {
            eprintln!("Pane {pane_id} could not drop its chrome button: {error}");
        }
    }
    let Some(webview) = pane_webview(&app, &label) else {
        return Ok(());
    };
    webview
        .close()
        .map_err(|error| format!("Pane {pane_id} could not be closed: {error}"))
}

/// Moves and shows the page and its chrome together.
///
/// The chrome follows the page's visibility exactly, which is what makes the
/// pointer suppressor work on it for free: a splitter drag, an open menu or a
/// pane being carried hides every pane webview, and the ⋮ has to go with them —
/// it is an OS-level view too, so a drop overlay drawn under it would be the
/// one thing on the wall it could not cover.
fn place_pane(
    app: &AppHandle,
    pane_id: &str,
    label: &str,
    rect: PaneRect,
    visible: bool,
) -> Result<(), String> {
    if let Some(chrome) = pane_webview(app, &chrome_label(label)) {
        let corner = rect.chrome_corner();
        // No corner means no area, which is already "not on screen".
        let placed = place(&chrome, pane_id, corner.unwrap_or(rect), visible && corner.is_some());
        if let Err(error) = placed {
            eprintln!("Pane {pane_id} could not place its chrome button: {error}");
        }
    }
    let Some(webview) = pane_webview(app, label) else {
        return Ok(());
    };
    place(&webview, pane_id, rect, visible)
}

fn place(
    webview: &Webview<Wry>,
    pane_id: &str,
    rect: PaneRect,
    visible: bool,
) -> Result<(), String> {
    let offset = chrome_height(&webview.window())?;
    webview
        .set_bounds(rect.bounds(offset))
        .map_err(|error| format!("Pane {pane_id} could not be placed: {error}"))?;
    let shown = if visible { webview.show() } else { webview.hide() };
    shown.map_err(|error| format!("Pane {pane_id} could not change visibility: {error}"))
}
