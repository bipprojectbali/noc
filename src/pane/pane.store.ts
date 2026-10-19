/**
 * Global wall state. Tree operations are delegated to the pure functions in
 * `layout.tree`; this file only holds state and sequences side effects.
 */

import { create } from "zustand";

import {
  createTree,
  resizeSplit,
  setPaneUrl,
  setPaneUrlBarVisible,
  splitPane,
} from "../layout/layout.tree.ts";
import {
  deletePane,
  dockPane,
  undockPane,
} from "../layout/layout.remove.ts";
import type {
  LayoutTree,
  NodeId,
  PaneId,
  SplitDirection,
} from "../layout/layout.types.ts";
import {
  INITIAL_PANE_LOAD_STATE,
  reducePaneLoad,
  type PaneLoadEvent,
  type PaneLoadState,
} from "./pane.load-state.ts";
import type { PersistenceStatus } from "../persist/persist.status.ts";
import { fetchEmbeddability } from "./pane.probe-client.ts";
import { releasePane } from "./pane.renderer.ts";
import { normalizePaneUrl } from "./pane.url.ts";

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
  setUrlBarVisible: (paneId: PaneId, visible: boolean) => void;
  dispatchLoad: (paneId: PaneId, event: PaneLoadEvent) => void;
  splitPane: (paneId: PaneId, direction: SplitDirection) => void;
  deletePane: (paneId: PaneId) => void;
  dockPane: (paneId: PaneId) => void;
  undockPane: (
    paneId: PaneId,
    hostPaneId: PaneId,
    direction: SplitDirection,
  ) => void;
  resizeSplit: (splitId: NodeId, firstFraction: number) => void;
};

function makeId(): string {
  return crypto.randomUUID();
}

let lastCreatedAt = 0;

/**
 * Wall-clock time, forced to strictly increase.
 *
 * `createdAt` is the pane layer's entire ordering key, and `Date.now()` only
 * resolves to the millisecond. Two panes created inside one millisecond tie, and
 * `pane.layer` then breaks the tie on the random id — so the newer pane sorts
 * first about half the time, which moves a host that is already mounted. Moving
 * a host re-inserts its iframe, and a re-inserted iframe reloads the page inside
 * it: exactly what the two-layer design exists to prevent. A pane created later
 * must therefore always carry a larger number than every pane before it.
 */
function nextCreatedAt(): number {
  lastCreatedAt = Math.max(Date.now(), lastCreatedAt + 1);
  return lastCreatedAt;
}

export function paneLoadState(state: WallState, paneId: PaneId): PaneLoadState {
  return state.load[paneId] ?? INITIAL_PANE_LOAD_STATE;
}

export const useWallStore = create<WallState>((set, get) => {
  /** Probes in the background; a result for a stale url is dropped by the reducer. */
  const probe = (paneId: PaneId, url: string): void => {
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
        tree: setPaneUrl(state.tree, paneId, result.url),
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
