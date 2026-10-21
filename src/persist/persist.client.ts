/**
 * Browser side of the storage seam: a `WallPersistPort` backed by HTTP.
 *
 * Nothing here knows the server keeps a SQLite file; swapping in browser
 * storage or a remote service means replacing this file only. Writes go
 * through the coalescing writer, which is what keeps a splitter drag from
 * turning into one request per animation frame.
 */

import {
  WALL_PATH,
  WALL_VIEWS_PATH,
} from "../server/server.routes.ts";
import { createCoalescingWriter } from "./persist.writer.ts";
import type {
  SavedViewSummary,
  WallPersistPort,
  WallSnapshot,
} from "./persist.types.ts";
import { parseWallSnapshot } from "./persist.validate.ts";

/**
 * Slowest the wall may be written while the user is still dragging. Long enough
 * that a 60 Hz drag collapses to a handful of writes, short enough that a crash
 * mid-drag loses at most a third of a second of adjustment.
 */
export const WALL_WRITE_INTERVAL_MS = 300;

export type WallClientOptions = {
  /** Called for every write that failed, so a lost save is never silent. */
  onError: (message: string) => void;
  minIntervalMs?: number;
  fetchImpl?: typeof fetch;
};

function viewPath(name: string): string {
  return `${WALL_VIEWS_PATH}/${encodeURIComponent(name)}`;
}

/** Reads the server's error message, falling back to the status code. */
async function describeFailure(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error !== "") return body.error;
  } catch {
    // An empty or non-JSON body is not worth reporting over the status code.
  }
  return `The wall server answered ${response.status}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createWallClient(options: WallClientOptions): WallPersistPort {
  const call = options.fetchImpl ?? fetch;

  const request = async (path: string, init?: RequestInit): Promise<Response> => {
    const response = await call(path, init);
    if (!response.ok) throw new Error(await describeFailure(response));
    return response;
  };

  const readSnapshot = async (path: string): Promise<WallSnapshot | null> => {
    const response = await call(path);
    // A view the user asked for by a name that is gone is an absence, not a
    // failure: the caller gets null and decides what to say about it.
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(await describeFailure(response));

    const body = (await response.json()) as { snapshot?: unknown };
    if (body.snapshot === null || body.snapshot === undefined) return null;
    // Validated on arrival as well as on the way in: a row edited by hand must
    // not be able to put a malformed tree into the store.
    return parseWallSnapshot(body.snapshot);
  };

  const put = (path: string, snapshot: WallSnapshot): Promise<Response> =>
    request(path, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snapshot),
    });

  const writer = createCoalescingWriter<WallSnapshot>({
    minIntervalMs: options.minIntervalMs ?? WALL_WRITE_INTERVAL_MS,
    write: (snapshot) => put(WALL_PATH, snapshot).then(() => undefined),
    onError: (error) => {
      options.onError(`The wall could not be saved: ${messageOf(error)}`);
    },
  });

  return {
    loadWall: () => readSnapshot(WALL_PATH),
    saveWall: (snapshot) => writer.push(snapshot),
    flush: () => writer.flush(),

    async listViews(): Promise<SavedViewSummary[]> {
      const body = (await (await request(WALL_VIEWS_PATH)).json()) as {
        views?: SavedViewSummary[];
      };
      return body.views ?? [];
    },

    async saveView(name, snapshot) {
      await put(viewPath(name), snapshot);
    },

    loadView: (name) => readSnapshot(viewPath(name)),

    async deleteView(name) {
      await request(viewPath(name), { method: "DELETE" });
    },
  };
}
