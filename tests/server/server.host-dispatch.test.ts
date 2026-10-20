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
  WALL_SHELL_PATH,
} from "../../src/server/server.host-dispatch.ts";
import { createProxySiteRegistry } from "../../src/proxy/proxy.registry.ts";
import { siteLabel } from "../../src/proxy/proxy.label.ts";

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
      return new Response("<!doctype html>wall", {
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

  test("so does a plain loopback host, which is how Tauri reaches it", async () => {
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
