import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serializeLayout } from "../../src/layout/layout.serializer.ts";
import { createTree, splitPane } from "../../src/layout/layout.tree.ts";
import { openWallDatabase } from "../../src/persist/persist.database.ts";
import { createWallRepository } from "../../src/persist/persist.repository.ts";
import {
  DEFAULT_WALL_SETTINGS,
  type WallSnapshot,
} from "../../src/persist/persist.types.ts";
import { createWallRoutes, type WallAccess } from "../../src/server/server.wall.ts";

let dataDir: string;
let dbPath: string;
let counter = 0;

const makeId = () => {
  counter += 1;
  return `pane-${counter}`;
};

/** A wall with two panes, neither holding an address yet. */
function sampleSnapshot(): WallSnapshot {
  const root = createTree(makeId, 1000);
  const tree = splitPane(root, root.rootId, "row", makeId, 1100);
  return {
    layout: serializeLayout(tree),
    settings: { ...DEFAULT_WALL_SETTINGS },
  };
}

function openFile(now: number) {
  const opened = openWallDatabase(dbPath, now);
  if (!opened.ok) throw new Error(opened.reason);
  return opened;
}

beforeEach(() => {
  // A real file in a real directory: the point is that a restart reads it back,
  // which an in-memory database cannot show.
  dataDir = mkdtempSync(join(tmpdir(), "noc-persist-"));
  dbPath = join(dataDir, "noc.sqlite");
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("the wall survives a restart", () => {
  test("a saved wall is read back unchanged after the database is closed and reopened", () => {
    const snapshot = sampleSnapshot();

    const first = openFile(1);
    createWallRepository(first.db, () => 2).saveWall(snapshot);
    first.db.close();

    const second = openFile(3);
    const loaded = createWallRepository(second.db, () => 4).loadWall();
    second.db.close();

    expect(loaded).toEqual(snapshot);
  });

  test("the pane cap a fresh wall starts with is 12", () => {
    expect(DEFAULT_WALL_SETTINGS.paneCap).toBe(12);

    const opened = openFile(1);
    const repository = createWallRepository(opened.db, () => 2);
    expect(repository.loadWall()).toBeNull();
    repository.saveWall(sampleSnapshot());
    expect(repository.loadWall()?.settings.paneCap).toBe(12);
    opened.db.close();
  });

  test("a second save replaces the first rather than adding to it", () => {
    const first = openFile(1);
    const repository = createWallRepository(first.db, () => 2);
    repository.saveWall(sampleSnapshot());

    const replacement: WallSnapshot = {
      ...sampleSnapshot(),
      settings: { ...DEFAULT_WALL_SETTINGS, urlBarVisibleByDefault: false },
    };
    repository.saveWall(replacement);
    first.db.close();

    const second = openFile(3);
    const loaded = createWallRepository(second.db, () => 4).loadWall();
    second.db.close();

    expect(loaded?.settings.urlBarVisibleByDefault).toBe(false);
    expect(Object.keys(loaded?.layout.tree.nodes ?? {})).toHaveLength(
      Object.keys(replacement.layout.tree.nodes).length,
    );
  });

  test("a saved view comes back by its name after a restart and disappears when deleted", async () => {
    const snapshot = sampleSnapshot();

    const first = openFile(1);
    const repository = createWallRepository(first.db, () => 2);
    repository.saveView("ops", snapshot);
    first.db.close();

    const second = openFile(3);
    const reopened = createWallRepository(second.db, () => 4);
    expect(reopened.listViews().map((view) => view.name)).toEqual(["ops"]);
    expect(reopened.loadView("ops")).toEqual({
      ...snapshot,
      settings: { ...DEFAULT_WALL_SETTINGS },
    });

    reopened.deleteView("ops");
    expect(reopened.loadView("ops")).toBeNull();
    second.db.close();
  });
});

describe("the HTTP surface reads back what it stored", () => {
  function accessFor(repository: ReturnType<typeof createWallRepository>): WallAccess {
    return { ok: true, repository };
  }

  test("a reload gets back the wall that was saved", async () => {
    const snapshot = sampleSnapshot();
    const opened = openFile(1);
    const routes = createWallRoutes(accessFor(createWallRepository(opened.db, () => 2)));

    const saved = await routes.putWall(
      new Request("http://127.0.0.1/api/wall", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(snapshot),
      }),
    );
    expect(saved.status).toBe(204);

    const reloaded = await routes.getWall();
    expect(reloaded.status).toBe(200);
    const body = (await reloaded.json()) as { snapshot: WallSnapshot };
    opened.db.close();

    expect(body.snapshot).toEqual(snapshot);
  });

  test("a payload that is not a wall is refused and nothing is written", async () => {
    const opened = openFile(1);
    const repository = createWallRepository(opened.db, () => 2);
    const routes = createWallRoutes(accessFor(repository));

    const refused = await routes.putWall(
      new Request("http://127.0.0.1/api/wall", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ layout: { version: 1, tree: "not a tree" } }),
      }),
    );
    const stored = repository.loadWall();
    opened.db.close();

    expect(refused.status).toBe(400);
    expect(stored).toBeNull();
  });

  test("a database that could not be opened answers 503 instead of pretending to save", async () => {
    const routes = createWallRoutes({ ok: false, reason: "disk is read-only" });

    const response = await routes.getWall();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "disk is read-only" });
  });
});
