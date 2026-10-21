/**
 * Single entrypoint for `bun dev` and for the binary produced by
 * `bun build --compile`. Bun's HTML import bundles the frontend into the
 * executable, so there is no separate asset-serving path to keep in sync.
 */

import index from "../../index.html";
import { readConfig } from "../config/config.env.ts";
import { WALL_PROXY_HOSTNAME } from "../proxy/proxy.label.ts";
import { createProxyHandler } from "../proxy/proxy.handler.ts";
import { proxySiteRegistry } from "../proxy/proxy.registry.ts";
import { proxyWebSocketHandlers } from "../proxy/proxy.socket.ts";
import {
  COOKIE_DEMO_PAGE_PATH,
  COOKIE_DEMO_READ_PATH,
  COOKIE_DEMO_SET_PATH,
  handleCookieDemoPage,
  handleCookieDemoRead,
  handleCookieDemoSet,
} from "./cookie.demo.ts";
import { pwaAssetRoutes } from "../pwa/pwa.assets.ts";
import { PANE_CHROME_PATH, handlePaneChrome } from "./server.chrome-page.ts";
import {
  WALL_SHELL_PATH,
  createHostDispatch,
  stayOnHostUrl,
} from "./server.host-dispatch.ts";
import { watchParentProcess } from "./server.parent-watch.ts";
import { readyLine } from "./server.ready.ts";
import {
  EMBEDDABILITY_PATH,
  SELF_TEST_PATH,
  WALL_PATH,
  WALL_VIEWS_PATH,
  WALL_VIEW_PATH,
  createEmbeddabilityHandler,
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

// The same socket serves the wall page and every site the wall frames, told
// apart by `Host`. Still loopback-only: the proxy reaches outward on the
// server's behalf, which is the surface `/api/embeddability` already had and
// the reason the bind address is not widened here.
const dispatch = createHostDispatch({
  registry: proxySiteRegistry,
  proxy: createProxyHandler({ registry: proxySiteRegistry }),
});
const wallOnly = dispatch.wallOnly;

let server: ReturnType<typeof Bun.serve>;
try {
  server = Bun.serve({
    hostname: config.host,
    port: config.port,
    routes: {
      // The manifest and its icons. Real routes, so the landing redirect in the
      // catch-all cannot swallow them, and `wallOnly` so a proxied site keeps
      // whatever it has under the same names.
      ...Object.fromEntries(
        Object.entries(pwaAssetRoutes).map(([path, handler]) => [
          path,
          wallOnly(handler),
        ]),
      ),
      [EMBEDDABILITY_PATH]: wallOnly(
        createEmbeddabilityHandler({ registry: proxySiteRegistry }),
      ),
      [SELF_TEST_PATH]: wallOnly(handleSelfTest),
      // Before the catch-all below, which is the wall page itself: this one is
      // loaded by the shell into a 40px child webview, not by a browser.
      [PANE_CHROME_PATH]: wallOnly(handlePaneChrome),
      // Framable on purpose: the demo only says anything when the wall frames
      // it from the other loopback host. See `cookie.demo-page.ts`. `wallOnly`
      // does not change that — it only keeps these paths off a proxied site,
      // which would otherwise lose its own page of the same name.
      [COOKIE_DEMO_PAGE_PATH]: wallOnly(handleCookieDemoPage),
      [COOKIE_DEMO_SET_PATH]: wallOnly(handleCookieDemoSet),
      [COOKIE_DEMO_READ_PATH]: wallOnly(handleCookieDemoRead),
      [WALL_PATH]: { GET: wallOnly(wall.getWall), PUT: wallOnly(wall.putWall) },
      [WALL_VIEWS_PATH]: { GET: wallOnly(wall.listViews) },
      [WALL_VIEW_PATH]: {
        GET: wallOnly(wall.getView),
        PUT: wallOnly(wall.putView),
        DELETE: wallOnly(wall.deleteView),
      },
      [WALL_SHELL_PATH]: index,
      "/*": dispatch.catchAll,
    },
    websocket: proxyWebSocketHandlers,
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
// Both names reach this same socket, and a browser arriving on the loopback one
// is redirected to the proxy host, because only there are the panes same-site
// with the wall. Printed so the address bar's own change is not a surprise.
// See `src/proxy/proxy.label.ts`.
console.info(
  `A browser is sent on to http://${WALL_PROXY_HOSTNAME}:${server.port}/ ` +
    `so panes can hold a session.`,
);
// Machine-readable, and only after the socket is bound: whoever spawned this
// process may be waiting on it to learn the ephemeral port. Marked to stay put
// — the native shell is the one client that must not be redirected, and this is
// the channel by which the server, not a string match, tells it apart.
console.info(readyLine(stayOnHostUrl(server.url.href)));

if (config.parentPid !== null) {
  watchParentProcess({
    parentPid: config.parentPid,
    onOrphaned: (pid) => {
      console.warn(`Parent process ${pid} is gone, shutting down.`);
      void server.stop(true).finally(() => process.exit(0));
    },
  });
}
