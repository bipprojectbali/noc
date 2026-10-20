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
import type { PaneId, PaneStrategy } from "../layout/layout.types.ts";
import type { PaneLoadState } from "./pane.load-state.ts";
import { paneIframeRenderer } from "./pane.iframe-renderer.tsx";
import { paneWebviewRenderer } from "./pane.webview-renderer.ts";

export type PaneRendererKind = "iframe" | "webview";

export type PaneContentProps = {
  paneId: PaneId;
  /**
   * The pane's address as the tree holds it. Separate from `load` because
   * framing permission is an iframe concern: the webview renderer shows this URL
   * whatever the probe said about it.
   */
  url: string | null;
  load: PaneLoadState;
};

export type PaneRenderer = {
  kind: PaneRendererKind;
  /** Rendered inside the pane body, as a sibling of the chrome. */
  Content: (props: PaneContentProps) => ReactNode;
  /** Pushes placement after a geometry sync. Not placed anywhere means hidden. */
  place: (paneId: PaneId, visible: boolean) => void;
  /** The pane is gone for good; anything it held may be destroyed. */
  release: (paneId: PaneId) => void;
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

/** The whole wall at once: a drag is not per pane. */
export function setPaneCursorCapture(capturing: boolean): void {
  for (const renderer of PANE_RENDERERS) renderer.setCursorCapture(capturing);
}
