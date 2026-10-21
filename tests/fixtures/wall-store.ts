import { act } from "@testing-library/react";

import { createTree } from "../../src/layout/layout.tree.ts";
import { isPane } from "../../src/layout/layout.types.ts";
import { useWallStore } from "../../src/pane/pane.store.ts";

/**
 * Puts the wall store back to its initial state around a fresh one-pane tree.
 *
 * The second argument replaces the whole state rather than merging into it, so
 * a field added to the store later is reset here without this file naming it.
 * Merging is how `persistence` was once left behind by the pane tests.
 */
export function resetWallStore(rootId: string): void {
  useWallStore.setState(
    { ...useWallStore.getInitialState(), tree: createTree(() => rootId, 1) },
    true,
  );
}

/**
 * The ids of the sites a pane holds, newest last.
 *
 * Site ids are minted at random, so a test that wants to talk about one asks
 * here rather than naming it.
 */
export function siteIdsOf(paneId: string): string[] {
  const node = useWallStore.getState().tree.nodes[paneId];
  if (node === undefined || !isPane(node)) return [];
  return node.sites.map((site) => site.id);
}

/**
 * Lets the probes a test started finish before the next test begins.
 *
 * A probe resolves on its own schedule, after its test may already have
 * returned. Left alone, its result lands in whichever test runs next, against
 * whatever pane happens to share its id. One macrotask is enough for an
 * in-memory fetch stub to resolve and dispatch.
 */
export async function settleAsyncWork(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
