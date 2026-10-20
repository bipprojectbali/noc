/** Pure operations that take a pane out of the tree: delete, dock, undock. */

import {
  newPane,
  replaceChild,
  requireNode,
  requirePane,
  requireSplit,
} from "./layout.node.ts";
import { insertPaneBeside, isDocked, type MakeId } from "./layout.tree.ts";
import type {
  LayoutNode,
  LayoutTree,
  NodeId,
  PaneId,
  SplitDirection,
} from "./layout.types.ts";

/**
 * Removes a leaf from the tree and promotes its sibling into the parent's slot,
 * inheriting the parent's share of space. The pane's own node is left in place
 * with a now-dangling `parentId`; callers decide whether to delete it, move it
 * to the dock, or re-insert it elsewhere, and must do so before the tree is
 * handed on. Only the "last pane in the tree" branch mints an id, so callers
 * that have ruled that branch out may pass any `now`.
 */
export function detachLeaf(
  tree: LayoutTree,
  paneId: PaneId,
  makeId: MakeId,
  now: number,
): LayoutTree {
  const pane = requirePane(tree, paneId);

  if (pane.parentId === null) {
    // Last pane in the tree. The tree must never be empty, so seed a fresh one.
    const rootId = makeId();
    return {
      ...tree,
      rootId,
      nodes: { ...tree.nodes, [rootId]: newPane(rootId, now, null) },
    };
  }

  const parent = requireSplit(tree, pane.parentId);
  const siblingId = parent.children[parent.children[0] === paneId ? 1 : 0];
  const sibling = requireNode(tree, siblingId);

  const nodes: Record<NodeId, LayoutNode> = { ...tree.nodes };
  delete nodes[parent.id];

  if (parent.parentId === null) {
    nodes[siblingId] = { ...sibling, parentId: null };
    return { ...tree, rootId: siblingId, nodes };
  }

  const grandparent = requireSplit(tree, parent.parentId);
  nodes[grandparent.id] = replaceChild(grandparent, parent.id, siblingId);
  nodes[siblingId] = { ...sibling, parentId: grandparent.id };
  return { ...tree, nodes };
}

export function deletePane(
  tree: LayoutTree,
  paneId: PaneId,
  makeId: MakeId,
  now: number,
): LayoutTree {
  requirePane(tree, paneId);

  if (isDocked(tree, paneId)) {
    const nodes = { ...tree.nodes };
    delete nodes[paneId];
    return {
      ...tree,
      nodes,
      dock: tree.dock.filter((entry) => entry.paneId !== paneId),
    };
  }

  const detached = detachLeaf(tree, paneId, makeId, now);
  const nodes = { ...detached.nodes };
  delete nodes[paneId];
  return { ...detached, nodes };
}

/**
 * Lifts a pane out of the tree into the dock strip. The pane node stays alive,
 * so its renderer keeps whatever the page was showing.
 */
export function dockPane(
  tree: LayoutTree,
  paneId: PaneId,
  makeId: MakeId,
  now: number,
): LayoutTree {
  if (isDocked(tree, paneId)) return tree;
  const pane = requirePane(tree, paneId);

  const detached = detachLeaf(tree, paneId, makeId, now);
  return {
    ...detached,
    nodes: { ...detached.nodes, [paneId]: { ...pane, parentId: null } },
    dock: [...detached.dock, { paneId, dockedAt: now }],
  };
}

/** Puts a docked pane back by splitting `hostPaneId`, which must be in the tree. */
export function undockPane(
  tree: LayoutTree,
  paneId: PaneId,
  hostPaneId: PaneId,
  direction: SplitDirection,
  makeId: MakeId,
): LayoutTree {
  if (!isDocked(tree, paneId)) {
    throw new Error(`Pane "${paneId}" is not docked`);
  }
  requirePane(tree, hostPaneId);
  if (isDocked(tree, hostPaneId)) {
    throw new Error(`Host pane "${hostPaneId}" is docked and cannot host`);
  }

  // Undock lands the pane after the host, which is what the two directions
  // meant before sides existed.
  const inserted = insertPaneBeside(
    tree,
    paneId,
    hostPaneId,
    direction === "row" ? "right" : "bottom",
    makeId,
  );
  return {
    ...inserted,
    dock: inserted.dock.filter((entry) => entry.paneId !== paneId),
  };
}
