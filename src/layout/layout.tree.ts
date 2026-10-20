/** Pure structural operations that add to the pane tree. No DOM, no React. */

import {
  newPane,
  replaceChild,
  requirePane,
  requireSplit,
  requireNode,
} from "./layout.node.ts";
import { removeSite, setSiteUrl } from "./layout.sites.ts";
import {
  isPane,
  sideIsLeading,
  sideToDirection,
  type LayoutNode,
  type LayoutTree,
  type NodeId,
  type PaneId,
  type PaneNode,
  type PaneSide,
  type PaneStrategy,
  type SplitDirection,
  type SplitNode,
} from "./layout.types.ts";

/** Smallest fraction a split child may hold, so a pane can never collapse to nothing. */
export const MIN_FRACTION = 0.05;

export type MakeId = () => NodeId;

export function createTree(makeId: MakeId, now: number): LayoutTree {
  const rootId = makeId();
  return {
    rootId,
    nodes: { [rootId]: newPane(rootId, now, null) },
    dock: [],
  };
}

/** True when the pane exists but sits in the dock instead of the tree. */
export function isDocked(tree: LayoutTree, paneId: PaneId): boolean {
  return tree.dock.some((entry) => entry.paneId === paneId);
}

/** Panes currently placed in the tree, in creation order. */
export function listTreePaneIds(tree: LayoutTree): PaneId[] {
  const found: PaneNode[] = [];
  const walk = (id: NodeId): void => {
    const node = requireNode(tree, id);
    if (isPane(node)) {
      found.push(node);
      return;
    }
    walk(node.children[0]);
    walk(node.children[1]);
  };
  walk(tree.rootId);
  return found.sort((a, b) => a.createdAt - b.createdAt).map((pane) => pane.id);
}

export function splitPane(
  tree: LayoutTree,
  paneId: PaneId,
  direction: SplitDirection,
  makeId: MakeId,
  now: number,
): LayoutTree {
  const pane = requirePane(tree, paneId);
  if (isDocked(tree, paneId)) {
    throw new Error(`Pane "${paneId}" is docked and cannot be split in place`);
  }

  const splitId = makeId();
  const addedId = makeId();
  const split: SplitNode = {
    id: splitId,
    kind: "split",
    parentId: pane.parentId,
    direction,
    children: [paneId, addedId],
    sizes: [0.5, 0.5],
  };

  const nodes: Record<NodeId, LayoutNode> = {
    ...tree.nodes,
    // The original pane keeps its id: the pane layer must not see it as new.
    [paneId]: { ...pane, parentId: splitId },
    [addedId]: newPane(addedId, now, splitId),
    [splitId]: split,
  };

  if (pane.parentId === null) {
    return { ...tree, rootId: splitId, nodes };
  }

  const parent = requireSplit(tree, pane.parentId);
  nodes[parent.id] = replaceChild(parent, paneId, splitId);
  return { ...tree, nodes };
}

/**
 * Wraps `hostPaneId` in a fresh split and puts an *existing* pane node in the
 * other slot. Shared by undock and move: both re-enter a pane the wall already
 * renders, so neither may mint a pane id — only the split node is new.
 *
 * The new split inherits the host's slot (and therefore its share of the
 * grandparent), while the two panes inside it start at 0.5/0.5, exactly like
 * `splitPane`. Callers must not pass `paneId === hostPaneId`; a split with the
 * same child twice is a malformed tree.
 */
export function insertPaneBeside(
  tree: LayoutTree,
  paneId: PaneId,
  hostPaneId: PaneId,
  side: PaneSide,
  makeId: MakeId,
): LayoutTree {
  const host = requirePane(tree, hostPaneId);
  const pane = requirePane(tree, paneId);

  const splitId = makeId();
  const children: [NodeId, NodeId] = sideIsLeading(side)
    ? [paneId, hostPaneId]
    : [hostPaneId, paneId];
  const split: SplitNode = {
    id: splitId,
    kind: "split",
    parentId: host.parentId,
    direction: sideToDirection(side),
    children,
    sizes: [0.5, 0.5],
  };

  const nodes: Record<NodeId, LayoutNode> = {
    ...tree.nodes,
    [hostPaneId]: { ...host, parentId: splitId },
    [paneId]: { ...pane, parentId: splitId },
    [splitId]: split,
  };

  if (host.parentId === null) {
    return { ...tree, rootId: splitId, nodes };
  }

  const parent = requireSplit(tree, host.parentId);
  nodes[parent.id] = replaceChild(parent, hostPaneId, splitId);
  return { ...tree, nodes };
}

export function resizeSplit(
  tree: LayoutTree,
  splitId: NodeId,
  first: number,
): LayoutTree {
  const split = requireSplit(tree, splitId);
  const clamped = Math.min(Math.max(first, MIN_FRACTION), 1 - MIN_FRACTION);
  return {
    ...tree,
    nodes: {
      ...tree.nodes,
      [splitId]: { ...split, sizes: [clamped, 1 - clamped] },
    },
  };
}

/**
 * Points the pane's active site at an address, or closes that site when given
 * `null` — which empties a pane that held only the one, exactly as a pane with
 * no url behaved before panes held lists.
 *
 * A pane with no site has nothing to point: giving the pane its *first*
 * address is `addSite`, because only that can mint an id. Callers branch on
 * `activeSiteId` rather than letting this guess, so a stale caller is loud.
 */
export function setPaneUrl(
  tree: LayoutTree,
  paneId: PaneId,
  url: string | null,
): LayoutTree {
  const pane = requirePane(tree, paneId);
  if (pane.activeSiteId === null) {
    if (url === null) return tree;
    throw new Error(`Pane "${paneId}" has no site to point at "${url}"`);
  }
  return url === null
    ? removeSite(tree, paneId, pane.activeSiteId)
    : setSiteUrl(tree, paneId, pane.activeSiteId, url);
}

export function setPaneUrlBarVisible(
  tree: LayoutTree,
  paneId: PaneId,
  visible: boolean,
): LayoutTree {
  const pane = requirePane(tree, paneId);
  return {
    ...tree,
    nodes: { ...tree.nodes, [paneId]: { ...pane, urlBarVisible: visible } },
  };
}

export function setPaneStrategy(
  tree: LayoutTree,
  paneId: PaneId,
  strategy: PaneStrategy,
): LayoutTree {
  const pane = requirePane(tree, paneId);
  return {
    ...tree,
    nodes: { ...tree.nodes, [paneId]: { ...pane, strategy } },
  };
}
