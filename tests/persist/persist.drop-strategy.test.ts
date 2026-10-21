/**
 * Schema 4 takes the renderer choice off `panes`, and it is the first step that
 * cannot do its work in place: SQLite refuses to drop a column named in a
 * `CHECK`, so the table is rebuilt and the rows are copied across.
 *
 * That makes it the first step whose replay rewrites a table rather than
 * skipping a statement, so the two things worth proving are that a populated
 * database comes through with every pane and every site intact, and that the
 * rebuild is not run a second time on a file that has already had it.
 *
 * A real file through `bun:sqlite`, seeded at version 3 by hand: the current
 * writer cannot produce that shape any more, and the shape is the whole point.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrate } from "../../src/persist/persist.database.ts";
import { MIGRATIONS } from "../../src/persist/persist.migrations.ts";
import { createWallRepository } from "../../src/persist/persist.repository.ts";
import { isPane, type LayoutTree } from "../../src/layout/layout.types.ts";

let dataDir: string;
let dbPath: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "noc-drop-strategy-"));
  dbPath = join(dataDir, "noc.sqlite");
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

type PaneRowShape = {
  id: string;
  layout_id: string;
  parent_id: string | null;
  home_url: string | null;
  current_url: string | null;
  url_bar_visible: number;
  created_at: number;
};

type SiteRowShape = {
  pane_id: string;
  site_id: string;
  position: number;
  url: string;
  created_at: number;
  is_active: number;
  zoom: number;
};

/**
 * The schema exactly as version 3 shipped it, filled the way that build filled
 * it: two panes under a split, three sites between them, one of them magnified,
 * and a `strategy` on every pane row.
 */
function seedVersion3Database(path: string): void {
  const db = new Database(path, { create: true });
  db.run("PRAGMA foreign_keys = ON");

  for (const step of MIGRATIONS) {
    if (step.version > 3) break;
    for (const statement of step.statements) db.run(statement);
  }
  db.run(
    `CREATE TABLE IF NOT EXISTS schema_version (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       version INTEGER NOT NULL,
       applied_at INTEGER NOT NULL)`,
  );
  db.run("INSERT INTO schema_version (id, version, applied_at) VALUES (1, 3, 1)");

  db.run(
    "INSERT INTO layouts (id, root_id, layout_version, updated_at) VALUES ('live', 'split-1', 3, 1)",
  );
  db.run(
    `INSERT INTO splits (id, layout_id, parent_id, direction, child_a, child_b, size_a, size_b)
     VALUES ('split-1', 'live', NULL, 'column', 'pane-a', 'pane-b', 0.7, 0.3)`,
  );
  const pane = db.query(
    `INSERT INTO panes (id, layout_id, parent_id, home_url, current_url,
                        url_bar_visible, strategy, created_at)
     VALUES (?, 'live', 'split-1', NULL, NULL, ?, ?, ?)`,
  );
  pane.run("pane-a", 1, "webview", 1000);
  pane.run("pane-b", 0, "iframe", 2000);

  const site = db.query(
    `INSERT INTO pane_sites
       (layout_id, pane_id, site_id, position, url, created_at, is_active, zoom)
     VALUES ('live', ?, ?, ?, ?, ?, ?, ?)`,
  );
  site.run("pane-a", "site-1", 0, "https://grafana.internal/d/one", 1100, 0, 1);
  site.run("pane-a", "site-2", 1, "https://kibana.internal/", 1200, 1, 1.5);
  site.run("pane-b", "site-3", 0, "https://status.internal/", 2100, 1, 1);
  db.close();
}

function paneRows(db: Database): PaneRowShape[] {
  return db
    .query<PaneRowShape, []>("SELECT * FROM panes ORDER BY created_at")
    .all();
}

function siteRows(db: Database): SiteRowShape[] {
  return db
    .query<SiteRowShape, []>(
      `SELECT pane_id, site_id, position, url, created_at, is_active, zoom
       FROM pane_sites ORDER BY pane_id, position`,
    )
    .all();
}

const EXPECTED_PANES: PaneRowShape[] = [
  {
    id: "pane-a",
    layout_id: "live",
    parent_id: "split-1",
    home_url: null,
    current_url: null,
    url_bar_visible: 1,
    created_at: 1000,
  },
  {
    id: "pane-b",
    layout_id: "live",
    parent_id: "split-1",
    home_url: null,
    current_url: null,
    url_bar_visible: 0,
    created_at: 2000,
  },
];

const EXPECTED_SITES: SiteRowShape[] = [
  {
    pane_id: "pane-a",
    site_id: "site-1",
    position: 0,
    url: "https://grafana.internal/d/one",
    created_at: 1100,
    is_active: 0,
    zoom: 1,
  },
  {
    pane_id: "pane-a",
    site_id: "site-2",
    position: 1,
    url: "https://kibana.internal/",
    created_at: 1200,
    is_active: 1,
    zoom: 1.5,
  },
  {
    pane_id: "pane-b",
    site_id: "site-3",
    position: 0,
    url: "https://status.internal/",
    created_at: 2100,
    is_active: 1,
    zoom: 1,
  },
];

describe("a populated version 3 wall survives losing the renderer column", () => {
  test("every pane and every site comes through the rebuild unchanged", () => {
    seedVersion3Database(dbPath);
    const db = new Database(dbPath);
    db.run("PRAGMA foreign_keys = ON");

    expect(migrate(db, 50)).toBe(4);

    // The column is gone, and nothing else is. `SELECT *` on purpose: a copy
    // that lost or reordered a column shows up here and nowhere else.
    expect(paneRows(db)).toEqual(EXPECTED_PANES);
    expect(siteRows(db)).toEqual(EXPECTED_SITES);
    // The index the dropped table owned is rebuilt, or every read of a wall
    // with many panes goes back to a scan.
    expect(
      db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'panes'",
        )
        .all()
        .map((row) => row.name),
    ).toContain("panes_layout_created_idx");
    db.close();
  });

  test("the rows describe a version 4 tree, and the stamp says so", () => {
    seedVersion3Database(dbPath);
    const db = new Database(dbPath);
    migrate(db, 50);

    const stamp = db
      .query<{ layout_version: number }, []>(
        "SELECT layout_version FROM layouts WHERE id = 'live'",
      )
      .get();
    expect(stamp?.layout_version).toBe(4);
    db.close();
  });

  test("the wall it restores still holds both panes and all three sites", () => {
    seedVersion3Database(dbPath);
    const db = new Database(dbPath);
    db.run("PRAGMA foreign_keys = ON");
    migrate(db, 50);

    const loaded = createWallRepository(db, () => 51).loadWall();
    db.close();
    const tree = loaded?.layout.tree as LayoutTree;

    const panes = Object.values(tree.nodes).filter(isPane);
    expect(panes.map((pane) => pane.id).sort()).toEqual(["pane-a", "pane-b"]);
    for (const pane of panes) expect(pane).not.toHaveProperty("strategy");

    const paneA = panes.find((pane) => pane.id === "pane-a");
    expect(paneA?.sites).toEqual([
      { id: "site-1", url: "https://grafana.internal/d/one", createdAt: 1100, zoom: 1 },
      { id: "site-2", url: "https://kibana.internal/", createdAt: 1200, zoom: 1.5 },
    ]);
    expect(paneA?.activeSiteId).toBe("site-2");
  });

  test("replaying the step on an already rebuilt file leaves the table alone", () => {
    seedVersion3Database(dbPath);
    const db = new Database(dbPath);
    db.run("PRAGMA foreign_keys = ON");
    migrate(db, 50);

    // A column added after the rebuild stands in for whatever a later step
    // puts on this table, and it is the only way to see the difference from
    // outside: run blind, the step rebuilds `panes` from a column list written
    // when `strategy` was the newest thing there, and anything added since is
    // dropped on the floor. With `dropsColumn` the step is skipped outright.
    db.run("ALTER TABLE panes ADD COLUMN added_later TEXT");
    // The state an upgrade interrupted after the rebuild but before the
    // version row leaves behind.
    db.run("UPDATE schema_version SET version = 3 WHERE id = 1");
    expect(migrate(db, 60)).toBe(4);

    expect(
      db
        .query<{ name: string }, []>("SELECT name FROM pragma_table_info('panes')")
        .all()
        .map((row) => row.name),
    ).toContain("added_later");
    expect(paneRows(db).map((row) => row.id)).toEqual(["pane-a", "pane-b"]);
    expect(siteRows(db)).toEqual(EXPECTED_SITES);
    db.close();
  });
});
