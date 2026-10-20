/**
 * The product path: a pane is a native child webview.
 *
 * A webview loads its URL as a top-level document, so `X-Frame-Options` and CSP
 * `frame-ancestors` never apply to it. That is the whole reason the native shell
 * exists, and it is the only way an arbitrary public site can be put on the wall.
 *
 * Three consequences shape everything here:
 *
 * - A webview is not in the DOM. It is placed in window coordinates, measured
 *   from an empty anchor box that does sit in the DOM inside the pane body. The
 *   anchor rides along with the pane host that `geometry.sync` positions, so the
 *   rect comes from the same arithmetic as the iframe path.
 * - It paints above the web layer and ignores CSS clipping. Pane chrome is
 *   therefore a sibling of the anchor, never an overlay, and toggling the URL bar
 *   resizes the anchor — a chrome toggle is a geometry event.
 * - Hiding is not destroying. `visible: false` keeps the page running; creating
 *   the webview again would reload it, which is exactly what the wall's design
 *   exists to prevent.
 *
 * One pane holds several sites, so the map below is keyed by site id and each
 * entry remembers which pane it belongs to. A site id is the webview's label in
 * the shell — which is why `layout.types` restricts the alphabet to what Rust's
 * `pane_label` accepts. The geometry layer still speaks in panes: `place` sets
 * the rect for every site of a pane at once and only the active one is shown,
 * because all of a pane's anchors occupy the same grid cell and therefore the
 * same rect. Switching sites is a visibility change and nothing else.
 */

import { createElement, useCallback, useEffect, useLayoutEffect, useRef } from "react";

import type { PaneId, SiteId } from "../layout/layout.types.ts";
import {
  nativePaneBridge,
  type NativePaneBridge,
  type NativeRect,
} from "../native/native.bridge.ts";
import {
  registerPanePointerSuppressor,
  type PanePointerSuppressor,
} from "../resize/resize.pointer-capture.ts";
import {
  paneContentTestId,
  type PaneContentProps,
  type PaneRenderer,
} from "./pane.renderer.ts";

export type AnchorRectReader = (element: HTMLElement) => NativeRect;

/**
 * Rounded to whole pixels: the shell takes logical pixels, and whole numbers
 * keep the "nothing changed" check below from firing on sub-pixel jitter during
 * a resize.
 */
export const domAnchorRect: AnchorRectReader = (element) => {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
};

type PaneEntry = {
  /** The pane this site belongs to. `place` is still addressed by pane. */
  paneId: PaneId;
  anchor: HTMLElement | null;
  /** The url last handed to the shell. A move must never re-navigate. */
  url: string | null;
  /** Whether a webview exists for this site yet. */
  opened: boolean;
  /** What the layout last asked for, independent of a drag. */
  visible: boolean;
  /** Whether this is the site its pane is showing. Siblings stay loaded. */
  active: boolean;
  /** What was last actually sent, so a drag does not flood the IPC channel. */
  sent: { rect: NativeRect; visible: boolean } | null;
};

export type PaneWebviewRenderer = PaneRenderer & {
  /**
   * The anchor box whose rect the webview is placed over, and the pane the site
   * belongs to — this is where the site learns its pane, so it must be called
   * before anything addressed by pane can reach the site.
   */
  registerAnchor: (
    paneId: PaneId,
    siteId: SiteId,
    element: HTMLElement | null,
  ) => void;
  setUrl: (siteId: SiteId, url: string | null) => void;
  /** Whether this site is the one its pane shows. */
  setActive: (siteId: SiteId, active: boolean) => void;
  /**
   * Navigates the site to the address it already has. An iframe gets this for
   * nothing — `probing` drops its `src` and putting it back fetches again — so
   * only this renderer has to be asked, and it is deliberately not on the
   * shared `PaneRenderer`.
   */
  reopen: (siteId: SiteId) => void;
  /** Re-sends geometry at the visibility the layout last asked for. */
  remeasure: (siteId: SiteId) => void;
};

export type PaneWebviewDeps = {
  bridge: NativePaneBridge;
  readRect?: AnchorRectReader;
  onError?: (message: string) => void;
};

function sameRect(a: NativeRect, b: NativeRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function hasArea(rect: NativeRect): boolean {
  return rect.width > 0 && rect.height > 0;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createPaneWebviewRenderer(deps: PaneWebviewDeps): PaneWebviewRenderer {
  const {
    bridge,
    readRect = domAnchorRect,
    onError = (message) => console.error(message),
  } = deps;

  const sites = new Map<SiteId, PaneEntry>();
  /** False for the duration of a drag. See `setCursorCapture`. */
  let capturing = true;

  function entryFor(siteId: SiteId, paneId: PaneId): PaneEntry {
    const existing = sites.get(siteId);
    if (existing !== undefined) return existing;
    const created: PaneEntry = {
      paneId,
      anchor: null,
      url: null,
      opened: false,
      visible: false,
      // A pane that holds one site never says so; only a background site is
      // ever told, and it is told before it is given a url to open.
      active: true,
      sent: null,
    };
    sites.set(siteId, created);
    return created;
  }

  function report(siteId: SiteId, what: string, error: unknown): void {
    onError(`Pane site ${siteId} could not ${what}: ${describe(error)}`);
  }

  /** Pushes the anchor's current rect, unless nothing has changed. */
  function send(siteId: SiteId, entry: PaneEntry): void {
    if (entry.anchor === null || !entry.opened) return;
    const rect = readRect(entry.anchor);
    // Every site of a pane is placed at the same rect — they share one grid
    // cell — so being the active one is the whole difference between the page
    // on screen and the pages kept warm behind it.
    const visible = entry.visible && entry.active && capturing && hasArea(rect);
    if (
      entry.sent !== null &&
      entry.sent.visible === visible &&
      sameRect(entry.sent.rect, rect)
    ) {
      return;
    }
    entry.sent = { rect, visible };
    bridge.place(siteId, rect, visible).catch((error: unknown) => {
      report(siteId, "be placed", error);
    });
  }

  /**
   * Creates the webview, or navigates it if the site already had one.
   *
   * `navigate` is what the shell needs to tell a reload apart from an open. It
   * skips a `show` that would send a webview to the address it is already on,
   * because this page forgets which sites it has opened every time it reloads
   * and would otherwise snap every pane back to the stored url, discarding
   * wherever the user had browsed to. Only an explicit reload overrides that,
   * so the default is to open without replacing anything.
   */
  function open(
    siteId: SiteId,
    entry: PaneEntry,
    url: string,
    navigate = false,
  ): void {
    const anchor = entry.anchor;
    if (anchor === null) return;
    const rect = readRect(anchor);
    entry.opened = true;
    // The shell shows a freshly created webview, so record that as sent and let
    // the follow-up correct it for a site that is docked, off screen or behind
    // one of its siblings.
    entry.sent = { rect, visible: true };
    bridge
      .show(siteId, url, rect, navigate)
      .then(() => send(siteId, entry))
      .catch((error: unknown) => {
        entry.sent = null;
        report(siteId, "open", error);
      });
  }

  function close(siteId: SiteId, entry: PaneEntry): void {
    sites.delete(siteId);
    if (!entry.opened) return;
    bridge.close(siteId).catch((error: unknown) => {
      report(siteId, "be closed", error);
    });
  }

  const renderer: PaneWebviewRenderer = {
    kind: "webview",

    Content: ({ paneId, siteId, url, active }: PaneContentProps) => {
      const anchorRef = useRef<HTMLDivElement | null>(null);

      const attach = useCallback((element: HTMLDivElement | null) => {
        anchorRef.current = element;
        renderer.registerAnchor(paneId, siteId, element);
      }, [paneId, siteId]);

      // Active first: `setUrl` is what creates the webview, and a background
      // site must already be known to be one before it exists.
      useLayoutEffect(() => {
        renderer.setActive(siteId, active);
        renderer.setUrl(siteId, url);
      }, [siteId, url, active]);

      useEffect(() => {
        const element = anchorRef.current;
        if (element === null || typeof ResizeObserver === "undefined") return;
        // Showing or hiding the URL bar resizes this box without moving the
        // pane, and the layout layer has no reason to notice that.
        const observer = new ResizeObserver(() => renderer.remeasure(siteId));
        observer.observe(element);
        return () => observer.disconnect();
      }, [siteId]);

      return createElement("div", {
        className: "noc-pane__webview-anchor",
        ref: attach,
        "data-site-id": siteId,
        "data-testid": paneContentTestId("pane-webview", paneId, siteId, active),
      });
    },

    registerAnchor: (paneId, siteId, element) => {
      const entry = entryFor(siteId, paneId);
      entry.paneId = paneId;
      entry.anchor = element;
      if (element === null) return;
      // A remount gives us a new box; nothing sent before applies to it.
      entry.sent = null;
      if (entry.url !== null && !entry.opened) {
        open(siteId, entry, entry.url);
        return;
      }
      send(siteId, entry);
    },

    setUrl: (siteId, url) => {
      const entry = sites.get(siteId);
      if (entry === undefined || entry.url === url) return;
      entry.url = url;

      if (url === null) {
        // Cleared, not deleted: hide and keep the page for the next address.
        entry.visible = false;
        send(siteId, entry);
        return;
      }
      open(siteId, entry, url);
    },

    setActive: (siteId, active) => {
      const entry = sites.get(siteId);
      if (entry === undefined || entry.active === active) return;
      entry.active = active;
      // Visibility only. Closing the webview of the site being left would
      // reload it on the way back, which is the one thing this wall exists to
      // avoid. `pane_webview_close` has exactly three callers, and every one of
      // them is discarding a document for good rather than putting it away:
      // `deletePane`, which takes every site the pane held with it;
      // `setPaneStrategy` when a pane leaves the webview renderer, because React
      // cannot drop a view that was never in the DOM; and `releaseSite` from
      // `removeSite`/`clearPane`, where that one page is thrown away while its
      // pane stays. Leaving a site is none of those — hiding is not destroying,
      // so switching sites is not a fourth caller.
      send(siteId, entry);
    },

    reopen: (siteId) => {
      const entry = sites.get(siteId);
      if (entry === undefined || entry.url === null) return;
      // `show` navigates a webview that already exists, so the page is fetched
      // again without the view being destroyed — which would lose all it holds.
      // Asking for it explicitly is the point: the shell skips a repeat of an
      // address a webview is already on, and a reload is exactly that repeat.
      open(siteId, entry, entry.url, true);
    },

    place: (paneId, visible) => {
      // Addressed by pane: every site of it shares the one rect the geometry
      // layer knows about, and only the active one is shown.
      for (const [siteId, entry] of sites) {
        if (entry.paneId !== paneId) continue;
        entry.visible = visible;
        send(siteId, entry);
      }
    },

    remeasure: (siteId) => {
      const entry = sites.get(siteId);
      if (entry === undefined) return;
      send(siteId, entry);
    },

    release: (paneId) => {
      for (const [siteId, entry] of [...sites]) {
        if (entry.paneId === paneId) close(siteId, entry);
      }
    },

    releaseSite: (siteId) => {
      const entry = sites.get(siteId);
      if (entry !== undefined) close(siteId, entry);
    },

    /**
     * A native webview takes mouse input at the OS level, and Tauri has no
     * per-webview equivalent of ignore-cursor-events. Hiding is the only way to
     * get the pointer back, and it is safe: the page keeps running.
     */
    setCursorCapture: (capturingNow) => {
      if (capturing === capturingNow) return;
      capturing = capturingNow;
      for (const [siteId, entry] of sites) send(siteId, entry);
    },
  };

  return renderer;
}

/**
 * The webview side of the drag seam: hides every webview while any splitter drag
 * is live, and shows them again when the last one ends.
 *
 * Hiding rather than ignoring events, because Tauri v2 offers
 * `setIgnoreCursorEvents` on the window only. Calls nest: two splitters can be
 * dragged at once, and the webviews come back only after both have let go.
 *
 * Nothing is kept here about which webviews were hidden. A pane is hidden exactly
 * when its layout asked for it to be visible, so resuming restores precisely
 * those, at the rect they have now.
 */
export function createWebviewPointerSuppressor(
  renderer: PaneWebviewRenderer,
): PanePointerSuppressor {
  let depth = 0;
  return {
    suspend: () => {
      depth += 1;
      if (depth === 1) renderer.setCursorCapture(false);
    },
    resume: () => {
      if (depth === 0) return;
      depth -= 1;
      if (depth === 0) renderer.setCursorCapture(true);
    },
  };
}

/** The renderer the running wall uses. Tests build their own. */
export const paneWebviewRenderer = createPaneWebviewRenderer({
  bridge: nativePaneBridge,
});

registerPanePointerSuppressor(createWebviewPointerSuppressor(paneWebviewRenderer));
