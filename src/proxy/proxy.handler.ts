/**
 * The effectful half of the proxy: one request in, one upstream request out.
 *
 * All the rules live in `proxy.headers.ts`, which is why this file is short and
 * has nothing to decide. Three choices are its own:
 *
 *  - **Bodies are streamed, never buffered.** A pane may be holding an upload,
 *    a long poll or an event stream; reading either side to completion first
 *    would turn those into hangs and give the wall an unbounded memory sink.
 *  - **Redirects are not followed.** `redirect: "manual"` keeps `Location`
 *    visible so it can be rewritten back onto the proxy host. Following it here
 *    would move the browser's cookie jar out from under the login flow — the
 *    exact failure this feature exists to fix.
 *  - **The wait for a slow site is decided here, by the operator's number.**
 *    `upstreamTimeoutMs` (from `NOC_LOAD_TIMEOUT`) bounds only the wait for
 *    headers; the timer is cleared the moment they arrive, so a streamed body
 *    is never cut. Before this the wait was Bun's 10 s socket idle rule, which
 *    cut the browser's request before a slow site's first byte, so whatever
 *    handles a network failure answered — Chrome's error page, or the site's
 *    own service-worker offline page. A timeout now answers a readable 504.
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
  /** How long to wait for the upstream's headers; `0` or absent waits forever. */
  readonly upstreamTimeoutMs?: number;
}

const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);

export function createProxyHandler(deps: ProxyHandlerDeps) {
  const fetchUpstream = deps.fetch ?? fetch;
  const timeoutMs = deps.upstreamTimeoutMs ?? 0;

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

    const controller = new AbortController();
    const timer =
      timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

    let upstream: Response;
    try {
      upstream = await fetchUpstream(target, {
        method: request.method,
        headers: proxyRequestHeaders(request.headers, upstreamOrigin, proxyOrigin),
        body: hasBody ? request.body : null,
        redirect: "manual",
        signal: controller.signal,
        // Required by fetch whenever the body is a stream.
        ...(hasBody ? { duplex: "half" } : {}),
      } as RequestInit);
    } catch (error) {
      // The host, not the path: a path can carry a token, and this string is
      // rendered in a pane the operator may well screenshot.
      const host = new URL(upstreamOrigin).host;
      // Our own signal, not the error text: only this controller can say the
      // timer fired rather than the network failing in some other way.
      if (controller.signal.aborted) {
        return new Response(
          `${host} did not answer within ${timeoutMs / 1000} s. ` +
            `Raise NOC_LOAD_TIMEOUT to wait longer, or set it to 0 to wait indefinitely.`,
          { status: 504, headers: { "content-type": "text/plain; charset=utf-8" } },
        );
      }
      const reason = error instanceof Error ? error.message : String(error);
      return new Response(`Cannot reach ${host}: ${reason}`, {
        status: 502,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    } finally {
      // Headers are in (or the fetch failed): from here the body streams for as
      // long as the site keeps it open.
      clearTimeout(timer);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: proxyResponseHeaders(upstream.headers, upstreamOrigin, proxyOrigin),
    });
  };
}
