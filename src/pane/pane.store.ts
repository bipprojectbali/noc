/**
 * Global wall state. Tree operations are delegated to the pure functions in
 * `layout.tree`; this file only holds state and sequences side effects.
 */

import { create } from "zustand";

import { geometryRegistry } from "../geometry/geometry.store.ts";
import {
  createTree,
  resizeSplit,
  setPaneStrategy,
  setPaneUrl,
  setPaneUrlBarVisible,
  splitPane,
} from "../layout/layout.tree.ts";
import { movePane, swapPanes } from "../layout/layout.move.ts";
import { requirePane } from "../layout/layout.node.ts";
import { addSite } from "../layout/layout.sites.ts";
import {
  deletePane,
  dockPane,
  undockPane,
} from "../layout/layout.remove.ts";
import {
  isPane,
  type LayoutTree,
  type NodeId,
  type PaneId,
  type PaneStrategy,
  type SplitDirection,
} from "../layout/layout.types.ts";
import {
  INITIAL_PANE_LOAD_STATE,
  reducePaneLoad,
  type PaneLoadEvent,
  type PaneLoadState,
} from "./pane.load-state.ts";
import type { PersistenceStatus } from "../persist/persist.status.ts";
import type { DropZone } from "./pane.drag-geometry.ts";
import { makeId, nextCreatedAt } from "./pane.ids.ts";
import { fetchEmbeddability } from "./pane.probe-client.ts";
import { paneRendererFor, releasePane, rendererChange } from "./pane.renderer.ts";
import { normalizePaneUrl } from "./pane.url.ts";
import { paneWebviewRenderer } from "./pane.webview-renderer.ts";

export type WallState = {
  tree: LayoutTree;
  load: Record<PaneId, PaneLoadState>;
  /** Validation message for what the user last typed, per pane. */
  urlError: Record<PaneId, string | null>;
  persistence: PersistenceStatus;
  setPersistence: (status: PersistenceStatus) => void;
  /**
   * Replaces the whole wall with a restored layout. Every pane in `toProbe` is
   * checked for framing again, because a site's headers can change overnight.
   */
  restoreLayout: (
    tree: LayoutTree,
    load: Record<PaneId, PaneLoadState>,
    toProbe: { paneId: PaneId; url: string }[],
  ) => void;
  submitUrl: (paneId: PaneId, raw: string) => void;
  reloadPane: (paneId: PaneId) => void;
  clearPane: (paneId: PaneId) => void;
  /**
   * No UI caller since the chrome became one strip and a menu: nothing can be
   * hidden any more. Kept because `urlBarVisible` is a persisted pane column
   * and a settings key, so dropping it is a schema migration, not a delete.
   */
  setUrlBarVisible: (paneId: PaneId, visible: boolean) => void;
  /**
   * Switches which renderer serves a pane. Replaces the pane's content, so the
   * site in it reloads; the control that calls this says so.
   */
  setPaneStrategy: (paneId: PaneId, strategy: PaneStrategy) => void;
  dispatchLoad: (paneId: PaneId, event: PaneLoadEvent) => void;
  splitPane: (paneId: PaneId, direction: SplitDirection) => void;
  /**
   * Lands a finished pane drag: an edge drops the pane on that side of the
   * target, the middle trades the two places. One `set` for the whole move —
   * detaching and re-inserting in two commits would leave a frame where the
   * pane holds no slot, and a pane with no slot is hidden, which blinks its
   * webview. A refusal leaves the wall exactly as it was.
   */
  rearrangePane: (paneId: PaneId, targetPaneId: PaneId, zone: DropZone) => void;
  deletePane: (paneId: PaneId) => void;
  /**
   * Minimise was removed from the UI with the dock strip: a tiling wall is not
   * a window manager, split and close cover the need, and restoring put a pane
   * back in the wrong place. These two have no caller but the layout tests.
   * Kept rather than deleted because `dock` reaches `layout.types`,
   * `layout.invariants`, the serializer, the `dock` table and its migration —
   * removal is a schema change, not a tidy-up.
   */
  dockPane: (paneId: PaneId) => void;
  undockPane: (
    paneId: PaneId,
    hostPaneId: PaneId,
    direction: SplitDirection,
  ) => void;
  resizeSplit: (splitId: NodeId, firstFraction: number) => void;
};

export function paneLoadState(state: WallState, paneId: PaneId): PaneLoadState {
  return state.load[paneId] ?? INITIAL_PANE_LOAD_STATE;
}

export const useWallStore = create<WallState>((set, get) => {
  /** The renderer a pane will really get, for the decisions the store makes. */
  const rendersAsWebview = (paneId: PaneId): boolean => {
    const node = get().tree.nodes[paneId];
    if (node === undefined || !isPane(node)) return false;
    return paneRendererFor(node.strategy).kind === "webview";
  };

  /** Probes in the background; a result for a stale url is dropped by the reducer. */
  const probe = (paneId: PaneId, url: string): void => {
    // A native webview loads a top-level document, so no framing header can
    // refuse it and the fetch would be one nobody reads. The pane still has to
    // leave `probing`, and "unknown" is already the verdict meaning "go ahead".
    if (rendersAsWebview(paneId)) {
      get().dispatchLoad(paneId, {
        type: "probe-settled",
        url,
        verdict: "unknown",
        reason: "native webview: framing headers do not apply",
      });
      return;
    }

    void fetchEmbeddability(url)
      .then((result) => {
        get().dispatchLoad(paneId, {
          type: "probe-settled",
          url,
          verdict: result.verdict,
          reason: result.reason,
        });
      })
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        get().dispatchLoad(paneId, { type: "probe-failed", url, reason });
      });
  };

  return {
    tree: createTree(makeId, nextCreatedAt()),
    load: {},
    urlError: {},
    persistence: { kind: "loading" },

    setPersistence: (status) => {
      set({ persistence: status });
    },

    restoreLayout: (tree, load, toProbe) => {
      set({ tree, load, urlError: {} });
      for (const { paneId, url } of toProbe) probe(paneId, url);
    },

    submitUrl: (paneId, raw) => {
      const result = normalizePaneUrl(raw);
      if (!result.ok) {
        set((state) => ({
          urlError: { ...state.urlError, [paneId]: result.reason },
        }));
        return;
      }
      set((state) => ({
        // An empty pane has no site to repoint, so the first address it is
        // given has to be added. One site per pane is still all the UI makes.
        tree:
          requirePane(state.tree, paneId).activeSiteId === null
            ? addSite(state.tree, paneId, result.url, makeId, nextCreatedAt())
            : setPaneUrl(state.tree, paneId, result.url),
        urlError: { ...state.urlError, [paneId]: null },
        load: {
          ...state.load,
          [paneId]: reducePaneLoad(paneLoadState(state, paneId), {
            type: "url-set",
            url: result.url,
          }),
        },
      }));
      probe(paneId, result.url);
    },

    reloadPane: (paneId) => {
      const before = paneLoadState(get(), paneId);
      if (before.kind === "empty") return;
      get().dispatchLoad(paneId, { type: "reload" });
      probe(paneId, before.url);
      // An iframe reloads on its own: `probing` takes its `src` away and the
      // next state puts it back. A webview keeps the same url throughout, so
      // nothing navigates unless it is told to.
      if (rendersAsWebview(paneId)) paneWebviewRenderer.reopen(paneId);
    },

    clearPane: (paneId) => {
      set((state) => ({
        tree: setPaneUrl(state.tree, paneId, null),
        urlError: { ...state.urlError, [paneId]: null },
        load: {
          ...state.load,
          [paneId]: reducePaneLoad(paneLoadState(state, paneId), {
            type: "url-cleared",
          }),
        },
      }));
    },

    setUrlBarVisible: (paneId, visible) => {
      set((state) => ({
        tree: setPaneUrlBarVisible(state.tree, paneId, visible),
      }));
    },

    setPaneStrategy: (paneId, strategy) => {
      const node = get().tree.nodes[paneId];
      if (node === undefined || !isPane(node) || node.strategy === strategy) {
        return;
      }
      const change = rendererChange(node.strategy, strategy);
      set((state) => ({ tree: setPaneStrategy(state.tree, paneId, strategy) }));
      if (!change.changed) return;

      if (change.releases) {
        // The webview being left behind was never in the DOM, so React dropping
        // the pane's content cannot take it with it. Without this it keeps
        // painting over the wall. Delete is the only other place one dies.
        releasePane(paneId);
      }
      // The content is rebuilt either way — that is the reload the control warns
      // about — and the verdict on file was answered for the other renderer.
      get().reloadPane(paneId);
    },

    dispatchLoad: (paneId, event) => {
      set((state) => ({
        load: {
          ...state.load,
          [paneId]: reducePaneLoad(paneLoadState(state, paneId), event),
        },
      }));
    },

    // Tree actions delegate to the pure functions and keep no logic of their
    // own, which is what lets the tree be tested without React or a DOM.
    splitPane: (paneId, direction) => {
      set((state) => ({
        tree: splitPane(state.tree, paneId, direction, makeId, nextCreatedAt()),
      }));
    },

    rearrangePane: (paneId, targetPaneId, zone) => {
      set((state) => {
        // A drop target is read off the DOM and can be deleted mid-drag; the
        // tree throws on an unknown id rather than refusing one.
        const ends = [state.tree.nodes[paneId], state.tree.nodes[targetPaneId]];
        if (!ends.every((node) => node !== undefined && isPane(node))) return {};

        const result =
          zone === "center"
            ? swapPanes(state.tree, paneId, targetPaneId)
            : movePane(state.tree, paneId, targetPaneId, zone, makeId);
        return result.ok ? { tree: result.tree } : {};
      });
    },

    deletePane: (paneId) => {
      set((state) => {
        const tree = deletePane(state.tree, paneId, makeId, nextCreatedAt());
        // Delete is the one place a pane is meant to die, so its transient
        // state goes with it instead of leaking into the next pane.
        const { [paneId]: _droppedLoad, ...load } = state.load;
        const { [paneId]: _droppedError, ...urlError } = state.urlError;
        // A native webview is not removed by React, because it was never in the
        // DOM. Delete is the only place it is right to destroy one.
        releasePane(paneId);
        // React drops the host element, but the last rect it was placed at lives
        // in a plain Map outside React and would otherwise be kept for the life
        // of the process.
        geometryRegistry.forget(paneId);
        return { tree, load, urlError };
      });
    },

    dockPane: (paneId) => {
      set((state) => ({
        tree: dockPane(state.tree, paneId, makeId, nextCreatedAt()),
      }));
    },

    undockPane: (paneId, hostPaneId, direction) => {
      set((state) => ({
        tree: undockPane(state.tree, paneId, hostPaneId, direction, makeId),
      }));
    },

    resizeSplit: (splitId, firstFraction) => {
      set((state) => ({
        tree: resizeSplit(state.tree, splitId, firstFraction),
      }));
    },
  };
});
