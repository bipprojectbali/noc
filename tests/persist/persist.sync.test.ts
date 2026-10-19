import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { serializeLayout } from "../../src/layout/layout.serializer.ts";
import { createTree } from "../../src/layout/layout.tree.ts";
import { createWallClient } from "../../src/persist/persist.client.ts";
import {
  startWallPersistence,
  type WallPersistence,
} from "../../src/persist/persist.sync.ts";
import { DEFAULT_WALL_SETTINGS } from "../../src/persist/persist.types.ts";
import { useWallStore } from "../../src/pane/pane.store.ts";

const ROOT = "root";
const STORED_ROOT = "stored";

type Recorded = { method: string; body: unknown };

let persistence: WallPersistence | null = null;

beforeEach(() => {
  useWallStore.setState({
    tree: createTree(() => ROOT, 1),
    load: {},
    urlError: {},
    persistence: { kind: "loading" },
  });
});

afterEach(() => {
  persistence?.stop();
  persistence = null;
});

/**
 * A stand-in for the wall server that answers GET with `getResponse` and
 * records every PUT. Only the wire is faked; the real client parses and
 * validates what comes back.
 */
function fakeWallServer(getResponse: () => Response) {
  const requests: Recorded[] = [];
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    requests.push({
      method,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    if (method === "GET") return getResponse();
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  return {
    fetchImpl,
    writes: () => requests.filter((request) => request.method === "PUT"),
  };
}

/** A stored wall with one pane and no URL, so restoring it probes nothing. */
function storedSnapshot(): unknown {
  return {
    layout: serializeLayout(createTree(() => STORED_ROOT, 5)),
    settings: DEFAULT_WALL_SETTINGS,
    currentUrls: {},
  };
}

describe("restoring the wall at start", () => {
  test("applies the stored layout and does not write it straight back", async () => {
    const server = fakeWallServer(() => Response.json({ snapshot: storedSnapshot() }));
    const client = createWallClient({
      onError: () => {},
      fetchImpl: server.fetchImpl,
      minIntervalMs: 0,
    });

    persistence = startWallPersistence(client, useWallStore);
    await persistence.ready;
    await client.flush();

    expect(useWallStore.getState().tree.rootId).toBe(STORED_ROOT);
    expect(useWallStore.getState().persistence).toEqual({ kind: "ready" });
    expect(server.writes()).toHaveLength(0);
  });

  test("a change after the restore is saved with the restored pane in it", async () => {
    const server = fakeWallServer(() => Response.json({ snapshot: storedSnapshot() }));
    const client = createWallClient({
      onError: () => {},
      fetchImpl: server.fetchImpl,
      minIntervalMs: 0,
    });

    persistence = startWallPersistence(client, useWallStore);
    await persistence.ready;
    useWallStore.getState().splitPane(STORED_ROOT, "row");
    await client.flush();

    const writes = server.writes();
    expect(writes).toHaveLength(1);
    const saved = writes[0]!.body as { layout: { tree: { nodes: object } } };
    // The restored pane, the split that now holds it, and the new pane.
    expect(Object.keys(saved.layout.tree.nodes)).toHaveLength(3);
    expect(Object.keys(saved.layout.tree.nodes)).toContain(STORED_ROOT);
  });
});

describe("a stored layout that cannot be read is never overwritten", () => {
  test("a failed load holds every save back and says why", async () => {
    const server = fakeWallServer(
      () =>
        new Response(
          JSON.stringify({ error: "The wall database could not read the wall: disk I/O" }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
    );
    const client = createWallClient({
      onError: () => {},
      fetchImpl: server.fetchImpl,
      minIntervalMs: 0,
    });

    persistence = startWallPersistence(client, useWallStore);
    await persistence.ready;
    useWallStore.getState().splitPane(ROOT, "row");
    await client.flush();

    expect(server.writes()).toHaveLength(0);
    expect(useWallStore.getState().persistence).toEqual({
      kind: "unavailable",
      message: expect.stringContaining("disk I/O"),
    });
  });

  test("a first start with nothing stored saves the first change", async () => {
    const server = fakeWallServer(() => Response.json({ snapshot: null }));
    const client = createWallClient({
      onError: () => {},
      fetchImpl: server.fetchImpl,
      minIntervalMs: 0,
    });

    persistence = startWallPersistence(client, useWallStore);
    await persistence.ready;
    expect(useWallStore.getState().persistence).toEqual({ kind: "ready" });
    expect(server.writes()).toHaveLength(0);

    useWallStore.getState().splitPane(ROOT, "row");
    await client.flush();

    expect(server.writes()).toHaveLength(1);
  });
});
