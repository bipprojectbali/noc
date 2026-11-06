/**
 * The proxy against a real upstream — a Bun server on loopback, started by the
 * test. Nothing here reaches the network: the point is to exercise the parts
 * that only appear once a body is actually streamed and a response is actually
 * decompressed, which is where the header rules earn their keep.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createProxyHandler } from "../../src/proxy/proxy.handler.ts";
import { createProxySiteRegistry } from "../../src/proxy/proxy.registry.ts";
import {
  installNativeFetchGlobals,
  restoreDomFetchGlobals,
} from "../fixtures/native-globals.ts";

const PROXY_HOST = "s-upstream-whatever.noc.localhost:7788";
const PROXY_ORIGIN = `http://${PROXY_HOST}`;

let upstream: Bun.Server<undefined>;
let upstreamOrigin: string;
let seenRequests = 0;
let lastHeaders: Headers = new Headers();

beforeAll(() => {
  installNativeFetchGlobals();
  upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      seenRequests += 1;
      lastHeaders = request.headers;
      const url = new URL(request.url);

      if (url.pathname === "/gzipped") {
        return new Response(Bun.gzipSync(new TextEncoder().encode("y".repeat(400))), {
          headers: {
            "content-encoding": "gzip",
            "content-length": "27",
            "content-type": "text/plain",
          },
        });
      }
      if (url.pathname === "/login") {
        const headers = new Headers({
          location: `${upstreamOrigin}/dashboard`,
          "x-frame-options": "DENY",
        });
        headers.append(
          "set-cookie",
          "session=placeholder-not-real; Domain=.noc.localhost; Path=/; Secure; HttpOnly",
        );
        headers.append("set-cookie", "csrf=placeholder; Path=/");
        return new Response(null, { status: 302, headers });
      }
      if (url.pathname === "/echo") {
        return request.text().then((body) =>
          Response.json({
            method: request.method,
            origin: request.headers.get("origin"),
            referer: request.headers.get("referer"),
            cookie: request.headers.get("cookie"),
            body,
          }),
        );
      }
      if (url.pathname === "/slow-body") {
        // Headers now, the rest well after a short header timeout has elapsed.
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(encoder.encode("first;"));
            await Bun.sleep(80);
            controller.enqueue(encoder.encode("second"));
            controller.close();
          },
        });
        return new Response(body, { status: 207 });
      }
      return new Response(`upstream ${url.pathname}${url.search}`);
    },
  });
  upstreamOrigin = `http://127.0.0.1:${upstream.port}`;
});

afterAll(() => {
  void upstream.stop(true);
  restoreDomFetchGlobals();
});

function proxyFor(): { proxy: ReturnType<typeof createProxyHandler>; label: string } {
  const registry = createProxySiteRegistry();
  const label = registry.register(upstreamOrigin);
  if (label === null) throw new Error("upstream origin should be registrable");
  return { proxy: createProxyHandler({ registry }), label };
}

/** A registered label whose fetches go to `fetchImpl` instead of a socket. */
function proxyWith(
  fetchImpl: (input: string, init: RequestInit) => Promise<Response>,
  upstreamTimeoutMs?: number,
): { proxy: ReturnType<typeof createProxyHandler>; label: string } {
  const registry = createProxySiteRegistry();
  const label = registry.register("http://slow.example.test");
  if (label === null) throw new Error("test origin should be registrable");
  return {
    proxy: createProxyHandler({
      registry,
      fetch: fetchImpl as unknown as typeof fetch,
      ...(upstreamTimeoutMs === undefined ? {} : { upstreamTimeoutMs }),
    }),
    label,
  };
}

/** A fetch that only ever ends by rejecting when its signal aborts. */
function fetchUntilAborted(_input: string, init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  });
}

function request(path: string, init?: RequestInit): Request {
  return new Request(`${PROXY_ORIGIN}${path}`, init);
}

describe("proxied responses", () => {
  test("passes the path and query through untouched", async () => {
    const { proxy, label } = proxyFor();
    const response = await proxy(request("/d/abc?from=now-6h"), label);
    expect(await response.text()).toBe("upstream /d/abc?from=now-6h");
  });

  test("a decompressed body arrives without the headers that described it compressed", async () => {
    // Forwarding content-encoding here is what produces ZlibError in the
    // browser, and the stale content-length is off by the whole ratio.
    const { proxy, label } = proxyFor();
    const response = await proxy(request("/gzipped"), label);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
    expect(await response.text()).toBe("y".repeat(400));
  });

  test("a login redirect keeps the browser on the proxy host", async () => {
    const { proxy, label } = proxyFor();
    const response = await proxy(request("/login"), label);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${PROXY_ORIGIN}/dashboard`);
  });

  test("cookies come back host-only, with Secure intact", async () => {
    const { proxy, label } = proxyFor();
    const cookies = (await proxy(request("/login"), label)).headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) {
      expect(cookie.toLowerCase()).not.toContain("domain=");
    }
    expect(cookies[0]).toContain("Secure");
    expect(cookies[0]).toContain("HttpOnly");
  });

  test("the framing refusal is gone", async () => {
    const { proxy, label } = proxyFor();
    const response = await proxy(request("/login"), label);
    expect(response.headers.get("x-frame-options")).toBeNull();
  });
});

describe("proxied requests", () => {
  test("carries the cookie and rewrites Origin and Referer", async () => {
    const { proxy, label } = proxyFor();
    const response = await proxy(
      request("/echo", {
        method: "POST",
        body: "a=1",
        headers: {
          cookie: "session=placeholder-not-real",
          origin: PROXY_ORIGIN,
          referer: `${PROXY_ORIGIN}/form`,
          "content-type": "text/plain",
        },
      }),
      label,
    );
    const echoed = (await response.json()) as Record<string, string>;
    expect(echoed.cookie).toBe("session=placeholder-not-real");
    expect(echoed.origin).toBe(upstreamOrigin);
    expect(echoed.referer).toBe(`${upstreamOrigin}/form`);
    expect(echoed.body).toBe("a=1");
  });

  test("sends the upstream its own Host, not the proxy hostname", async () => {
    const { proxy, label } = proxyFor();
    await proxy(request("/plain"), label);
    expect(lastHeaders.get("host")).toBe(new URL(upstreamOrigin).host);
  });

  test("streams a body instead of buffering it", async () => {
    const { proxy, label } = proxyFor();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("chunk-one;"));
        controller.enqueue(new TextEncoder().encode("chunk-two"));
        controller.close();
      },
    });
    const response = await proxy(
      request("/echo", {
        method: "POST",
        body,
        headers: { "content-type": "text/plain" },
        // @ts-expect-error required by fetch whenever the body is a stream
        duplex: "half",
      }),
      label,
    );
    const echoed = (await response.json()) as Record<string, string>;
    expect(echoed.body).toBe("chunk-one;chunk-two");
  });
});

describe("hosts nobody put on the wall", () => {
  test("an unregistered label is refused without any upstream request", async () => {
    // The registry is the whole thing keeping this proxy from being an open
    // relay, so this must not be a fetch that happens to fail.
    const registry = createProxySiteRegistry();
    const proxy = createProxyHandler({
      registry,
      fetch: (() => {
        throw new Error("an unregistered label must never be fetched");
      }) as unknown as typeof fetch,
    });
    const response = await proxy(request("/"), "s-never-registered-0000000");
    expect(response.status).toBe(404);
  });

  test("an upstream that cannot be reached is reported, not hidden", async () => {
    const registry = createProxySiteRegistry();
    // Port 1 on loopback: nothing listens, and nothing leaves the machine.
    const label = registry.register("http://127.0.0.1:1");
    const proxy = createProxyHandler({ registry });
    const response = await proxy(request("/"), label ?? "");
    expect(response.status).toBe(502);
    expect(await response.text()).toContain("127.0.0.1:1");
  });

  test("only the probe can widen what is reachable", async () => {
    const registry = createProxySiteRegistry();
    expect(registry.resolve("s-grafana-internal-anything")).toBeNull();
    expect(registry.register("file:///etc/passwd")).toBeNull();
    expect(registry.register("about:blank")).toBeNull();
    const before = seenRequests;
    const proxy = createProxyHandler({ registry });
    await proxy(request("/"), "s-anything-at-all");
    expect(seenRequests).toBe(before);
  });
});

describe("waiting for a slow site", () => {
  test("no headers within the timeout is a 504 naming the host, not the path", async () => {
    const { proxy, label } = proxyWith(fetchUntilAborted, 20);
    const response = await proxy(request("/d/secret-token-123"), label);
    expect(response.status).toBe(504);
    const body = await response.text();
    expect(body).toContain("slow.example.test");
    expect(body).toContain("NOC_LOAD_TIMEOUT");
    expect(body).not.toContain("secret-token-123");
  });

  test("once headers arrive the body keeps streaming past the timeout", async () => {
    // Against the real upstream: a real fetch cuts its body when its signal
    // aborts, so this only passes if the timer is cleared once headers land.
    const registry = createProxySiteRegistry();
    const label = registry.register(upstreamOrigin);
    if (label === null) throw new Error("upstream origin should be registrable");
    const proxy = createProxyHandler({ registry, upstreamTimeoutMs: 20 });
    const response = await proxy(request("/slow-body"), label);
    expect(response.status).toBe(207);
    expect(await response.text()).toBe("first;second");
  });

  test("a timeout of 0 never aborts", async () => {
    let aborted: boolean | undefined;
    const { proxy, label } = proxyWith(async (_input, init) => {
      await Bun.sleep(50);
      aborted = init.signal?.aborted;
      return new Response("late but fine");
    }, 0);
    const response = await proxy(request("/"), label);
    expect(aborted).toBe(false);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("late but fine");
  });

  test("a failure that is not the timer is still a 502", async () => {
    const { proxy, label } = proxyWith(async () => {
      throw new Error("connection refused");
    }, 1000);
    const response = await proxy(request("/"), label);
    expect(response.status).toBe(502);
    expect(await response.text()).toContain("connection refused");
  });
});
