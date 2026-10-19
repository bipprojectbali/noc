/**
 * Single entrypoint for `bun dev` and for the binary produced by
 * `bun build --compile`. Bun's HTML import bundles the frontend into the
 * executable, so there is no separate asset-serving path to keep in sync.
 */

import index from "../../index.html";
import { readConfig } from "../config/config.env.ts";
import {
  EMBEDDABILITY_PATH,
  SELF_TEST_PATH,
  handleEmbeddability,
  handleSelfTest,
} from "./server.routes.ts";

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

let server: ReturnType<typeof Bun.serve>;
try {
  server = Bun.serve({
    hostname: config.host,
    port: config.port,
    routes: {
      [EMBEDDABILITY_PATH]: handleEmbeddability,
      [SELF_TEST_PATH]: handleSelfTest,
      "/*": index,
    },
  });
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  // Never fall back to another port: the saved layout is keyed to the origin,
  // so a silent port change looks to the user like the layout was lost.
  fail(
    `Cannot listen on ${config.host}:${config.port} (${reason}). ` +
      `Set NOC_PORT to a free port.`,
  );
}

console.info(`NOC wall listening on ${server.url.href}`);
