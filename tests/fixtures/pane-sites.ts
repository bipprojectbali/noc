/**
 * Seeding and reading a pane's address in tests.
 *
 * `addSite` mints its site id from the caller's `makeId`, and the layout tests
 * assert on `n1`, `n2`, … counters that would shift if site ids came out of the
 * same sequence. So site ids come from a counter of their own here, which also
 * keeps a tree test readable when all it wanted was "this pane shows that page".
 */

import { addSite, activePaneUrl } from "../../src/layout/layout.sites.ts";
import { isPane, type LayoutTree, type PaneId } from "../../src/layout/layout.types.ts";

let siteCounter = 0;

/** Gives a pane one address, as the app does the first time a url is typed. */
export function seedUrl(
  tree: LayoutTree,
  paneId: PaneId,
  url: string,
  now = 1,
): LayoutTree {
  return addSite(tree, paneId, url, () => `s${++siteCounter}`, now);
}

/** The address a pane is showing. Throws rather than returning null for a missing pane. */
export function paneUrl(tree: LayoutTree, paneId: PaneId): string | null {
  const node = tree.nodes[paneId];
  if (node === undefined || !isPane(node)) {
    throw new Error(`"${paneId}" is not a pane in this tree`);
  }
  return activePaneUrl(node);
}
