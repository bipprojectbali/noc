/**
 * Translation between wall state and a `WallSnapshot`.
 *
 * Pure on purpose, and deliberately ignorant of both Zustand and the storage
 * backend: the store hands it plain values, which is what lets persistence be
 * tested without a browser and swapped without touching the store.
 */

import { serializeLayout } from "../layout/layout.serializer.ts";
import { isPane, type LayoutTree, type PaneId } from "../layout/layout.types.ts";
import {
  INITIAL_PANE_LOAD_STATE,
  type PaneLoadState,
} from "../pane/pane.load-state.ts";
import type { WallSettings, WallSnapshot } from "./persist.types.ts";

export type WallPersistInput = {
  tree: LayoutTree;
  load: Record<PaneId, PaneLoadState>;
  settings: WallSettings;
};

/**
 * `current_url` records only a page the pane actually displayed. A pane still
 * probing or refused never showed anything, so storing its address as "current"
 * would make a restart resume a page the user never saw.
 */
export function toSnapshot(input: WallPersistInput): WallSnapshot {
  const currentUrls: Record<PaneId, string | null> = {};
  for (const node of Object.values(input.tree.nodes)) {
    if (!isPane(node)) continue;
    const state = input.load[node.id];
    currentUrls[node.id] = state !== undefined && state.kind === "ready" ? state.url : null;
  }
  return {
    layout: serializeLayout(input.tree),
    settings: input.settings,
    currentUrls,
  };
}

export type SeededLoad = {
  load: Record<PaneId, PaneLoadState>;
  /** Panes that need a fresh embeddability probe, with the url to probe. */
  toProbe: { paneId: PaneId; url: string }[];
};

/**
 * Rebuilds per-pane load state for a restored wall.
 *
 * Every pane starts at `probing` rather than `ready`, even though it was ready
 * when it was stored: framing permission comes from the target's live response
 * headers, and a site that allowed framing yesterday may refuse today. The
 * stored `current_url` is preferred over the home url so a pane comes back to
 * the page it was last showing.
 */
export function seedLoadStates(snapshot: WallSnapshot): SeededLoad {
  const load: Record<PaneId, PaneLoadState> = {};
  const toProbe: { paneId: PaneId; url: string }[] = [];

  for (const node of Object.values(snapshot.layout.tree.nodes)) {
    if (!isPane(node)) continue;
    const url = snapshot.currentUrls[node.id] ?? node.url;
    if (url === null) {
      load[node.id] = INITIAL_PANE_LOAD_STATE;
      continue;
    }
    load[node.id] = { kind: "probing", url };
    toProbe.push({ paneId: node.id, url });
  }

  return { load, toProbe };
}
