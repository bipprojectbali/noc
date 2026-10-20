/**
 * One interface, two ways to put a site inside a pane.
 *
 * The iframe renderer is the browser path: hot reload, devtools, and layout work
 * without building anything native. The webview renderer is the product path: a
 * native child webview loads its URL as a top-level document, so the sites that
 * refuse to be framed still render. Both exist on purpose, and both have to go
 * on working — the dev loop depends on the first and the user depends on the
 * second.
 *
 * Callers below the pane do not pick: a pane's `strategy` and the host we are
 * running in decide.
 */

import type { ReactNode } from "react";

import { isNativeHost } from "../native/native.bridge.ts";
import type { PaneId, PaneStrategy, SiteId } from "../layout/layout.types.ts";
import type { PaneLoadState } from "./pane.load-state.ts";
import { paneIframeRenderer } from "./pane.iframe-renderer.tsx";
import { paneWebviewRenderer } from "./pane.webview-renderer.ts";

export type PaneRendererKind = "iframe" | "webview";

export type PaneContentProps = {
  paneId: PaneId;
  /**
   * The document this element serves. One pane holds several, all mounted at
   * once, so everything that identifies a *document* — the DOM node, its React
   * key, a native webview's label — hangs off this rather than the pane id.
   */
  siteId: SiteId;
  /**
   * This site's address as the tree holds it. Separate from `load` because
   * framing permission is an iframe concern: the webview renderer shows this URL
   * whatever the probe said about it.
   */
  url: string | null;
  load: PaneLoadState;
  /**
   * Whether this is the site on screen. The others stay mounted and hidden:
   * switching has to be instant and must not cost the page its scroll position
   * or its session, which unmounting would.
   */
  active: boolean;
  /**
   * How much to magnify this page, 1 being 100%. Served by the iframe renderer
   * and ignored by the webview one — a native child webview is an OS-level
   * view that no CSS reaches, and magnifying it would mean a fifth `invoke`.
   * Passed to both anyway, like `place` and `release`: a prop the renderer does
   * not use costs nothing, and branching here would put renderer knowledge back
   * into the layer that is meant not to have any.
   */
  zoom: number;
};

export type PaneRenderer = {
  kind: PaneRendererKind;
  /** Rendered inside the pane body, as a sibling of the chrome. */
  Content: (props: PaneContentProps) => ReactNode;
  /**
   * Pushes placement after a geometry sync. Not placed anywhere means hidden.
   * Still keyed by pane: every site of a pane shares one rect, and the geometry
   * layer has no reason to learn that a pane holds more than one document.
   */
  place: (paneId: PaneId, visible: boolean) => void;
  /** The pane is gone for good; everything it held may be destroyed. */
  release: (paneId: PaneId) => void;
  /**
   * One of the pane's documents is gone for good — the pane stays. The third
   * and last caller allowed to destroy a native webview, for the same reason
   * the other two are: the document will never be shown again. Switching sites
   * must never reach this; that is what `active` is for.
   */
  releaseSite: (siteId: SiteId) => void;
  /**
   * Whether panes may take the pointer. A drag has to be able to run over them:
   * an iframe swallows the pointer, and a native webview takes mouse input at
   * the OS level where the DOM cannot reach it at all.
   */
  setCursorCapture: (capturing: boolean) => void;
};

/** Both renderers, for the operations that are not about one pane's content. */
const PANE_RENDERERS: readonly PaneRenderer[] = [
  paneIframeRenderer,
  paneWebviewRenderer,
];

/**
 * `auto` means "the best this host can do". A pane pinned to `webview` still
 * falls back in a browser, where there is no native shell to ask.
 */
export function paneRendererFor(strategy: PaneStrategy): PaneRenderer {
  if (!isNativeHost()) return paneIframeRenderer;
  return strategy === "iframe" ? paneIframeRenderer : paneWebviewRenderer;
}

/**
 * What changing a pane's strategy actually costs, decided in one place because
 * both facts are easy to get wrong.
 *
 * `changed` is false whenever the host collapses two strategies onto the same
 * renderer — `auto` and `webview` are the same thing in the shell, and every
 * strategy is an iframe in a browser — and then nothing should happen at all.
 *
 * `releases` marks the direction that leaks: a native webview is not in the DOM,
 * so React unmounting the pane's content leaves it alive, painting over the wall
 * at OS level. It has to be destroyed explicitly by whoever switches away.
 */
export function rendererChange(
  before: PaneStrategy,
  after: PaneStrategy,
): { changed: boolean; releases: boolean } {
  const from = paneRendererFor(before).kind;
  const to = paneRendererFor(after).kind;
  return { changed: from !== to, releases: from === "webview" && to !== "webview" };
}

/**
 * Applied to every renderer rather than the pane's own: these are cheap no-ops
 * for a renderer that is not serving the pane, and it keeps the layer that syncs
 * geometry from having to know which renderer any pane ended up with.
 */
export function placePane(paneId: PaneId, visible: boolean): void {
  for (const renderer of PANE_RENDERERS) renderer.place(paneId, visible);
}

export function releasePane(paneId: PaneId): void {
  for (const renderer of PANE_RENDERERS) renderer.release(paneId);
}

export function releaseSite(siteId: SiteId): void {
  for (const renderer of PANE_RENDERERS) renderer.releaseSite(siteId);
}

/**
 * The element a renderer tags for tests.
 *
 * A pane now mounts one element per site, so the pane-scoped name cannot sit on
 * all of them. It stays on the one that is actually on screen — "the frame of
 * pane p1" is what a reader means — and the sites kept warm behind it are named
 * with their own id. Nothing in the running app reads either; `data-pane-slot`
 * and `data-pane-host` are the only DOM hooks that logic uses.
 */
export function paneContentTestId(
  prefix: string,
  paneId: PaneId,
  siteId: SiteId,
  active: boolean,
): string {
  return active ? `${prefix}-${paneId}` : `${prefix}-${paneId}-${siteId}`;
}

/** The whole wall at once: a drag is not per pane. */
export function setPaneCursorCapture(capturing: boolean): void {
  for (const renderer of PANE_RENDERERS) renderer.setCursorCapture(capturing);
}
