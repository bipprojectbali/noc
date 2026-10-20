/**
 * Pure operations that rearrange panes already on the wall: move one next to
 * another, or swap two in place. No DOM, no React, no store.
 *
 * These are cheap because of invariant 1: the tree holds empty slots, panes live
 * in a separate flat list whose order never changes, and geometry is copied from
 * slot to pane host imperatively. So rearranging the wall is a tree edit and
 * nothing remounts — provided no pane id is ever minted or dropped here. Move
 * reuses `detachLeaf` (collapse the vacated split, exactly as delete does) and
 * `insertPaneBeside` (the same re-entry undock uses); swap writes nothing but
 * child slots and `parentId`.
 *
 * Refusals are returned, not thrown, because a drag can legitimately end
 * somewhere the tree cannot honour. Unknown ids still throw: that is a caller
 * bug, not a user gesture.
 */

import { requirePane, requireSplit, replaceChild } from "./layout.node.ts";
import { detachLeaf } from "./layout.remove.ts";
import { insertPaneBeside, isDocked, type MakeId } from "./layout.tree.ts";
import type {
  LayoutNode,
  LayoutTree,
  NodeId,
  PaneId,
  PaneSide,
} from "./layout.types.ts";

/**
 * `pane-docked` — a docked pane has no slot to move from or host into; use
 * `undockPane`/`dockPane` for that crossing.
 * `pane-not-in-tree` — the pane exists as a node but sits outside the tree
 * without being docked, which a well-formed tree never allows.
 */
export type RearrangeRefusal = "pane-docked" | "pane-not-in-tree";

export type RearrangeResult =
  | { ok: true; tree: LayoutTree }
  | { ok: false; reason: RearrangeRefusal };

/**
 * Pulls `paneId` out of its current slot and re-inserts it on one edge of
 * `targetPaneId`. The pane node — and therefore its id, url, strategy and
 * renderer — survives untouched; only split nodes are created and destroyed.
 *
 * Dropping a pane onto itself is a no-op rather than an error, so a drag that
 * ends where it started needs no special case in the caller.
 *
 * Sizes: the vacated split collapses and its sibling inherits its share
 * (`detachLeaf`), and the new split inherits the target's slot but starts
 * 0.5/0.5 inside (`insertPaneBeside`). A move therefore resets the ratio
 * between the two panes it joins, the same way splitting does.
 */
export function movePane(
  tree: LayoutTree,
  paneId: PaneId,
  targetPaneId: PaneId,
  side: PaneSide,
  makeId: MakeId,
): RearrangeResult {
  const pane = requirePane(tree, paneId);
  requirePane(tree, targetPaneId);

  if (paneId === targetPaneId) return { ok: true, tree };
  if (isDocked(tree, paneId) || isDocked(tree, targetPaneId)) {
    return { ok: false, reason: "pane-docked" };
  }

  // A pane with no parent is the whole tree, so a *different* target cannot be
  // in it. Unreachable in a well-formed tree, and the guard is what lets us
  // promise `detachLeaf` never reaches its reseed branch and mints an id.
  if (pane.parentId === null) return { ok: false, reason: "pane-not-in-tree" };

  const detached = detachLeaf(tree, paneId, makeId, pane.createdAt);
  return {
    ok: true,
    tree: insertPaneBeside(detached, paneId, targetPaneId, side, makeId),
  };
}

/**
 * Exchanges the slots of two panes. The tree keeps its exact shape: every split,
 * direction and size stays put, so each pane takes over the other's share of the
 * wall. Nothing is created or destroyed, so this never needs a `makeId`.
 */
export function swapPanes(
  tree: LayoutTree,
  paneId: PaneId,
  otherPaneId: PaneId,
): RearrangeResult {
  const pane = requirePane(tree, paneId);
  const other = requirePane(tree, otherPaneId);

  if (paneId === otherPaneId) return { ok: true, tree };
  if (isDocked(tree, paneId) || isDocked(tree, otherPaneId)) {
    return { ok: false, reason: "pane-docked" };
  }

  // See `movePane`: a parentless pane is the only pane, so it has nobody to
  // swap with.
  if (pane.parentId === null || other.parentId === null) {
    return { ok: false, reason: "pane-not-in-tree" };
  }

  const nodes: Record<NodeId, LayoutNode> = { ...tree.nodes };

  if (pane.parentId === other.parentId) {
    // Siblings: one split owns both slots, so rewiring it twice would undo the
    // first write. Flip its children instead and leave the sizes alone.
    const parent = requireSplit(tree, pane.parentId);
    nodes[parent.id] = {
      ...parent,
      children: [parent.children[1], parent.children[0]],
    };
  } else {
    nodes[pane.parentId] = replaceChild(
      requireSplit(tree, pane.parentId),
      paneId,
      otherPaneId,
    );
    nodes[other.parentId] = replaceChild(
      requireSplit(tree, other.parentId),
      otherPaneId,
      paneId,
    );
  }

  nodes[paneId] = { ...pane, parentId: other.parentId };
  nodes[otherPaneId] = { ...other, parentId: pane.parentId };
  return { ok: true, tree: { ...tree, nodes } };
}
