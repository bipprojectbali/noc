/**
 * WebSocket half of the proxy. Not optional: a monitoring dashboard streams its
 * live numbers over a socket, so a wall that proxies only HTTP shows a page
 * that loads and then never updates — which reads as "the proxy broke it".
 *
 * The one thing that has to be right is the **frame queue**. A browser may send
 * its first frame the instant its own socket opens, and at that moment the
 * upstream socket is still connecting. Forwarding immediately throws those
 * frames away silently: no error, no close, just a subscription message the
 * server never received and a pane that sits empty forever. So client frames
 * are buffered until the upstream socket opens and then flushed in order.
 *
 * `Origin` is rewritten the same way as on the HTTP path — socket servers check
 * it at least as often as REST handlers do — and `Cookie` is forwarded
 * verbatim, since a socket that authenticates is the reason any of this exists.
 */

import type { ProxySiteRegistry } from "./proxy.registry.ts";

/**
 * Enough to cover the handshake chatter of every dashboard looked at; past that
 * the client is talking to a socket that is not answering, and failing it is
 * better than growing a buffer nobody drains.
 */
const MAX_PENDING_FRAMES = 64;

/** Headers worth carrying upstream. Everything else belongs to this hop. */
const FORWARDED_SOCKET_HEADERS = [
  "cookie",
  "authorization",
  "user-agent",
  "accept-language",
];

type SocketFrame = string | Uint8Array<ArrayBuffer>;

interface ProxySocketBridge {
  readonly socket: WebSocket;
  readonly pending: SocketFrame[];
  opened: boolean;
}

export interface ProxySocketData {
  readonly upstreamUrl: string;
  readonly headers: Record<string, string>;
  readonly protocols: string[];
  bridge: ProxySocketBridge | null;
}

/** Bun's client accepts headers and subprotocols; the DOM typing does not. */
type SocketOptions = { headers: Record<string, string>; protocols?: string[] };

/**
 * Read at call time, not captured in a module constant: under the test preload
 * a DOM shim owns `globalThis.WebSocket` by the time this module evaluates, and
 * a test that swaps Bun's own back in cannot reach a constant already bound to
 * the shim. In the server there is only ever one WebSocket, so this costs
 * nothing there.
 */
function openUpstreamSocket(url: string, options: SocketOptions): WebSocket {
  const Constructor = WebSocket as unknown as new (
    url: string,
    options?: SocketOptions,
  ) => WebSocket;
  return new Constructor(url, options);
}

/**
 * 1005, 1006 and 1015 are reserved for "no code was received" and may not be
 * sent on the wire; anything outside 1000–4999 is invalid. An upstream that
 * dies without a proper close gives us one of those, so it becomes 1011.
 */
function sendableCloseCode(code: number): number {
  if (code === 1005 || code === 1006 || code === 1015) return 1011;
  if (code < 1000 || code > 4999) return 1011;
  return code;
}

/**
 * Hands a websocket upgrade to the proxy, or returns false so the caller can
 * answer over HTTP. False means either "not an upgrade" or "label unknown" —
 * never "try it anyway".
 */
export function upgradeProxySocket(
  request: Request,
  server: Bun.Server<ProxySocketData>,
  label: string,
  registry: ProxySiteRegistry,
): boolean {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return false;
  const upstreamOrigin = registry.resolve(label);
  if (upstreamOrigin === null) return false;

  const url = new URL(request.url);
  const upstream = new URL(upstreamOrigin);
  upstream.protocol = upstream.protocol === "https:" ? "wss:" : "ws:";
  const upstreamUrl = `${upstream.origin}${url.pathname}${url.search}`;

  const headers: Record<string, string> = {};
  for (const name of FORWARDED_SOCKET_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  headers["origin"] = upstreamOrigin;

  const offered = request.headers.get("sec-websocket-protocol");
  const protocols =
    offered === null
      ? []
      : offered
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry !== "");

  const data: ProxySocketData = { upstreamUrl, headers, protocols, bridge: null };
  return server.upgrade(request, { data });
}

export const proxyWebSocketHandlers: Bun.WebSocketHandler<ProxySocketData> = {
  open(client) {
    const { upstreamUrl, headers, protocols } = client.data;
    let socket: WebSocket;
    try {
      socket = openUpstreamSocket(
        upstreamUrl,
        protocols.length > 0 ? { headers, protocols } : { headers },
      );
    } catch {
      client.close(1011, "cannot open upstream websocket");
      return;
    }

    const bridge: ProxySocketBridge = { socket, pending: [], opened: false };
    client.data.bridge = bridge;
    socket.binaryType = "arraybuffer";

    socket.onopen = () => {
      bridge.opened = true;
      for (const frame of bridge.pending) socket.send(frame);
      bridge.pending.length = 0;
    };
    socket.onmessage = (event: MessageEvent) => {
      const payload = event.data as string | ArrayBuffer;
      client.send(typeof payload === "string" ? payload : new Uint8Array(payload));
    };
    socket.onclose = (event: CloseEvent) => {
      client.close(sendableCloseCode(event.code), event.reason);
    };
    socket.onerror = () => {
      client.close(1011, "upstream websocket failed");
    };
  },

  message(client, message) {
    const bridge = client.data.bridge;
    if (bridge === null) return;
    // Copied, not referenced: Bun may reuse the buffer once this returns, and a
    // queued frame is read later.
    const frame: SocketFrame =
      typeof message === "string" ? message : Uint8Array.from(message);
    if (bridge.opened) {
      bridge.socket.send(frame);
      return;
    }
    if (bridge.pending.length >= MAX_PENDING_FRAMES) {
      client.close(1013, "upstream websocket is not ready");
      return;
    }
    bridge.pending.push(frame);
  },

  close(client) {
    const bridge = client.data.bridge;
    if (bridge === null) return;
    client.data.bridge = null;
    bridge.pending.length = 0;
    try {
      bridge.socket.close();
    } catch {
      // Closing a socket that never opened is not an error worth reporting.
    }
  },
};
