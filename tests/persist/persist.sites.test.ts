/**
 * The round trip to disk for a pane's list of sites.
 *
 * Everything here writes to a real file through `bun:sqlite` and the real
 * repository, because what schema 2 fixes is the journey to disk and back: a
 * fake port would have agreed with the tree before the fix too.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serializeLayout } from "../../src/layout/layout.serializer.ts";
import { addSite, setActiveSite } from "../../src/layout/layout.sites.ts";
import { createTree, splitPane } from "../../src/layout/layout.tree.ts";
import { isPane, type LayoutTree, type PaneId } from "../../src/layout/layout.types.ts";
import { migrate, openWallDatabase } from "../../src/persist/persist.database.ts";
import { MIGRATIONS } from "../../src/persist/persist.migrations.ts";
import { createWallRepository } from "../../src/persist/persist.repository.ts";
import {
  DEFAULT_WALL_SETTINGS,
  type WallSnapshot,
} from "../../src/persist/persist.types.ts";

let dataDir: string;
let dbPath: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "noc-sites-"));
  dbPath = join(dataDir, "noc.sqlite");
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function openFile(now: number) {
  const opened = openWallDatabase(dbPath, now);
  if (!opened.ok) throw new Error(opened.reason);
  return opened;
}

function paneOf(tree: LayoutTree, paneId: PaneId) {
  const node = tree.nodes[paneId];
  if (node === undefined || !isPane(node)) throw new Error(`"${paneId}" is not a pane`);
  return node;
}

describe("a pane's sites survive a restart", () => {
  test("three sites come back in the same order, with the same one active", () => {
    let counter = 0;
    const makeId = () => `n${(counter += 1)}`;
    let tree = createTree(makeId, 1000);
    const paneId = tree.rootId;
    tree = addSite(tree, paneId, "https://one.example/", makeId, 1100);
    tree = addSite(tree, paneId, "https://two.example/", makeId, 1200);
    tree = addSite(tree, paneId, "https://three.example/", makeId, 1300);
    const [, middle] = paneOf(tree, paneId).sites;
    if (middle === undefined) throw new Error("expected three sites");
    tree = setActiveSite(tree, paneId, middle.id);

    const snapshot: WallSnapshot = {
      layout: serializeLayout(tree),
      settings: { ...DEFAULT_WALL_SETTINGS },
      currentUrls: { [paneId]: "https://two.example/dashboard" },
    };

    const first = openFile(1);
    createWallRepository(first.db, () => 2).saveWall(snapshot);
    first.db.close();

    const second = openFile(3);
    const loaded = createWallRepository(second.db, () => 4).loadWall();
    second.db.close();

    expect(loaded).toEqual({ ...snapshot, settings: { ...DEFAULT_WALL_SETTINGS } });
    const restored = paneOf(loaded?.layout.tree as LayoutTree, paneId);
    expect(restored.sites.map((site) => site.url)).toEqual([
      "https://one.example/",
      "https://two.example/",
      "https://three.example/",
    ]);
    expect(restored.activeSiteId).toBe(middle.id);
  });

  test("a second save does not accumulate the sites of the first", () => {
    let counter = 0;
    const makeId = () => `n${(counter += 1)}`;
    let tree = createTree(makeId, 1000);
    const paneId = tree.rootId;
    tree = addSite(tree, paneId, "https://one.example/", makeId, 1100);
    tree = addSite(tree, paneId, "https://two.example/", makeId, 1200);

    const opened = openFile(1);
    const repository = createWallRepository(opened.db, () => 2);
    const base = { settings: { ...DEFAULT_WALL_SETTINGS }, currentUrls: {} };
    repository.saveWall({ ...base, layout: serializeLayout(tree) });

    const trimmed = addSite(
      createTree(() => paneId, 1000),
      paneId,
      "https://only.example/",
      makeId,
      1400,
    );
    repository.saveWall({ ...base, layout: serializeLayout(trimmed) });

    const rows = opened.db
      .query<{ count: number }, []>("SELECT count(*) AS count FROM pane_sites")
      .get();
    const loaded = repository.loadWall();
    opened.db.close();

    expect(rows?.count).toBe(1);
    expect(paneOf(loaded?.layout.tree as LayoutTree, paneId).sites).toHaveLength(1);
  });

  test("two panes keep their own lists apart", () => {
    let counter = 0;
    const makeId = () => `n${(counter += 1)}`;
    const root = createTree(makeId, 1000);
    let tree = splitPane(root, root.rootId, "row", makeId, 1100);
    const [left, right] = Object.values(tree.nodes)
      .filter(isPane)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((pane) => pane.id);
    if (left === undefined || right === undefined) throw new Error("expected two panes");
    tree = addSite(tree, left, "https://left-a.example/", makeId, 1200);
    tree = addSite(tree, left, "https://left-b.example/", makeId, 1300);
    tree = addSite(tree, right, "https://right.example/", makeId, 1400);

    const opened = openFile(1);
    const repository = createWallRepository(opened.db, () => 2);
    repository.saveWall({
      layout: serializeLayout(tree),
      settings: { ...DEFAULT_WALL_SETTINGS },
      currentUrls: {},
    });
    const loaded = repository.loadWall();
    opened.db.close();

    const restored = loaded?.layout.tree as LayoutTree;
    expect(paneOf(restored, left).sites.map((site) => site.url)).toEqual([
      "https://left-a.example/",
      "https://left-b.example/",
    ]);
    expect(paneOf(restored, right).sites.map((site) => site.url)).toEqual([
      "https://right.example/",
    ]);
  });
});

/**
 * Builds the schema exactly as version 1 shipped it and fills it the way the
 * old build did — a layout stamped version 1, panes carrying `home_url`, no
 * `pane_sites` table at all. This is what sits on a user's disk today.
 */
function seedVersion1Database(path: string): void {
  const db = new Database(path, { create: true });
  db.run("PRAGMA foreign_keys = ON");
  const first = MIGRATIONS[0];
  if (first === undefined || first.version !== 1) {
    throw new Error("expected migration step 1 to exist");
  }
  for (const statement of first.statements) db.run(statement);
  db.run(
    `CREATE TABLE IF NOT EXISTS schema_version (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       version INTEGER NOT NULL,
       applied_at INTEGER NOT NULL)`,
  );
  db.run("INSERT INTO schema_version (id, version, applied_at) VALUES (1, 1, 1)");

  db.run(
    "INSERT INTO layouts (id, root_id, layout_version, updated_at) VALUES ('live', 'split-1', 1, 1)",
  );
  db.run(
    `INSERT INTO splits (id, layout_id, parent_id, direction, child_a, child_b, size_a, size_b)
     VALUES ('split-1', 'live', NULL, 'row', 'pane-a', 'pane-b', 0.5, 0.5)`,
  );
  const pane = db.query(
    `INSERT INTO panes (id, layout_id, parent_id, home_url, current_url,
                        url_bar_visible, strategy, created_at)
     VALUES (?, 'live', 'split-1', ?, ?, 1, ?, ?)`,
  );
  pane.run("pane-a", "https://grafana.internal/d/one", "https://grafana.internal/d/one?x=1", "auto", 1000);
  pane.run("pane-b", null, null, "webview", 2000);
  db.close();
}

describe("a wall stored by the version 1 schema still opens", () => {
  test("its address becomes one site, active, at position 0", () => {
    seedVersion1Database(dbPath);

    const opened = openFile(10);
    expect(opened.version).toBe(2);
    const loaded = createWallRepository(opened.db, () => 11).loadWall();

    const stamp = opened.db
      .query<{ layout_version: number }, []>(
        "SELECT layout_version FROM layouts WHERE id = 'live'",
      )
      .get();
    opened.db.close();

    const tree = loaded?.layout.tree as LayoutTree;
    const migrated = paneOf(tree, "pane-a");
    expect(migrated.sites).toEqual([
      {
        id: "pane-a-s1",
        url: "https://grafana.internal/d/one",
        createdAt: 1000,
      },
    ]);
    expect(migrated.activeSiteId).toBe("pane-a-s1");
    // Where it had actually navigated to is per pane and keeps its own column.
    expect(loaded?.currentUrls["pane-a"]).toBe("https://grafana.internal/d/one?x=1");
    // A pane that never held an address gets no site rather than an empty one.
    expect(paneOf(tree, "pane-b").sites).toEqual([]);
    expect(paneOf(tree, "pane-b").activeSiteId).toBeNull();
    // The rows now describe a version 2 tree, so the stamp has to agree or the
    // next read re-runs the 1 → 2 tree migration and wipes what it restored.
    expect(stamp?.layout_version).toBe(2);
  });

  test("the migrated wall can then grow sites and still round-trips", () => {
    seedVersion1Database(dbPath);

    const first = openFile(10);
    const repository = createWallRepository(first.db, () => 11);
    const loaded = repository.loadWall();
    if (loaded === null) throw new Error("expected a stored wall");
    let tree = loaded.layout.tree;
    tree = addSite(tree, "pane-a", "https://kibana.internal/", () => "site-x", 3000);
    repository.saveWall({ ...loaded, layout: serializeLayout(tree) });
    first.db.close();

    const second = openFile(12);
    const reopened = createWallRepository(second.db, () => 13).loadWall();
    second.db.close();

    const restored = paneOf(reopened?.layout.tree as LayoutTree, "pane-a");
    expect(restored.sites.map((site) => site.id)).toEqual(["pane-a-s1", "site-x"]);
    expect(restored.activeSiteId).toBe("site-x");
  });

  test("replaying the migration on an already migrated file changes nothing", () => {
    seedVersion1Database(dbPath);

    const opened = openFile(10);
    // Forcing the version row back is the state an interrupted upgrade leaves:
    // the table is there, the row says it is not.
    opened.db.run("UPDATE schema_version SET version = 1 WHERE id = 1");
    expect(migrate(opened.db, 20)).toBe(2);

    const sites = opened.db
      .query<{ site_id: string; position: number }, []>(
        "SELECT site_id, position FROM pane_sites WHERE pane_id = 'pane-a'",
      )
      .all();
    opened.db.close();

    expect(sites).toEqual([{ site_id: "pane-a-s1", position: 0 }]);
  });
});
