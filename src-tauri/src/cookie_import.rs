//! Plants exported browser cookies into the shell's WebKit cookie store.
//!
//! A pane is a child webview, and a child webview is a stranger to the browser
//! the user is already logged into: the same dashboard that needs no login in
//! Chrome asks for one again on the wall. Copying the session across is the only
//! way in that does not involve the user typing a password per pane.
//!
//! This is deliberately *not* per pane. Pane webviews are built with a plain
//! `WebviewBuilder` — no `incognito`, no `data_store_identifier` — so every one
//! of them shares `WKWebsiteDataStore::defaultDataStore`. One import therefore
//! serves the whole wall, and the wall window's own webview is as good a handle
//! on that shared store as any pane's.
//!
//! The reason this command reads the store back instead of counting what it
//! sent: `Webview::set_cookie` is fire-and-forget one layer down. Tauri posts a
//! message to the event loop and returns `Ok(())` as soon as it is queued; if
//! WebKit then refuses the cookie, tauri-runtime-wry only writes a `log::error!`
//! that no one here will ever see. A count of cookies handed over would be a
//! count of nothing. So after the writes we ask the store what it actually holds
//! and report that number.
//!
//! Two limits worth knowing before debugging a cookie that "did not arrive":
//! wry drops `SameSite=None` on macOS (it only maps Lax and Strict), and this
//! command never sends one at all — an imported cookie inherits WebKit's
//! default. Nothing here can change that short of patching wry.

use std::collections::BTreeSet;
use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use tauri::webview::cookie::time::OffsetDateTime;
use tauri::webview::cookie::{Cookie, Expiration};
use tauri::{AppHandle, Manager};

use crate::sidecar::WALL_WINDOW_LABEL;

/// One row of a browser cookie export, as the wall page parsed it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieInput {
    name: String,
    value: String,
    domain: String,
    path: String,
    secure: bool,
    http_only: bool,
    /// Unix seconds. `None` is a session cookie, which WebKit keeps until the
    /// shell quits — the same lifetime the browser gave it.
    expires: Option<i64>,
}

/// What the store held afterwards, not what we posted to it. See the module
/// comment for why the distinction is the whole point of this command.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieImportReport {
    /// How many rows the page sent, including ones rejected before WebKit.
    received: usize,
    /// How many of those were found in the cookie store on the way out.
    stored: usize,
    /// Every domain with at least one cookie missing, sorted and deduplicated,
    /// so the page can name what the user will still have to log into.
    failed_domains: Vec<String>,
}

/// Cookies are matched on this, not on identity: WebKit normalises what it
/// stores, and a domain-wide cookie comes back with or without its leading dot
/// depending on how it was written. Name, host and value are enough to say "the
/// thing we asked for is in there".
fn identity(name: &str, domain: &str, value: &str) -> (String, String, String) {
    (
        name.to_string(),
        domain.trim_start_matches('.').to_ascii_lowercase(),
        value.to_string(),
    )
}

/// WebKit builds a cookie from a property dictionary and returns nil when the
/// dictionary is unusable — and wry turns that nil into `expect`, i.e. a panic
/// that takes the whole shell down. The wall page is a remote http origin and
/// the rows come from a file the user picked, so a malformed one has to be
/// stopped here rather than reported by a crash.
fn usable(input: &CookieInput) -> bool {
    let hostile = |text: &str| text.chars().any(|c| c.is_control() || c == ';');
    !input.name.is_empty()
        && !input.domain.is_empty()
        && input.path.starts_with('/')
        && !input.name.contains('=')
        && !hostile(&input.name)
        && !hostile(&input.value)
        && !hostile(&input.domain)
        && !hostile(&input.path)
}

fn to_cookie(input: &CookieInput) -> Cookie<'static> {
    let mut builder = Cookie::build((input.name.clone(), input.value.clone()))
        .domain(input.domain.clone())
        .path(input.path.clone())
        .secure(input.secure)
        .http_only(input.http_only);
    if let Some(seconds) = input.expires {
        // An unrepresentable timestamp is not worth failing the import over;
        // the cookie simply goes in as a session cookie.
        if let Ok(at) = OffsetDateTime::from_unix_timestamp(seconds) {
            builder = builder.expires(Expiration::DateTime(at));
        }
    }
    builder.build()
}

/// Writes every cookie into the shared store, then reports how many are really
/// in it.
///
/// Async on purpose: reading the store blocks until WebKit answers, and Tauri
/// documents that doing so from a synchronous command deadlocks on Windows.
#[tauri::command]
pub async fn cookie_import(
    app: AppHandle,
    cookies: Vec<CookieInput>,
) -> Result<CookieImportReport, String> {
    let wall = app
        .get_webview_window(WALL_WINDOW_LABEL)
        .ok_or_else(|| "The wall window is not open".to_string())?;

    let received = cookies.len();
    for input in cookies.iter().filter(|input| usable(input)) {
        wall.set_cookie(to_cookie(input)).map_err(|error| {
            format!(
                "Cookie \"{}\" for {} could not be sent: {error}",
                input.name, input.domain
            )
        })?;
    }

    // Queued behind the writes above on the same event loop, so by the time this
    // is served every `set_cookie` has already run to its completion handler.
    let stored: HashSet<(String, String, String)> = wall
        .cookies()
        .map_err(|error| format!("The cookie store could not be read back: {error}"))?
        .iter()
        .map(|cookie| {
            identity(
                cookie.name(),
                cookie.domain().unwrap_or_default(),
                cookie.value(),
            )
        })
        .collect();

    let mut landed = 0usize;
    let mut failed_domains = BTreeSet::new();
    for input in &cookies {
        if stored.contains(&identity(&input.name, &input.domain, &input.value)) {
            landed += 1;
        } else {
            failed_domains.insert(input.domain.clone());
        }
    }

    Ok(CookieImportReport {
        received,
        stored: landed,
        failed_domains: failed_domains.into_iter().collect(),
    })
}
