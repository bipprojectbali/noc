/**
 * The way between a native pane's chrome and the wall page.
 *
 * A pane drawn as a native child webview cannot show the wall's own floating
 * chrome: the webview is an OS-level view and paints above the entire web layer.
 * So the shell parks a second, transparent child webview in that corner serving
 * `server.chrome-page.ts` from this very origin, and the two documents have to
 * talk — a click there has to come back here, and the pane's list of pages has
 * to go out there so the pips can say which one is showing.
 *
 * They talk over a `BroadcastChannel`, and the reason is the cheapest one
 * available: both documents are same-origin — the sidecar serves them both —
 * and every pane webview shares `WKWebsiteDataStore::defaultDataStore`, so a
 * channel is already a channel between them. The alternatives all cost more.
 * A fifth `invoke` would need the chrome page to be a Tauri origin, a command
 * in `build.rs`, a permission in `capabilities`, and an `emit`/`listen` pair
 * the app has so far done without. An SSE route would need server-side state
 * for something neither side of it is on the server.
 *
 * What crosses is deliberately the smallest thing that can: site ids, and the
 * words for "open your menu" and "show this page". No wall state goes out
 * beyond ids the chrome already belongs to, and nothing coming back is acted on
 * unless the pane holds the site it names — so a message about a pane this one
 * is not cannot move it, and a message about nothing at all is dropped.
 * Validated rather than cast throughout: the sender is another document, and
 * "same origin" is a reason to listen to it, not a reason to trust its shape.
 */

import { useEffect, useRef } from "react";

import type { PaneSite, SiteId } from "../layout/layout.types.ts";

/** Must stay in step with `CHANNEL_NAME` in `server.chrome-page.ts`. */
export const PANE_CHROME_CHANNEL = "noc-pane-chrome";

/** What a chrome webview can ask the wall for. */
export type PaneChromeRequest =
  /** It was created after the last announcement and holds no list yet. */
  | { kind: "hello"; siteId: SiteId }
  | { kind: "open-menu"; siteId: SiteId }
  | { kind: "activate"; siteId: SiteId };

/**
 * A `Map` and not an object literal: the key comes from another document, and
 * an object literal would answer `"constructor"` with a function.
 */
const REQUESTS = new Map<string, PaneChromeRequest["kind"]>([
  ["hello", "hello"],
  ["open-menu", "open-menu"],
  ["activate-site", "activate"],
]);

/**
 * What a message from a chrome webview means, or null if it means nothing.
 *
 * Pure and exported so every branch can be proven without a browser, which is
 * the only place the transport itself can be.
 */
export function parsePaneChromeRequest(data: unknown): PaneChromeRequest | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as { type?: unknown; siteId?: unknown };
  if (typeof message.type !== "string") return null;
  const kind = REQUESTS.get(message.type);
  if (kind === undefined) return null;
  if (typeof message.siteId !== "string" || message.siteId === "") return null;
  return { kind, siteId: message.siteId };
}

export type PaneChromeHandlers = {
  sites: readonly PaneSite[];
  activeId: SiteId | null;
  onOpenMenu: () => void;
  onActivate: (siteId: SiteId) => void;
};

/**
 * Answers the chrome webviews that belong to this pane, and tells them what it
 * holds.
 *
 * Both directions live in one hook because they share the one thing that makes
 * either safe: the pane's own list of sites. Outbound it is the message, and
 * inbound it is the filter — a request naming a site this pane does not hold is
 * another pane's, or nobody's, and is dropped either way.
 *
 * The handlers are held in a ref so the subscription is made once and never torn
 * down by a re-render: a pane re-renders on every store change that touches it,
 * and a channel closed and reopened in between would drop the click that caused
 * it. Absent `BroadcastChannel` is not an error — a browser without one has no
 * native panes either, and there the wall's own chrome is simply visible.
 */
export function usePaneChrome(handlers: PaneChromeHandlers): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(PANE_CHROME_CHANNEL);
    channelRef.current = channel;
    const listener = (event: MessageEvent): void => {
      const request = parsePaneChromeRequest(event.data);
      if (request === null) return;
      const current = latest.current;
      if (!current.sites.some((site) => site.id === request.siteId)) return;
      if (request.kind === "hello") announce(channel, current);
      else if (request.kind === "open-menu") current.onOpenMenu();
      else current.onActivate(request.siteId);
    };
    channel.addEventListener("message", listener);
    return () => {
      channel.removeEventListener("message", listener);
      channel.close();
      channelRef.current = null;
    };
  }, []);

  // Keyed on what the chrome actually renders, so a pane whose pages are
  // unchanged does not talk to its own corner on every store write.
  const signature = `${handlers.sites.map((site) => site.id).join()}|${handlers.activeId}`;
  useEffect(() => {
    const channel = channelRef.current;
    if (channel !== null) announce(channel, latest.current);
  }, [signature]);
}

function announce(channel: BroadcastChannel, handlers: PaneChromeHandlers): void {
  channel.postMessage({
    type: "pane-sites",
    sites: handlers.sites.map((site) => site.id),
    activeId: handlers.activeId,
  });
}
