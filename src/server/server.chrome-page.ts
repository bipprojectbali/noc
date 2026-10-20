/**
 * The ⋮ a native-webview pane wears, as its own tiny document.
 *
 * A native child webview paints above the whole web layer and ignores CSS
 * clipping, so the floating ⋮ the wall page draws in every pane's corner is not
 * dim or behind over one — it is absent. Only another OS-level view can be seen
 * there. The pane used to buy its button back with a 20px row reserved above
 * the page, and that reserved space is what made a wall of webview panes read
 * as stitched together out of boxes. So the button became a view of its own: a
 * 40px transparent child webview parked in the pane's top-right corner, created
 * after the page so that it paints above it, costing the page no height at all.
 *
 * It is served from the wall's own origin, which is the whole reason it can be
 * a webview rather than an `NSButton`: same origin means a `BroadcastChannel`
 * reaches the wall page, so this needs no access to Tauri, the shell needs no
 * fifth command, and there is still no `emit`/`listen` anywhere in the app.
 *
 * Static markup, with the pane read from the query string by the page itself.
 * Nothing from the shell is interpolated into it, so there is no injection here
 * to reason about — `src-tauri/src/pane_webview.rs` builds the address, and the
 * only thing it adds is a pane id it has already restricted to ASCII
 * alphanumerics, `-` and `_`.
 *
 * The button's styling is a copy of `.noc-pane__menu-button` in `app.css` and
 * not a share of it: a separate document cannot reach the wall's stylesheet,
 * and giving this page a build step of its own to import one would cost more
 * than the six declarations it would save. They are kept in step by eye, and
 * the only thing that must match is the geometry — 24px inset 8px from the top
 * right of a 40px box — because when every webview hides (a drag, an open menu)
 * this button is replaced by the wall's own in the same place, and a jump there
 * would read as two different buttons.
 */

/** Must stay in step with `CHROME_PATH` in `src-tauri/src/pane_webview.rs`. */
export const PANE_CHROME_PATH = "/pane-chrome";

/** Must stay in step with `PANE_CHROME_CHANNEL` in `pane.chrome-channel.ts`. */
const CHANNEL_NAME = "noc-pane-chrome";

const PANE_CHROME_BODY = `<!doctype html>
<meta charset="utf-8">
<title>NOC pane menu</title>
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden }
  button {
    position: absolute; top: 8px; right: 8px;
    display: grid; place-items: center;
    width: 24px; height: 24px; padding: 0;
    color: #f4f6fa; background: rgba(13, 15, 20, 0.82);
    border: 0; border-radius: 6px;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.24);
    font: 15px/1 system-ui, sans-serif; cursor: pointer;
    opacity: 0.35; transition: opacity 120ms ease;
  }
  button:hover, button:focus-visible { opacity: 1 }
</style>
<button type="button" title="Pane menu" aria-label="Pane menu">⋮</button>
<script>
  // This page does not decide what a click means; it says which pane was asked
  // about and lets the wall open its own menu. Right-click sends the same
  // request, because on the wall's chrome it does.
  const site = new URLSearchParams(location.search).get("site");
  const channel = new BroadcastChannel(${JSON.stringify(CHANNEL_NAME)});
  const ask = (event) => {
    event.preventDefault();
    channel.postMessage({ type: "open-menu", siteId: site });
  };
  document.querySelector("button").addEventListener("click", ask);
  document.addEventListener("contextmenu", ask);
</script>`;

export function handlePaneChrome(): Response {
  return new Response(PANE_CHROME_BODY, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
