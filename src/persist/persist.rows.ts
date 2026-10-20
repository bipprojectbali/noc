/**
 * Row mapping between the `panes` / `pane_sites` / `splits` / `dock` tables and
 * a `LayoutTree`.
 *
 * The rebuilt tree is handed to `parseLayout`, so a stored wall goes through the
 * same version migration and the same structural checks as any other persisted
 * layout instead of being trusted because it came from our own database.
 *
 * Two pane columns are legacy, and both are left out of the INSERT so nothing
 * here writes them again. Neither is dropped, because dropping a column in
 * SQLite means rebuilding the table:
 *
 * - `home_url`: addresses live in `pane_sites` since schema 2, and its only
 *   remaining reader is that step's one-shot backfill.
 * - `current_url`: meant for a page a pane had navigated to by itself, which
 *   never differed from the site's own url — we only ever learn the `src` we
 *   set. Rows written before this still hold a value; nobody reads it.
 */

import type { Database } from "bun:sqlite";

import { parseLayout, serializeLayout } from "../layout/layout.serializer.ts";
import {
  isPane,
  type NodeId,
  type PaneId,
  type PaneNode,
  type PaneSite,
  type PaneStrategy,
  type SiteId,
  type SplitDirection,
  type SplitNode,
} from "../layout/layout.types.ts";
import type { WallSnapshot } from "./persist.types.ts";

/** A snapshot without the wall-wide settings, which are not stored per layout. */
export type StoredLayout = Omit<WallSnapshot, "settings">;

/**
 * The tree shape these rows express. Since schema 2 that is version 2: a pane's
 * sites each have a row, in order, with one of them flagged active. The
 * `layouts.layout_version` column records the version the rows were written at,
 * and the schema step that moved them forward re-stamped it — so a read never
 * runs a tree migration over rows that have already had it applied.
 */
const ROW_TREE_VERSION = 2;

type LayoutRow = { root_id: string; layout_version: number };
type PaneRow = {
  id: string;
  parent_id: string | null;
  url_bar_visible: number;
  strategy: string;
  created_at: number;
};
type PaneSiteRow = {
  pane_id: string;
  site_id: string;
  url: string;
  created_at: number;
  is_active: number;
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

type HeldSites = { sites: PaneSite[]; activeSiteId: SiteId | null };

/**
 * Sites per pane, in stored order. `ORDER BY position` is the whole contract:
 * the list is creation order and reordering it reloads pages (`layout.sites.ts`
 * explains why). Not `created_at` — two sites added in one millisecond tie.
 */
function readSites(db: Database, layoutId: string): Map<PaneId, HeldSites> {
  const byPane = new Map<PaneId, HeldSites>();
  for (const row of db
    .query<PaneSiteRow, [string]>(
      `SELECT pane_id, site_id, url, created_at, is_active
       FROM pane_sites WHERE layout_id = ? ORDER BY pane_id, position`,
    )
    .all(layoutId)) {
    let entry = byPane.get(row.pane_id);
    if (entry === undefined) {
      entry = { sites: [], activeSiteId: null };
      byPane.set(row.pane_id, entry);
    }
    entry.sites.push({ id: row.site_id, url: row.url, createdAt: row.created_at });
    if (row.is_active === 1) entry.activeSiteId = row.site_id;
  }
  return byPane;
}

export function readLayout(db: Database, layoutId: string): StoredLayout | null {
  const header = db
    .query<LayoutRow, [string]>(
      "SELECT root_id, layout_version FROM layouts WHERE id = ?",
    )
    .get(layoutId);
  if (header === null) return null;

  const nodes: Record<NodeId, PaneNode | SplitNode> = {};
  const sitesByPane = readSites(db, layoutId);

  for (const row of db
    .query<PaneRow, [string]>(
      `SELECT id, parent_id, url_bar_visible, strategy, created_at
       FROM panes WHERE layout_id = ? ORDER BY created_at`,
    )
    .all(layoutId)) {
    const held = sitesByPane.get(row.id);
    nodes[row.id] = {
      id: row.id,
      kind: "pane",
      parentId: row.parent_id,
      sites: held?.sites ?? [],
      // Left as stored even when it disagrees with `sites`: `assertWellFormed`
      // reports that below, and a quiet fallback would hide a damaged file.
      activeSiteId: held?.activeSiteId ?? null,
      urlBarVisible: row.url_bar_visible === 1,
      // Constrained by a CHECK on the column, so the stored value is always one
      // of the three the type allows.
      strategy: row.strategy as PaneStrategy,
      createdAt: row.created_at,
    };
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

  const tree = { rootId: header.root_id, nodes, dock };
  // `parseLayout` migrates and checks the tree; `serializeLayout` re-stamps it
  // with the current version, which is the shape `StoredLayout` carries.
  return {
    layout: serializeLayout(parseLayout({ version: header.layout_version, tree })),
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
    [layoutId, tree.rootId, ROW_TREE_VERSION, now],
  );
  // Replacing the whole node set beats diffing it: a wall holds tens of nodes,
  // and the alternative is reconciliation logic that can drift from the tree.
  // Cleared by hand — the only cascade is on `layouts`, whose row stays.
  db.run("DELETE FROM dock WHERE layout_id = ?", [layoutId]);
  db.run("DELETE FROM panes WHERE layout_id = ?", [layoutId]);
  db.run("DELETE FROM pane_sites WHERE layout_id = ?", [layoutId]);
  db.run("DELETE FROM splits WHERE layout_id = ?", [layoutId]);

  // `home_url` and `current_url` are both left out on purpose: writing an
  // address into either legacy column would invite a future reader to treat it
  // as the truth, and `pane_sites` is the truth.
  const insertPane = db.query(
    `INSERT INTO panes (id, layout_id, parent_id,
                        url_bar_visible, strategy, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertSite = db.query(
    `INSERT INTO pane_sites (layout_id, pane_id, site_id, position, url,
                             created_at, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
        node.urlBarVisible ? 1 : 0,
        node.strategy,
        node.createdAt,
      );
      // The array index is the position, so the list comes back as held.
      node.sites.forEach((site, position) => {
        insertSite.run(
          layoutId,
          node.id,
          site.id,
          position,
          site.url,
          site.createdAt,
          site.id === node.activeSiteId ? 1 : 0,
        );
      });
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
