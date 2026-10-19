/**
 * Single entrypoint for `bun dev` and for the binary produced by
 * `bun build --compile`. Bun's HTML import bundles the frontend into the
 * executable, so there is no separate asset-serving path to keep in sync.
 */

import index from "../../index.html";
import { readConfig } from "../config/config.env.ts";
import { watchParentProcess } from "./server.parent-watch.ts";
import { readyLine } from "./server.ready.ts";
import {
  EMBEDDABILITY_PATH,
  SELF_TEST_PATH,
  WALL_PATH,
  WALL_VIEWS_PATH,
  WALL_VIEW_PATH,
  handleEmbeddability,
  handleSelfTest,
} from "./server.routes.ts";
import { createWallRoutes, openWallAccess } from "./server.wall.ts";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

let config: ReturnType<typeof readConfig>;
try {
  config = readConfig(process.env);
} catch (error) {
  // A bad environment variable is an operator mistake, not a crash to debug.
  fail(error instanceof Error ? error.message : String(error));
}

// A database that cannot be opened leaves the wall running without persistence:
// the endpoints answer 503 with the reason, so no save is ever reported as done.
const wallAccess = openWallAccess(config, process.cwd());
if (!wallAccess.ok) console.error(wallAccess.reason);
const wall = createWallRoutes(wallAccess);

let server: ReturnType<typeof Bun.serve>;
try {
  server = Bun.serve({
    hostname: config.host,
    port: config.port,
    routes: {
      [EMBEDDABILITY_PATH]: handleEmbeddability,
      [SELF_TEST_PATH]: handleSelfTest,
      [WALL_PATH]: { GET: wall.getWall, PUT: wall.putWall },
      [WALL_VIEWS_PATH]: { GET: wall.listViews },
      [WALL_VIEW_PATH]: {
        GET: wall.getView,
        PUT: wall.putView,
        DELETE: wall.deleteView,
      },
      "/*": index,
    },
  });
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  // Never fall back to another port: the saved layout is keyed to the origin,
  // so a silent port change looks to the user like the layout was lost. An
  // ephemeral port is the opposite case — there the caller asked for whatever
  // is free and reads the result from the ready line below.
  fail(
    `Cannot listen on ${config.host}:${config.port} (${reason}). ` +
      `Set NOC_PORT to a free port, or NOC_PORT=0 to take any free port.`,
  );
}

console.info(`NOC wall listening on ${server.url.href}`);
// Machine-readable, and only after the socket is bound: whoever spawned this
// process may be waiting on it to learn the ephemeral port.
console.info(readyLine(server.url.href));

if (config.parentPid !== null) {
  watchParentProcess({
    parentPid: config.parentPid,
    onOrphaned: (pid) => {
      console.warn(`Parent process ${pid} is gone, shutting down.`);
      void server.stop(true).finally(() => process.exit(0));
    },
  });
}
