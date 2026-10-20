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

export type PaneNode = {
  id: PaneId;
  kind: "pane";
  parentId: NodeId | null;
  url: string | null;
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
