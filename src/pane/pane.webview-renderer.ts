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
 */

import { createElement, useCallback, useEffect, useLayoutEffect, useRef } from "react";

import type { PaneId } from "../layout/layout.types.ts";
import {
  nativePaneBridge,
  type NativePaneBridge,
  type NativeRect,
} from "../native/native.bridge.ts";
import {
  registerPanePointerSuppressor,
  type PanePointerSuppressor,
} from "../resize/resize.pointer-capture.ts";
import type { PaneContentProps, PaneRenderer } from "./pane.renderer.ts";

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
  anchor: HTMLElement | null;
  /** The url last handed to the shell. A move must never re-navigate. */
  url: string | null;
  /** Whether a webview exists for this pane yet. */
  opened: boolean;
  /** What the layout last asked for, independent of a drag. */
  visible: boolean;
  /** What was last actually sent, so a drag does not flood the IPC channel. */
  sent: { rect: NativeRect; visible: boolean } | null;
};

export type PaneWebviewRenderer = PaneRenderer & {
  /** The anchor box whose rect the webview is placed over. */
  registerAnchor: (paneId: PaneId, element: HTMLElement | null) => void;
  setUrl: (paneId: PaneId, url: string | null) => void;
  /**
   * Navigates the pane to the address it already has. An iframe gets this for
   * nothing — `probing` drops its `src` and putting it back fetches again — so
   * only this renderer has to be asked, and it is deliberately not on the
   * shared `PaneRenderer`.
   */
  reopen: (paneId: PaneId) => void;
  /** Re-sends geometry at the visibility the layout last asked for. */
  remeasure: (paneId: PaneId) => void;
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

  const panes = new Map<PaneId, PaneEntry>();
  /** False for the duration of a drag. See `setCursorCapture`. */
  let capturing = true;

  function entryFor(paneId: PaneId): PaneEntry {
    const existing = panes.get(paneId);
    if (existing !== undefined) return existing;
    const created: PaneEntry = {
      anchor: null,
      url: null,
      opened: false,
      visible: false,
      sent: null,
    };
    panes.set(paneId, created);
    return created;
  }

  function report(paneId: PaneId, what: string, error: unknown): void {
    onError(`Pane ${paneId} could not ${what}: ${describe(error)}`);
  }

  /** Pushes the anchor's current rect, unless nothing has changed. */
  function send(paneId: PaneId, entry: PaneEntry): void {
    if (entry.anchor === null || !entry.opened) return;
    const rect = readRect(entry.anchor);
    const visible = entry.visible && capturing && hasArea(rect);
    if (
      entry.sent !== null &&
      entry.sent.visible === visible &&
      sameRect(entry.sent.rect, rect)
    ) {
      return;
    }
    entry.sent = { rect, visible };
    bridge.place(paneId, rect, visible).catch((error: unknown) => {
      report(paneId, "be placed", error);
    });
  }

  /** Creates the webview, or navigates it if the pane already had one. */
  function open(paneId: PaneId, entry: PaneEntry, url: string): void {
    const anchor = entry.anchor;
    if (anchor === null) return;
    const rect = readRect(anchor);
    entry.opened = true;
    // The shell shows a freshly created webview, so record that as sent and let
    // the follow-up correct it for a pane that is docked or off screen.
    entry.sent = { rect, visible: true };
    bridge
      .show(paneId, url, rect)
      .then(() => send(paneId, entry))
      .catch((error: unknown) => {
        entry.sent = null;
        report(paneId, "open", error);
      });
  }

  const renderer: PaneWebviewRenderer = {
    kind: "webview",

    Content: ({ paneId, url }: PaneContentProps) => {
      const anchorRef = useRef<HTMLDivElement | null>(null);

      const attach = useCallback((element: HTMLDivElement | null) => {
        anchorRef.current = element;
        renderer.registerAnchor(paneId, element);
      }, [paneId]);

      useLayoutEffect(() => {
        renderer.setUrl(paneId, url);
      }, [paneId, url]);

      useEffect(() => {
        const element = anchorRef.current;
        if (element === null || typeof ResizeObserver === "undefined") return;
        // Showing or hiding the URL bar resizes this box without moving the
        // pane, and the layout layer has no reason to notice that.
        const observer = new ResizeObserver(() => renderer.remeasure(paneId));
        observer.observe(element);
        return () => observer.disconnect();
      }, [paneId]);

      return createElement("div", {
        className: "noc-pane__webview-anchor",
        ref: attach,
        "data-testid": `pane-webview-${paneId}`,
      });
    },

    registerAnchor: (paneId, element) => {
      const entry = entryFor(paneId);
      entry.anchor = element;
      if (element === null) return;
      // A remount gives us a new box; nothing sent before applies to it.
      entry.sent = null;
      if (entry.url !== null && !entry.opened) {
        open(paneId, entry, entry.url);
        return;
      }
      send(paneId, entry);
    },

    setUrl: (paneId, url) => {
      const entry = entryFor(paneId);
      if (entry.url === url) return;
      entry.url = url;

      if (url === null) {
        // Cleared, not deleted: hide and keep the page for the next address.
        entry.visible = false;
        send(paneId, entry);
        return;
      }
      open(paneId, entry, url);
    },

    reopen: (paneId) => {
      const entry = panes.get(paneId);
      if (entry === undefined || entry.url === null) return;
      // `show` navigates a webview that already exists, so the page is fetched
      // again without the view being destroyed — which would lose all it holds.
      open(paneId, entry, entry.url);
    },

    place: (paneId, visible) => {
      const entry = entryFor(paneId);
      entry.visible = visible;
      send(paneId, entry);
    },

    remeasure: (paneId) => {
      const entry = panes.get(paneId);
      if (entry === undefined) return;
      send(paneId, entry);
    },

    release: (paneId) => {
      const entry = panes.get(paneId);
      panes.delete(paneId);
      if (entry === undefined || !entry.opened) return;
      bridge.close(paneId).catch((error: unknown) => {
        report(paneId, "be closed", error);
      });
    },

    /**
     * A native webview takes mouse input at the OS level, and Tauri has no
     * per-webview equivalent of ignore-cursor-events. Hiding is the only way to
     * get the pointer back, and it is safe: the page keeps running.
     */
    setCursorCapture: (capturingNow) => {
      if (capturing === capturingNow) return;
      capturing = capturingNow;
      for (const [paneId, entry] of panes) send(paneId, entry);
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
