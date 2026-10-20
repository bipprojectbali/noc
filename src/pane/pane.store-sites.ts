/**
 * The site half of the wall store: every action that decides what a pane shows.
 *
 * Split out of `pane.store` when a pane stopped holding one address and started
 * holding a list. Load state is keyed by **site** id, not pane id: a pane
 * mounts all of its pages at once, and each one probes, loads and becomes ready
 * on its own schedule. Keeping that bookkeeping here leaves `pane.store` the
 * shape it had — state, plus tree actions that delegate to pure functions.
 *
 * Two things here are deliberate and easy to undo by accident:
 *
 * - There is one address path. Everything that accepts typed input goes through
 *   `addressed`, which validates once; adding a site and repointing one differ
 *   by a flag, not by a second copy of the same code.
 * - Switching sites is a tree write and nothing else. No probe, no reload, no
 *   close: the renderers hide the page being left and keep it running, which is
 *   the whole reason a pane can hold several.
 */

import type { StoreApi } from "zustand";

import {
  addSite as addSiteToTree,
  removeSite as removeSiteFromTree,
  nextSiteId,
  setActiveSite,
} from "../layout/layout.sites.ts";
import { requirePane } from "../layout/layout.node.ts";
import { setPaneUrl } from "../layout/layout.tree.ts";
import {
  isPane,
  type LayoutTree,
  type PaneId,
  type SiteId,
} from "../layout/layout.types.ts";
import {
  INITIAL_PANE_LOAD_STATE,
  reducePaneLoad,
  type PaneLoadState,
} from "./pane.load-state.ts";
import { makeId, nextCreatedAt } from "./pane.ids.ts";
import { fetchEmbeddability } from "./pane.probe-client.ts";
import { paneRendererFor, releaseSite } from "./pane.renderer.ts";
import type { WallState } from "./pane.store.ts";
import { normalizePaneUrl } from "./pane.url.ts";
import { paneWebviewRenderer } from "./pane.webview-renderer.ts";

type SetWall = StoreApi<WallState>["setState"];
type GetWall = StoreApi<WallState>["getState"];

/** What one of a pane's pages is doing. Unknown sites have shown nothing yet. */
export function siteLoadState(state: WallState, siteId: SiteId): PaneLoadState {
  return state.load[siteId] ?? INITIAL_PANE_LOAD_STATE;
}

/**
 * What the pane is showing: the state of its active site. The pane's other
 * pages are loaded and hidden, and no chrome asks about them collectively.
 */
export function paneLoadState(state: WallState, paneId: PaneId): PaneLoadState {
  const pane = state.tree.nodes[paneId];
  if (pane === undefined || !isPane(pane) || pane.activeSiteId === null) {
    return INITIAL_PANE_LOAD_STATE;
  }
  return siteLoadState(state, pane.activeSiteId);
}

export type WallSitesSlice = Pick<
  WallState,
  | "restoreLayout"
  | "submitUrl"
  | "addSite"
  | "activateSite"
  | "toggleSite"
  | "removeSite"
  | "reloadPane"
  | "clearPane"
  | "dispatchLoad"
>;

export function createWallSitesSlice(set: SetWall, get: GetWall): WallSitesSlice {
  /** The renderer a pane will really get, for the decisions the store makes. */
  const rendersAsWebview = (paneId: PaneId): boolean => {
    const node = get().tree.nodes[paneId];
    if (node === undefined || !isPane(node)) return false;
    return paneRendererFor(node.strategy).kind === "webview";
  };

  /** Probes in the background; a result for a stale url is dropped by the reducer. */
  const probe = (siteId: SiteId, paneId: PaneId, url: string): void => {
    // A native webview loads a top-level document, so no framing header can
    // refuse it and the fetch would be one nobody reads. The site still has to
    // leave `probing`, and "unknown" is already the verdict meaning "go ahead".
    if (rendersAsWebview(paneId)) {
      get().dispatchLoad(siteId, {
        type: "probe-settled",
        url,
        verdict: "unknown",
        reason: "native webview: framing headers do not apply",
      });
      return;
    }

    void fetchEmbeddability(url)
      .then((result) => {
        get().dispatchLoad(siteId, {
          type: "probe-settled",
          url,
          verdict: result.verdict,
          reason: result.reason,
        });
      })
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        get().dispatchLoad(siteId, { type: "probe-failed", url, reason });
      });
  };

  /**
   * The one place typed input becomes a site. `append` is the only difference
   * between adding a page to the pane and repointing the page it is showing;
   * an empty pane appends whatever it is asked, having nothing to repoint.
   */
  const addressed = (paneId: PaneId, raw: string, append: boolean): void => {
    const result = normalizePaneUrl(raw);
    if (!result.ok) {
      set((state) => ({
        urlError: { ...state.urlError, [paneId]: result.reason },
      }));
      return;
    }

    const before = get().tree;
    const pane = requirePane(before, paneId);
    const tree =
      append || pane.activeSiteId === null
        ? addSiteToTree(before, paneId, result.url, makeId, nextCreatedAt())
        : setPaneUrl(before, paneId, result.url);
    // `addSite` activates what it appends, so either way the site that was just
    // given an address is the active one — which is also the id to probe.
    const siteId = requirePane(tree, paneId).activeSiteId;
    if (siteId === null) return;

    set((state) => ({
      tree,
      urlError: { ...state.urlError, [paneId]: null },
      load: {
        ...state.load,
        [siteId]: reducePaneLoad(siteLoadState(state, siteId), {
          type: "url-set",
          url: result.url,
        }),
      },
    }));
    probe(siteId, paneId, result.url);
  };

  /** Closes one of a pane's pages for good. The pane stays, even at zero sites. */
  const dropSite = (paneId: PaneId, siteId: SiteId): void => {
    set((state) => {
      const pane = state.tree.nodes[paneId];
      if (pane === undefined || !isPane(pane)) return {};
      if (!pane.sites.some((site) => site.id === siteId)) return {};
      const { [siteId]: _dropped, ...load } = state.load;
      // This and deleting the pane are the only places a page is meant to die.
      // A native webview is not in the DOM, so React cannot take it down with
      // the element; switching sites must never come through here.
      releaseSite(siteId);
      return { tree: removeSiteFromTree(state.tree, paneId, siteId), load };
    });
  };

  /** Points a pane at one of the sites it already holds. */
  const activate = (paneId: PaneId, siteId: SiteId): void => {
    set((state) => {
      const pane = state.tree.nodes[paneId];
      if (pane === undefined || !isPane(pane)) return {};
      if (pane.activeSiteId === siteId) return {};
      // A control can be clicked a frame after the site it names was removed.
      if (!pane.sites.some((site) => site.id === siteId)) return {};
      return { tree: setActiveSite(state.tree, paneId, siteId) };
    });
  };

  return {
    restoreLayout: (tree: LayoutTree) => {
      // The seeded load record and probe list that `persist.sync` passes are
      // ignored on purpose: they are keyed per pane, from a time when a pane
      // held one address, and the restored tree already carries every site's
      // url. The parameters stay because that layer calls with them.
      const load: Record<SiteId, PaneLoadState> = {};
      const pending: { paneId: PaneId; siteId: SiteId; url: string }[] = [];
      for (const node of Object.values(tree.nodes)) {
        if (!isPane(node)) continue;
        for (const site of node.sites) {
          // Probing rather than ready, even for a page that was ready when it
          // was stored: framing permission comes from the target's live
          // response headers, and yesterday's answer is not evidence.
          load[site.id] = { kind: "probing", url: site.url };
          pending.push({ paneId: node.id, siteId: site.id, url: site.url });
        }
      }
      set({ tree, load, urlError: {} });
      for (const item of pending) probe(item.siteId, item.paneId, item.url);
    },

    submitUrl: (paneId, raw) => addressed(paneId, raw, false),
    addSite: (paneId, raw) => addressed(paneId, raw, true),

    activateSite: activate,

    toggleSite: (paneId) => {
      const pane = get().tree.nodes[paneId];
      if (pane === undefined || !isPane(pane)) return;
      const next = nextSiteId(pane);
      if (next === null) return;
      activate(paneId, next);
    },

    removeSite: dropSite,

    reloadPane: (paneId) => {
      const pane = get().tree.nodes[paneId];
      if (pane === undefined || !isPane(pane)) return;
      // Every site of the pane, not only the one on screen. The background
      // pages are live documents, and both callers mean the whole pane: the ⋮
      // item, and a cookie import that only takes effect on a fresh load.
      for (const site of pane.sites) {
        const before = siteLoadState(get(), site.id);
        if (before.kind === "empty") continue;
        get().dispatchLoad(site.id, { type: "reload" });
        probe(site.id, paneId, before.url);
        // An iframe reloads on its own: `probing` takes its `src` away and the
        // next state puts it back. A webview keeps the same url throughout, so
        // nothing navigates unless it is told to.
        if (rendersAsWebview(paneId)) paneWebviewRenderer.reopen(site.id);
      }
    },

    clearPane: (paneId) => {
      const pane = get().tree.nodes[paneId];
      if (pane === undefined || !isPane(pane) || pane.activeSiteId === null) return;
      dropSite(paneId, pane.activeSiteId);
    },

    dispatchLoad: (siteId, event) => {
      set((state) => ({
        load: {
          ...state.load,
          [siteId]: reducePaneLoad(siteLoadState(state, siteId), event),
        },
      }));
    },
  };
}
