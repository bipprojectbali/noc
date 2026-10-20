/**
 * The chrome a native-webview pane wears, as its own tiny document.
 *
 * A native child webview paints above the whole web layer and ignores CSS
 * clipping, so the floating chrome the wall page draws in every pane's corner is
 * not dim or behind over one — it is absent. Only another OS-level view can be
 * seen there. The pane used to buy its controls back with a 20px row reserved
 * above the page, and that reserved space is what made a wall of webview panes
 * read as stitched together out of boxes. So the chrome became a view of its
 * own: an 88x40 transparent child webview parked in the pane's top-right corner,
 * created after the page so that it paints above it, costing the page no height.
 *
 * It carries the whole chrome and not only the ⋮, because the pips that say
 * which of a pane's pages is on screen are the one control that cannot wait for
 * a menu: a status nobody can see is a status nobody reads, and switching pages
 * is the gesture a multi-page pane exists for. Dropping them here would have
 * traded a cosmetic complaint for a lost feature.
 *
 * It is served from the wall's own origin, which is the whole reason it can be
 * a webview rather than an `NSButton`: same origin means a `BroadcastChannel`
 * reaches the wall page, so this needs no access to Tauri, the shell needs no
 * fifth command, and there is still no `emit`/`listen` anywhere in the app.
 *
 * Static markup. The shell interpolates nothing into it — it builds only the
 * address, and the one thing it adds there is a site id it has already
 * restricted to ASCII alphanumerics, `-` and `_`. The pane's page list arrives
 * over the channel instead, which is also why this page asks for it on load:
 * the wall announces a change, and a chrome that was created after the last
 * announcement would otherwise show nothing until the next one.
 *
 * The styling is a copy of `app.css` and not a share of it: a separate document
 * cannot reach the wall's stylesheet, and giving this page a build step of its
 * own to import one would cost more than the dozen declarations it would save.
 * They are kept in step by eye, and what must match is the geometry — the row
 * and its 8px inset — because when every webview hides this chrome is replaced
 * by the wall's own in the same rect, and a jump would read as two controls.
 */

/** Must stay in step with `CHROME_PATH` in `src-tauri/src/pane_webview.rs`. */
export const PANE_CHROME_PATH = "/pane-chrome";

/** Must stay in step with `PANE_CHROME_CHANNEL` in `pane.chrome-channel.ts`. */
const CHANNEL_NAME = "noc-pane-chrome";

/** Must stay in step with `MAX_INLINE_SITE_PIPS` in `pane.site-switcher.tsx`. */
const MAX_PIPS = 4;

const PANE_CHROME_BODY = `<!doctype html>
<meta charset="utf-8">
<title>NOC pane chrome</title>
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden }
  body {
    display: flex; align-items: center; justify-content: flex-end; gap: 4px;
    padding: 8px; box-sizing: border-box;
    font: 15px/1 system-ui, sans-serif;
  }
  #sites { display: flex; align-items: center; gap: 4px }
  button {
    padding: 0; color: #f4f6fa; background: rgba(13, 15, 20, 0.82);
    border: 0; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.24);
    font: inherit; cursor: pointer;
    opacity: 0.3; transition: opacity 120ms ease;
  }
  button:hover, button:focus-visible { opacity: 1 }
  /* Status rather than a command, so it rests legible: same split, and the same
     numbers, as the pips in app.css. */
  .pip {
    width: 8px; height: 8px; border-radius: 50%; opacity: 0.55;
  }
  .pip[data-active="true"] {
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.24),
      inset 0 0 0 3px #f4f6fa;
    opacity: 1;
  }
  .chip {
    height: 16px; padding: 0 4px; border-radius: 4px;
    font-size: 11px; font-variant-numeric: tabular-nums; opacity: 0.55;
  }
  #menu {
    display: grid; place-items: center;
    width: 24px; height: 24px; border-radius: 6px;
  }
  /* The pane is not hoverable as a whole from in here — this document only
     covers its own corner — so approaching the chrome brightens all of it,
     which is the closest thing to the wall's own .noc-pane:hover. */
  body:hover button { opacity: 1 }
</style>
<div id="sites"></div>
<button id="menu" type="button" title="Pane menu" aria-label="Pane menu">&#8942;</button>
<script>
  // This page decides nothing about the wall. It says which page was pointed at
  // and lets the wall act; the wall sends back the pane's list of pages so the
  // pips can say which one is showing. Right-click opens the menu, because on
  // the wall's own chrome it does.
  const site = new URLSearchParams(location.search).get("site");
  const channel = new BroadcastChannel(${JSON.stringify(CHANNEL_NAME)});
  const post = (type, siteId) => channel.postMessage({ type: type, siteId: siteId });
  const row = document.getElementById("sites");

  const ask = (event) => {
    event.preventDefault();
    post("open-menu", site);
  };
  document.getElementById("menu").addEventListener("click", ask);
  document.addEventListener("contextmenu", ask);

  function render(sites, activeId) {
    row.textContent = "";
    // One page is not a choice. Past ${MAX_PIPS} the pips stop being targets a
    // pointer can hit on a narrow pane, so one counting chip advances instead.
    if (sites.length < 2) return;
    if (sites.length > ${MAX_PIPS}) {
      const at = sites.indexOf(activeId);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.title = "Next page";
      chip.textContent = (at + 1) + "/" + sites.length;
      chip.addEventListener("click", () => {
        post("activate-site", sites[(at + 1) % sites.length]);
      });
      row.append(chip);
      return;
    }
    sites.forEach((id, index) => {
      const pip = document.createElement("button");
      pip.type = "button";
      pip.className = "pip";
      pip.dataset.active = String(id === activeId);
      pip.ariaLabel = "Show page " + (index + 1) + " of " + sites.length;
      pip.addEventListener("click", () => post("activate-site", id));
      row.append(pip);
    });
  }

  channel.addEventListener("message", (event) => {
    const data = event.data;
    if (data === null || typeof data !== "object") return;
    if (data.type !== "pane-sites" || !Array.isArray(data.sites)) return;
    // Every pane's chrome hears every announcement; this is the one for mine.
    if (!data.sites.includes(site)) return;
    render(data.sites, data.activeId);
  });

  // The wall announces a change, so a chrome created since the last one knows
  // nothing until it asks.
  post("hello", site);
</script>`;

export function handlePaneChrome(): Response {
  return new Response(PANE_CHROME_BODY, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
