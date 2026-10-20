/** Shape of the pane tree. Geometry is never stored here — it is derived from the DOM. */

export type NodeId = string;
export type PaneId = NodeId;

/** `row` splits left|right, `column` splits top|bottom. */
export type SplitDirection = "row" | "column";

/**
 * Which edge of a host pane an incoming pane lands on. A drop target is an edge,
 * not a direction plus a slot index, so the two are derived from it rather than
 * passed around separately and risking a mismatch.
 */
export type PaneSide = "left" | "right" | "top" | "bottom";

export function sideToDirection(side: PaneSide): SplitDirection {
  return side === "left" || side === "right" ? "row" : "column";
}

/** True when the incoming pane takes the first child slot of the new split. */
export function sideIsLeading(side: PaneSide): boolean {
  return side === "left" || side === "top";
}

/**
 * Which renderer serves a pane. Resolved per pane because the wall mixes
 * internal dashboards (plain iframe) with sites that refuse framing.
 */
export type PaneStrategy = "auto" | "iframe" | "webview";

/**
 * Identifies one address inside a pane. Unique across the whole wall, not per
 * pane, so anything keyed by site needs no pane id beside it. Alnum, `-` and
 * `_` only: Rust's `pane_label` rejects anything else.
 */
export type SiteId = string;

/** One address a pane holds. A pane with several of them offers a switcher. */
export type PaneSite = {
  id: SiteId;
  url: string;
  /** Creation order. See `layout.sites.ts` for why it is never re-sorted. */
  createdAt: number;
  /**
   * How much this page is magnified, 1 being 100%. Per site and not per pane:
   * a pane holds several pages at once, and a dense dashboard beside a sparse
   * one needs its own answer. `layout.zoom.ts` owns the ladder and the clamp.
   */
  zoom: number;
};

export type PaneNode = {
  id: PaneId;
  kind: "pane";
  parentId: NodeId | null;
  /** Creation order, never reordered. `layout.sites.ts` explains the cost. */
  sites: PaneSite[];
  /** Which site is on screen. `null` exactly when `sites` is empty. */
  activeSiteId: SiteId | null;
  urlBarVisible: boolean;
  strategy: PaneStrategy;
  /** Creation order. Keeps the flat pane layer in a stable order forever. */
  createdAt: number;
};

export type SplitNode = {
  id: NodeId;
  kind: "split";
  parentId: NodeId | null;
  direction: SplitDirection;
  children: [NodeId, NodeId];
  /** Fractions of the parent along `direction`. Always sums to 1. */
  sizes: [number, number];
};

export type LayoutNode = PaneNode | SplitNode;

/** A pane lifted out of the tree into the dock strip, kept alive and restorable. */
export type DockedPane = {
  paneId: PaneId;
  dockedAt: number;
};

export type LayoutTree = {
  rootId: NodeId;
  nodes: Record<NodeId, LayoutNode>;
  /** Docked panes, oldest first. Their nodes stay in `nodes` but leave the tree. */
  dock: DockedPane[];
};

export function isPane(node: LayoutNode): node is PaneNode {
  return node.kind === "pane";
}

export function isSplit(node: LayoutNode): node is SplitNode {
  return node.kind === "split";
}
