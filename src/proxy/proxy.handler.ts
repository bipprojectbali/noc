/**
 * The effectful half of the proxy: one request in, one upstream request out.
 *
 * All the rules live in `proxy.headers.ts`, which is why this file is short and
 * has nothing to decide. Two choices are its own:
 *
 *  - **Bodies are streamed, never buffered.** A pane may be holding an upload,
 *    a long poll or an event stream; reading either side to completion first
 *    would turn those into hangs and give the wall an unbounded memory sink.
 *  - **Redirects are not followed.** `redirect: "manual"` keeps `Location`
 *    visible so it can be rewritten back onto the proxy host. Following it here
 *    would move the browser's cookie jar out from under the login flow — the
 *    exact failure this feature exists to fix.
 *
 * Nothing in here logs a request body, a `Cookie`, an `Authorization` header or
 * a cookie value, and nothing should: those are the user's credentials, and the
 * wall's whole purpose is to hold sessions, not to copy them into a terminal.
 */

import {
  proxyRequestHeaders,
  proxyResponseHeaders,
} from "./proxy.headers.ts";
import type { ProxySiteRegistry } from "./proxy.registry.ts";

export interface ProxyHandlerDeps {
  readonly registry: ProxySiteRegistry;
  /** Injected so tests can answer without a network. */
  readonly fetch?: typeof fetch;
}

const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);

export function createProxyHandler(deps: ProxyHandlerDeps) {
  const fetchUpstream = deps.fetch ?? fetch;

  return async function proxyRequest(request: Request, label: string): Promise<Response> {
    const upstreamOrigin = deps.registry.resolve(label);
    if (upstreamOrigin === null) {
      // Deliberately uninformative, and deliberately not a fetch: an
      // unregistered label means nobody put this site on the wall.
      return new Response("Unknown site for this wall.", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const url = new URL(request.url);
    const proxyOrigin = url.origin;
    const target = `${upstreamOrigin}${url.pathname}${url.search}`;
    const hasBody = !METHODS_WITHOUT_BODY.has(request.method) && request.body !== null;

    let upstream: Response;
    try {
      upstream = await fetchUpstream(target, {
        method: request.method,
        headers: proxyRequestHeaders(request.headers, upstreamOrigin, proxyOrigin),
        body: hasBody ? request.body : null,
        redirect: "manual",
        // Required by fetch whenever the body is a stream.
        ...(hasBody ? { duplex: "half" } : {}),
      } as RequestInit);
    } catch (error) {
      // The host, not the path: a path can carry a token, and this string is
      // rendered in a pane the operator may well screenshot.
      const reason = error instanceof Error ? error.message : String(error);
      return new Response(`Cannot reach ${new URL(upstreamOrigin).host}: ${reason}`, {
        status: 502,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: proxyResponseHeaders(upstream.headers, upstreamOrigin, proxyOrigin),
    });
  };
}
