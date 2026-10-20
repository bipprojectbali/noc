/**
 * Global wall state. Tree operations are delegated to the pure functions in
 * `layout.tree`; this file only holds state and sequences side effects.
 *
 * Everything about what a pane *shows* — its list of sites, their load states,
 * the probe — lives in `pane.store-sites`, which this file mixes in. The split
 * is along the line that grew: a pane holds several pages now, and the actions
 * that manage them outgrew the file that also owns the tree.
 */

import { create } from "zustand";

import { geometryRegistry } from "../geometry/geometry.store.ts";
import {
  createTree,
  resizeSplit,
  setPaneStrategy,
  setPaneUrlBarVisible,
  splitPane,
} from "../layout/layout.tree.ts";
import { movePane, swapPanes } from "../layout/layout.move.ts";
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
  type SiteId,
  type SplitDirection,
} from "../layout/layout.types.ts";
import type { PaneLoadEvent, PaneLoadState } from "./pane.load-state.ts";
import type { PersistenceStatus } from "../persist/persist.status.ts";
import type { DropZone } from "./pane.drag-geometry.ts";
import { makeId, nextCreatedAt } from "./pane.ids.ts";
import { releasePane, rendererChange } from "./pane.renderer.ts";
import { createWallSitesSlice } from "./pane.store-sites.ts";

export type WallState = {
  tree: LayoutTree;
  /**
   * Keyed by site, not by pane: a pane mounts every page it holds at once, and
   * each one probes and loads separately.
   */
  load: Record<SiteId, PaneLoadState>;
  /** Validation message for what the user last typed, per pane. */
  urlError: Record<PaneId, string | null>;
  persistence: PersistenceStatus;
  setPersistence: (status: PersistenceStatus) => void;
  /**
   * Replaces the whole wall with a restored layout. The tree carries every
   * site's address, so it is the only argument needed; every site in it is
   * checked for framing again, because a site's headers can change overnight.
   */
  restoreLayout: (tree: LayoutTree) => void;
  /** Points the pane's active site at a typed address, or gives an empty pane its first. */
  submitUrl: (paneId: PaneId, raw: string) => void;
  /** Appends a page to the pane and shows it. Same validation as `submitUrl`. */
  addSite: (paneId: PaneId, raw: string) => void;
  /** Shows one of the pages the pane already holds. The others stay loaded. */
  activateSite: (paneId: PaneId, siteId: SiteId) => void;
  /** Shows the next page, wrapping — what a two-site switch button does. */
  toggleSite: (paneId: PaneId) => void;
  /** Closes one page for good. An emptied pane stays on the wall. */
  removeSite: (paneId: PaneId, siteId: SiteId) => void;
  /**
   * Magnifies one page. Per site, not per pane: the ⋮ panel steps the page on
   * screen, and the pane's other pages keep whatever they were set to.
   */
  setSiteZoom: (paneId: PaneId, siteId: SiteId, zoom: number) => void;
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
   * sites in it reload; the control that calls this says so.
   */
  setPaneStrategy: (paneId: PaneId, strategy: PaneStrategy) => void;
  dispatchLoad: (siteId: SiteId, event: PaneLoadEvent) => void;
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

export const useWallStore = create<WallState>((set, get) => ({
  tree: createTree(makeId, nextCreatedAt()),
  load: {},
  urlError: {},
  persistence: { kind: "loading" },

  ...createWallSitesSlice(set, get),

  setPersistence: (status) => {
    set({ persistence: status });
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
      // The webviews being left behind were never in the DOM, so React dropping
      // the pane's content cannot take them with it. Without this they keep
      // painting over the wall. Delete and closing a site are the only other
      // places one dies.
      releasePane(paneId);
    }
    // The content is rebuilt either way — that is the reload the control warns
    // about — and the verdicts on file were answered for the other renderer.
    get().reloadPane(paneId);
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
      const node = state.tree.nodes[paneId];
      const tree = deletePane(state.tree, paneId, makeId, nextCreatedAt());
      // Delete is the one place a pane is meant to die, so its transient
      // state goes with it instead of leaking into the next pane.
      const load = { ...state.load };
      if (node !== undefined && isPane(node)) {
        for (const site of node.sites) delete load[site.id];
      }
      const { [paneId]: _droppedError, ...urlError } = state.urlError;
      // A native webview is not removed by React, because it was never in the
      // DOM. Delete is the only place it is right to destroy every one a pane
      // holds at once.
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
}));
