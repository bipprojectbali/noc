/**
 * Row mapping between the `panes` / `splits` / `dock` tables and a `LayoutTree`.
 *
 * The rebuilt tree is handed to `parseLayout`, so a stored wall goes through the
 * same version migration and the same structural checks as any other persisted
 * layout instead of being trusted because it came from our own database.
 */

import type { Database } from "bun:sqlite";

import { parseLayout, serializeLayout } from "../layout/layout.serializer.ts";
import {
  isPane,
  type LayoutNode,
  type LayoutTree,
  type NodeId,
  type PaneId,
  type PaneStrategy,
  type SplitDirection,
} from "../layout/layout.types.ts";
import type { WallSnapshot } from "./persist.types.ts";

/** A snapshot without the wall-wide settings, which are not stored per layout. */
export type StoredLayout = Omit<WallSnapshot, "settings">;

type LayoutRow = { root_id: string; layout_version: number };
type PaneRow = {
  id: string;
  parent_id: string | null;
  home_url: string | null;
  current_url: string | null;
  url_bar_visible: number;
  strategy: string;
  created_at: number;
};
type SplitRow = {
  id: string;
  parent_id: string | null;
  direction: string;
  child_a: string;
  child_b: string;
  size_a: number;
  size_b: number;
};
type DockRow = { pane_id: string; docked_at: number };

export function readLayout(db: Database, layoutId: string): StoredLayout | null {
  const header = db
    .query<LayoutRow, [string]>(
      "SELECT root_id, layout_version FROM layouts WHERE id = ?",
    )
    .get(layoutId);
  if (header === null) return null;

  const nodes: Record<NodeId, LayoutNode> = {};
  const currentUrls: Record<PaneId, string | null> = {};

  for (const row of db
    .query<PaneRow, [string]>(
      `SELECT id, parent_id, home_url, current_url, url_bar_visible, strategy, created_at
       FROM panes WHERE layout_id = ? ORDER BY created_at`,
    )
    .all(layoutId)) {
    nodes[row.id] = {
      id: row.id,
      kind: "pane",
      parentId: row.parent_id,
      url: row.home_url,
      urlBarVisible: row.url_bar_visible === 1,
      // Constrained by a CHECK on the column, so the stored value is always one
      // of the three the type allows.
      strategy: row.strategy as PaneStrategy,
      createdAt: row.created_at,
    };
    currentUrls[row.id] = row.current_url;
  }

  for (const row of db
    .query<SplitRow, [string]>(
      `SELECT id, parent_id, direction, child_a, child_b, size_a, size_b
       FROM splits WHERE layout_id = ?`,
    )
    .all(layoutId)) {
    nodes[row.id] = {
      id: row.id,
      kind: "split",
      parentId: row.parent_id,
      direction: row.direction as SplitDirection,
      children: [row.child_a, row.child_b],
      sizes: [row.size_a, row.size_b],
    };
  }

  const dock = db
    .query<DockRow, [string]>(
      "SELECT pane_id, docked_at FROM dock WHERE layout_id = ? ORDER BY position",
    )
    .all(layoutId)
    .map((row) => ({ paneId: row.pane_id, dockedAt: row.docked_at }));

  const tree: LayoutTree = { rootId: header.root_id, nodes, dock };
  // `parseLayout` migrates and checks the tree; `serializeLayout` re-stamps it
  // with the current version, which is the shape `StoredLayout` carries.
  return {
    layout: serializeLayout(parseLayout({ version: header.layout_version, tree })),
    currentUrls,
  };
}

/** Caller must wrap this in a transaction; it leaves the layout empty midway. */
export function writeLayout(
  db: Database,
  layoutId: string,
  snapshot: StoredLayout,
  now: number,
): void {
  const { tree } = snapshot.layout;

  db.run(
    `INSERT INTO layouts (id, root_id, layout_version, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET root_id = excluded.root_id,
                                    layout_version = excluded.layout_version,
                                    updated_at = excluded.updated_at`,
    [layoutId, tree.rootId, snapshot.layout.version, now],
  );
  // Replacing the whole node set beats diffing it: a wall holds tens of nodes,
  // and the alternative is reconciliation logic that can drift from the tree.
  db.run("DELETE FROM dock WHERE layout_id = ?", [layoutId]);
  db.run("DELETE FROM panes WHERE layout_id = ?", [layoutId]);
  db.run("DELETE FROM splits WHERE layout_id = ?", [layoutId]);

  const insertPane = db.query(
    `INSERT INTO panes (id, layout_id, parent_id, home_url, current_url,
                        url_bar_visible, strategy, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertSplit = db.query(
    `INSERT INTO splits (id, layout_id, parent_id, direction, child_a, child_b,
                         size_a, size_b)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const node of Object.values(tree.nodes)) {
    if (isPane(node)) {
      insertPane.run(
        node.id,
        layoutId,
        node.parentId,
        node.url,
        snapshot.currentUrls[node.id] ?? null,
        node.urlBarVisible ? 1 : 0,
        node.strategy,
        node.createdAt,
      );
    } else {
      insertSplit.run(
        node.id,
        layoutId,
        node.parentId,
        node.direction,
        node.children[0],
        node.children[1],
        node.sizes[0],
        node.sizes[1],
      );
    }
  }

  const insertDock = db.query(
    "INSERT INTO dock (layout_id, pane_id, position, docked_at) VALUES (?, ?, ?, ?)",
  );
  tree.dock.forEach((entry, position) => {
    insertDock.run(layoutId, entry.paneId, position, entry.dockedAt);
  });
}
