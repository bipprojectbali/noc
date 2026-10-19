/**
 * HTTP surface of the wall database.
 *
 * The database lives in this Bun process, so the frontend reaches it through
 * these routes and nothing else. Every payload goes through `persist.validate`
 * first — the port is reachable by anything on the host, so a request is not
 * trusted just because it probably came from our own page.
 */

import { type NocConfig, databasePath } from "../config/config.env.ts";
import { openWallDatabase } from "../persist/persist.database.ts";
import {
  createWallRepository,
  type WallRepository,
} from "../persist/persist.repository.ts";
import type { WallSnapshot } from "../persist/persist.types.ts";
import {
  PersistInputError,
  parseViewName,
  parseWallSnapshot,
} from "../persist/persist.validate.ts";

/** Either a usable database or the reason there isn't one. */
export type WallAccess =
  | { ok: true; repository: WallRepository }
  | { ok: false; reason: string };

/**
 * Opens the wall database inside the data directory. The file is created on
 * first start; a file that cannot be used is reported, not replaced.
 */
export function openWallAccess(config: NocConfig, baseDir: string): WallAccess {
  const opened = openWallDatabase(databasePath(config, baseDir), Date.now());
  if (!opened.ok) return { ok: false, reason: opened.reason };
  return { ok: true, repository: createWallRepository(opened.db, Date.now) };
}

/** Bun fills `params` from the `:name` segment of the route pattern. */
export type WallViewRequest = Request & { params: { name: string } };

export type WallRouteHandlers = {
  getWall: () => Promise<Response>;
  putWall: (request: Request) => Promise<Response>;
  listViews: () => Promise<Response>;
  getView: (request: WallViewRequest) => Promise<Response>;
  putView: (request: WallViewRequest) => Promise<Response>;
  deleteView: (request: WallViewRequest) => Promise<Response>;
};

const noContent = (): Response => new Response(null, { status: 204 });

function unavailable(reason: string): Response {
  // 503, not 500: the wall itself is fine, only persistence is out. The client
  // surfaces this so a user never believes a layout was saved when it was not.
  return Response.json({ error: reason }, { status: 503 });
}

/** Turns a thrown error into a response without ever shipping a stack trace. */
function toErrorResponse(error: unknown, action: string): Response {
  if (error instanceof PersistInputError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  const reason = error instanceof Error ? error.message : String(error);
  // Logged without any pane URL in it: the reason comes from SQLite, while the
  // payload that triggered it is the user's private list of dashboards.
  console.error(`Wall persistence failed while handling ${action}: ${reason}`);
  return Response.json(
    { error: `The wall database could not ${action}: ${reason}` },
    { status: 500 },
  );
}

async function readSnapshot(request: Request): Promise<WallSnapshot> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new PersistInputError("Request body must be JSON");
  }
  return parseWallSnapshot(body);
}

export function createWallRoutes(access: WallAccess): WallRouteHandlers {
  const run = async (
    action: string,
    handler: (repository: WallRepository) => Promise<Response> | Response,
  ): Promise<Response> => {
    if (!access.ok) return unavailable(access.reason);
    try {
      return await handler(access.repository);
    } catch (error) {
      return toErrorResponse(error, action);
    }
  };

  return {
    getWall: () =>
      run("read the wall", (repository) =>
        // `null` is a clean first start, not an error: the client keeps the
        // fresh tree it built and the next save creates the rows.
        Response.json({ snapshot: repository.loadWall() }),
      ),

    putWall: (request) =>
      run("store the wall", async (repository) => {
        repository.saveWall(await readSnapshot(request));
        return noContent();
      }),

    listViews: () =>
      run("list saved views", (repository) =>
        Response.json({ views: repository.listViews() }),
      ),

    getView: (request) =>
      run("read a saved view", (repository) => {
        const snapshot = repository.loadView(parseViewName(request.params.name));
        if (snapshot === null) {
          return Response.json({ error: "No saved view by that name" }, { status: 404 });
        }
        return Response.json({ snapshot });
      }),

    putView: (request) =>
      run("store a saved view", async (repository) => {
        const name = parseViewName(request.params.name);
        repository.saveView(name, await readSnapshot(request));
        return noContent();
      }),

    deleteView: (request) =>
      run("delete a saved view", (repository) => {
        repository.deleteView(parseViewName(request.params.name));
        return noContent();
      }),
  };
}
