/**
 * Global wall state. Tree operations are delegated to the pure functions in
 * `layout.tree`; this file only holds state and sequences side effects.
 */

import { create } from "zustand";

import {
  createTree,
  setPaneUrl,
  setPaneUrlBarVisible,
} from "../layout/layout.tree.ts";
import type { LayoutTree, PaneId } from "../layout/layout.types.ts";
import {
  INITIAL_PANE_LOAD_STATE,
  reducePaneLoad,
  type PaneLoadEvent,
  type PaneLoadState,
} from "./pane.load-state.ts";
import { fetchEmbeddability } from "./pane.probe-client.ts";
import { normalizePaneUrl } from "./pane.url.ts";

export type WallState = {
  tree: LayoutTree;
  load: Record<PaneId, PaneLoadState>;
  /** Validation message for what the user last typed, per pane. */
  urlError: Record<PaneId, string | null>;
  submitUrl: (paneId: PaneId, raw: string) => void;
  reloadPane: (paneId: PaneId) => void;
  clearPane: (paneId: PaneId) => void;
  setUrlBarVisible: (paneId: PaneId, visible: boolean) => void;
  dispatchLoad: (paneId: PaneId, event: PaneLoadEvent) => void;
};

function makeId(): string {
  return crypto.randomUUID();
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
    tree: createTree(makeId, Date.now()),
    load: {},
    urlError: {},

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
  };
});
