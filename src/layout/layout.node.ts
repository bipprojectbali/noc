/** Node accessors shared by the tree operations. Every lookup fails loudly. */

import {
  isPane,
  isSplit,
  type LayoutNode,
  type LayoutTree,
  type NodeId,
  type PaneId,
  type PaneNode,
  type SplitNode,
} from "./layout.types.ts";

export function requireNode(tree: LayoutTree, id: NodeId): LayoutNode {
  const node = tree.nodes[id];
  if (node === undefined) {
    throw new Error(`Layout node "${id}" does not exist`);
  }
  return node;
}

export function requirePane(tree: LayoutTree, id: PaneId): PaneNode {
  const node = requireNode(tree, id);
  if (!isPane(node)) {
    throw new Error(`Layout node "${id}" is a split, not a pane`);
  }
  return node;
}

export function requireSplit(tree: LayoutTree, id: NodeId): SplitNode {
  const node = requireNode(tree, id);
  if (!isSplit(node)) {
    throw new Error(`Layout node "${id}" is a pane, not a split`);
  }
  return node;
}

export function newPane(
  id: PaneId,
  now: number,
  parentId: NodeId | null,
): PaneNode {
  return {
    id,
    kind: "pane",
    parentId,
    sites: [],
    activeSiteId: null,
    urlBarVisible: true,
    strategy: "auto",
    createdAt: now,
  };
}

/** Replaces one child id with another in a split, keeping its slot and sizes. */
export function replaceChild(
  split: SplitNode,
  from: NodeId,
  to: NodeId,
): SplitNode {
  const children: [NodeId, NodeId] = [...split.children];
  const index = children.indexOf(from);
  if (index === -1) {
    throw new Error(`Split "${split.id}" has no child "${from}"`);
  }
  children[index as 0 | 1] = to;
  return { ...split, children };
}
