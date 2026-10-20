/**
 * The way back from a native pane's ⋮ to the wall page.
 *
 * A pane drawn as a native child webview cannot show the wall's own floating ⋮:
 * the webview is an OS-level view and paints above the entire web layer. So the
 * shell parks a second, 40px transparent child webview in that corner, serving
 * `server.chrome-page.ts` from this very origin, and a click there has to cross
 * back into this document.
 *
 * It crosses over a `BroadcastChannel`, and the reason is the cheapest one
 * available: both documents are same-origin — the sidecar serves them both —
 * and every pane webview shares `WKWebsiteDataStore::defaultDataStore`, so a
 * channel is already a channel between them. The alternatives all cost more.
 * A fifth `invoke` would need the chrome page to be a Tauri origin, a command
 * in `build.rs`, a permission in `capabilities`, and an `emit`/`listen` pair
 * the app has so far done without. An SSE route would need server-side state
 * for something neither side of it is on the server.
 *
 * What crosses is deliberately the smallest thing that can: a site id and the
 * word for "open your menu". No wall state goes out to that page and no
 * decision comes back from it — the chrome page cannot name a pane, cannot
 * reach the store, and cannot be told anything by anyone else that this
 * document would act on beyond opening a menu the user can close. The id is
 * checked against the pane's own sites by the caller, so a message naming
 * something this wall does not hold is dropped.
 */

import { useEffect, useRef } from "react";

import type { SiteId } from "../layout/layout.types.ts";

/** Must stay in step with `CHANNEL_NAME` in `server.chrome-page.ts`. */
export const PANE_CHROME_CHANNEL = "noc-pane-chrome";

const OPEN_MENU = "open-menu";

/**
 * What a message from a chrome webview means, or null if it means nothing.
 *
 * Pure and exported so the shape can be proven without a browser. Validated
 * rather than cast: the sender is another document, and "same origin" is a
 * reason to listen to it, not a reason to trust the shape of what it says.
 */
export function parsePaneChromeMessage(data: unknown): { siteId: SiteId } | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as { type?: unknown; siteId?: unknown };
  if (message.type !== OPEN_MENU) return null;
  if (typeof message.siteId !== "string" || message.siteId === "") return null;
  return { siteId: message.siteId };
}

/**
 * Calls `onRequest` when a pane's native ⋮ is clicked.
 *
 * The callback is held in a ref so the subscription is made once and never torn
 * down by a re-render: a pane re-renders on every store change that touches it,
 * and a channel closed and reopened in between would drop the click that caused
 * it. Absent `BroadcastChannel` is not an error — a browser without one simply
 * has no native panes either, and the wall's own ⋮ is visible there.
 */
export function usePaneChromeMenuRequests(
  onRequest: (siteId: SiteId) => void,
): void {
  const latest = useRef(onRequest);
  latest.current = onRequest;

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(PANE_CHROME_CHANNEL);
    const listener = (event: MessageEvent): void => {
      const message = parsePaneChromeMessage(event.data);
      if (message !== null) latest.current(message.siteId);
    };
    channel.addEventListener("message", listener);
    return () => {
      channel.removeEventListener("message", listener);
      channel.close();
    };
  }, []);
}
