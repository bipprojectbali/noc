/**
 * The websocket proxy end to end: a real client, a real proxy server, a real
 * upstream, all on loopback.
 *
 * The property under test is the frame queue. A browser sends its first frame
 * the moment its own socket opens, and at that moment the proxy has only just
 * begun connecting upstream — the client handshake has to finish before `open`
 * even runs. Forwarding straight away loses those frames with no error and no
 * close, leaving a dashboard that connected and then never received anything.
 * So the test sends inside `onopen`, which is exactly the window that breaks.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createProxySiteRegistry } from "../../src/proxy/proxy.registry.ts";
import {
  proxyWebSocketHandlers,
  upgradeProxySocket,
  type ProxySocketData,
} from "../../src/proxy/proxy.socket.ts";
import { siteLabel } from "../../src/proxy/proxy.label.ts";
import {
  installNativeFetchGlobals,
  restoreDomFetchGlobals,
} from "../fixtures/native-globals.ts";

const registry = createProxySiteRegistry();

let upstream: Bun.Server<{ cookie: string | null }>;
let proxy: Bun.Server<ProxySocketData>;
let label: string;

/**
 * What the upstream saw. Read through accessors so a test that resets a field
 * does not narrow its type to the reset value for the rest of the block.
 * Frames only, and whether a cookie was present — never a cookie value.
 */
const saw = { frames: [] as string[], cookie: false, protocol: null as string | null };
const frames = (): string[] => saw.frames;
const cookieSeen = (): boolean => saw.cookie;
const protocolSeen = (): string | null => saw.protocol;

beforeAll(() => {
  installNativeFetchGlobals();

  upstream = Bun.serve<{ cookie: string | null }>({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      saw.protocol = request.headers.get("sec-websocket-protocol");
      if (server.upgrade(request, { data: { cookie: request.headers.get("cookie") } })) {
        return undefined as unknown as Response;
      }
      return new Response("not a socket");
    },
    websocket: {
      open(socket) {
        saw.cookie = socket.data.cookie !== null;
      },
      message(socket, message) {
        saw.frames.push(String(message));
        socket.send(`echo:${message}`);
      },
    },
  });

  const upstreamOrigin = `http://127.0.0.1:${upstream.port}`;
  label = registry.register(upstreamOrigin) ?? siteLabel(upstreamOrigin);

  proxy = Bun.serve<ProxySocketData>({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      if (upgradeProxySocket(request, server, label, registry)) {
        return undefined as unknown as Response;
      }
      return new Response("no upgrade", { status: 400 });
    },
    websocket: proxyWebSocketHandlers,
  });
});

afterAll(() => {
  void proxy.stop(true);
  void upstream.stop(true);
  restoreDomFetchGlobals();
});

type SocketInit = { headers?: Record<string, string>; protocols?: string[] };
const openSocket = (path: string, init?: SocketInit): WebSocket =>
  new (WebSocket as unknown as new (url: string, options?: SocketInit) => WebSocket)(
    `ws://127.0.0.1:${proxy.port}${path}`,
    init,
  );

/** Resolves once `count` messages have come back, or rejects on timeout. */
function collect(socket: WebSocket, count: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const seen: string[] = [];
    const timer = setTimeout(() => {
      reject(new Error(`only ${seen.length} of ${count} frames came back: ${seen}`));
    }, 3000);
    socket.onmessage = (event: MessageEvent) => {
      seen.push(String(event.data));
      if (seen.length < count) return;
      clearTimeout(timer);
      resolve(seen);
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error("socket errored"));
    };
  });
}

describe("the frame queue", () => {
  test("a frame sent the instant the client opens still reaches upstream", async () => {
    saw.frames = [];
    const socket = openSocket("/live");
    const echoes = collect(socket, 1);
    socket.onopen = () => socket.send("subscribe");

    expect(await echoes).toEqual(["echo:subscribe"]);
    expect(frames()).toEqual(["subscribe"]);
    socket.close();
  });

  test("queued frames keep their order", async () => {
    saw.frames = [];
    const socket = openSocket("/live");
    const echoes = collect(socket, 3);
    socket.onopen = () => {
      socket.send("first");
      socket.send("second");
      socket.send("third");
    };

    expect(await echoes).toEqual(["echo:first", "echo:second", "echo:third"]);
    expect(frames()).toEqual(["first", "second", "third"]);
    socket.close();
  });

  test("frames sent after the bridge is up still arrive", async () => {
    saw.frames = [];
    const socket = openSocket("/live");
    const first = collect(socket, 1);
    socket.onopen = () => socket.send("early");
    await first;

    const later = collect(socket, 1);
    socket.send("late");
    expect(await later).toEqual(["echo:late"]);
    expect(frames()).toEqual(["early", "late"]);
    socket.close();
  });
});

describe("what reaches the upstream socket", () => {
  test("the cookie goes with it, because an authenticated socket is the point", async () => {
    saw.frames = [];
    saw.cookie = false;
    const socket = openSocket("/live", {
      headers: { cookie: "session=placeholder-not-real" },
    });
    const echoes = collect(socket, 1);
    socket.onopen = () => socket.send("ping");
    await echoes;

    expect(cookieSeen()).toBe(true);
    socket.close();
  });

  test("a subprotocol is offered upstream too", async () => {
    saw.frames = [];
    saw.protocol = null;
    const socket = openSocket("/live", { protocols: ["graphql-ws"] });
    const echoes = collect(socket, 1);
    socket.onopen = () => socket.send("ping");
    await echoes;

    expect(protocolSeen()).toBe("graphql-ws");
    socket.close();
  });
});

describe("hosts nobody put on the wall", () => {
  test("an unregistered label is not upgraded", () => {
    const request = new Request("http://s-never-registered-00.noc.localhost/live", {
      headers: { upgrade: "websocket" },
    });
    const fakeServer = {
      upgrade: () => {
        throw new Error("an unregistered label must never be upgraded");
      },
    } as unknown as Bun.Server<ProxySocketData>;
    expect(
      upgradeProxySocket(request, fakeServer, "s-never-registered-00", registry),
    ).toBe(false);
  });

  test("a plain request is left to the HTTP path", () => {
    const request = new Request("http://example.noc.localhost/live");
    const fakeServer = {
      upgrade: () => {
        throw new Error("a plain request must not be upgraded");
      },
    } as unknown as Bun.Server<ProxySocketData>;
    expect(upgradeProxySocket(request, fakeServer, label, registry)).toBe(false);
  });
});
