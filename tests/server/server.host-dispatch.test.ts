/**
 * The host split. One server answers the wall page and every proxied site, and
 * the only thing telling them apart is `Host` — so the risk worth testing is a
 * path collision: a site whose own page is called `/api/wall` must not be
 * answered by this wall's database endpoint, and the wall's home page must not
 * be served to a site host.
 *
 * No server is started here. `createHostDispatch` takes both effects as deps.
 */

import { describe, expect, test } from "bun:test";

import {
  createHostDispatch,
  STAY_ON_HOST_PARAM,
  WALL_SHELL_PATH,
} from "../../src/server/server.host-dispatch.ts";
import { createProxySiteRegistry } from "../../src/proxy/proxy.registry.ts";
import { siteLabel } from "../../src/proxy/proxy.label.ts";
import { WEB_MANIFEST_PATH } from "../../src/pwa/pwa.manifest.ts";

const UPSTREAM = "https://grafana.internal";

function dispatchFor() {
  const registry = createProxySiteRegistry();
  const label = registry.register(UPSTREAM);
  if (label === null) throw new Error("upstream should be registrable");

  const proxied: string[] = [];
  const shellRequests: string[] = [];

  const dispatch = createHostDispatch({
    registry,
    proxy: async (request, forLabel) => {
      proxied.push(`${forLabel} ${new URL(request.url).pathname}`);
      return new Response("proxied");
    },
    fetch: (async (input: string) => {
      shellRequests.push(String(input));
      return new Response("<!doctype html><html><head></head><body>wall</body></html>", {
        headers: { "content-type": "text/html" },
      });
    }) as unknown as typeof fetch,
  });

  return { dispatch, label, proxied, shellRequests };
}

/** Bun hands `server` to the catch-all; only `upgrade` is ever reached here. */
const noUpgrade = {
  upgrade: () => false,
} as unknown as Parameters<ReturnType<typeof createHostDispatch>["catchAll"]>[1];

describe("wall routes on a site host", () => {
  test("a site keeps its own /api/wall instead of this wall's database", async () => {
    const { dispatch, label, proxied } = dispatchFor();
    const handler = dispatch.wallOnly(() => {
      throw new Error("the wall handler must not run for a site host");
    });

    const response = await handler(
      new Request(`http://${label}.noc.localhost:7788/api/wall`),
    );
    expect(await response.text()).toBe("proxied");
    expect(proxied).toEqual([`${label} /api/wall`]);
  });

  test("the wall host still reaches the wall handler", async () => {
    const { dispatch, proxied } = dispatchFor();
    const handler = dispatch.wallOnly(() => new Response("the wall's own answer"));

    const response = await handler(new Request("http://wall.noc.localhost:7788/api/wall"));
    expect(await response.text()).toBe("the wall's own answer");
    expect(proxied).toEqual([]);
  });

  test("so does a plain loopback host, which is how a stayed-on wall calls", async () => {
    // Also the proof that the wall-host redirect cannot reach an API call: it
    // lives in the catch-all, and a route is matched before the catch-all. A
    // 307 here would turn the layout's PUT into a second request to a host the
    // client never asked for.
    const { dispatch, proxied } = dispatchFor();
    const handler = dispatch.wallOnly(() => new Response("the wall's own answer"));

    const response = await handler(new Request("http://127.0.0.1:7788/api/wall"));
    expect(await response.text()).toBe("the wall's own answer");
    expect(proxied).toEqual([]);
  });
});

describe("the catch-all", () => {
  test("the wall host gets the frontend bundle over loopback", async () => {
    const { dispatch, shellRequests } = dispatchFor();
    const response = await dispatch.catchAll(
      new Request("http://wall.noc.localhost:7788/"),
      noUpgrade,
    );
    expect(await response.text()).toContain("wall");
    // 127.0.0.1, not the hostname: only Chrome promises to resolve *.localhost.
    expect(shellRequests).toEqual([`http://127.0.0.1:7788${WALL_SHELL_PATH}`]);
  });

  test("the wall document carries the install tags, which index.html cannot", async () => {
    // The one place every browser-facing wall address goes through, so this is
    // where the manifest link has to be or it is nowhere. See `pwa.head.ts`.
    const { dispatch } = dispatchFor();
    const response = await dispatch.catchAll(
      new Request("http://wall.noc.localhost:7788/view/abc"),
      noUpgrade,
    );
    expect(await response.text()).toContain(
      `<link rel="manifest" href="${WEB_MANIFEST_PATH}">`,
    );
  });

  test("a site host gets its own home page, not the wall", async () => {
    const { dispatch, label, proxied, shellRequests } = dispatchFor();
    const response = await dispatch.catchAll(
      new Request(`http://${label}.noc.localhost:7788/`),
      noUpgrade,
    );
    expect(await response.text()).toBe("proxied");
    expect(proxied).toEqual([`${label} /`]);
    expect(shellRequests).toEqual([]);
  });

  test("a browser on the loopback host is sent where panes can hold a session", async () => {
    const { dispatch, shellRequests } = dispatchFor();
    for (const origin of ["http://localhost:7788", "http://127.0.0.1:7788"]) {
      const response = await dispatch.catchAll(new Request(`${origin}/`), noUpgrade);
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("http://wall.noc.localhost:7788/");
    }
    // Not served here and then moved: the wall document is never even built.
    expect(shellRequests).toEqual([]);
  });

  test("the move keeps the path and query, so a saved view survives it", async () => {
    const { dispatch } = dispatchFor();
    const response = await dispatch.catchAll(
      new Request("http://localhost:7788/view/abc?pane=2"),
      noUpgrade,
    );
    expect(response.headers.get("location")).toBe(
      "http://wall.noc.localhost:7788/view/abc?pane=2",
    );
  });

  test("the opt-out flag keeps a loopback address where it was typed", async () => {
    // What it is for: this repo's own cross-site control experiment needs a
    // wall served from `127.0.0.1`, which is exactly what the move above takes
    // away. An ordinary query flag, so it survives a reload of the page.
    const announced = `http://127.0.0.1:7788/?${STAY_ON_HOST_PARAM}=1`;

    const { dispatch, shellRequests } = dispatchFor();
    const response = await dispatch.catchAll(new Request(announced), noUpgrade);
    expect(await response.text()).toContain("wall");
    expect(shellRequests).toEqual([`http://127.0.0.1:7788${WALL_SHELL_PATH}`]);
  });

  test("a label nobody registered is refused by the proxy, not served the wall", async () => {
    // The hostname shape alone decides *who* answers; whether the site is
    // allowed is the registry's call, inside the proxy. Serving the wall page
    // here instead would hide an unregistered site behind a working page.
    const { dispatch, proxied, shellRequests } = dispatchFor();
    const stranger = siteLabel("http://attacker.example.com");
    await dispatch.catchAll(
      new Request(`http://${stranger}.noc.localhost:7788/`),
      noUpgrade,
    );
    expect(proxied).toEqual([`${stranger} /`]);
    expect(shellRequests).toEqual([]);
  });
});
