/**
 * One server, two kinds of host: the wall page, and every site it proxies.
 *
 * The split is by `Host` rather than by port because that is what makes the
 * sites siblings of the wall under one registrable domain — the entire
 * mechanism (see `proxy.label.ts`). `Bun.serve` hands the original `Host` to
 * the handler, so this costs nothing but a lookup.
 *
 * Two awkward bits here are both forced by Bun, not chosen:
 *
 *  - **Every path route needs this guard.** Routes win over `fetch` for all
 *    hosts, and Bun 1.4 has no hostname patterns, so `/api/wall` on a proxied
 *    site would be answered by the wall's own database endpoint instead of the
 *    site's page of that name. `wallOnly` is what keeps a site's paths its own.
 *  - **The wall document is fetched from ourselves.** It used to be mounted at
 *    `/*`, which is exactly the path a proxied site needs for its home page.
 *    Bun's HTML import is a bundle object that a handler may not return, and a
 *    handler that returns nothing gets Bun's own welcome page, so the bundle
 *    moves to an internal path and the wall host reaches it over loopback. The
 *    hop keeps `bun --hot` working, which rebuilding the HTML by hand would
 *    not. Its cost is one loopback request per wall page load.
 */

import { siteLabelOf, wallLandingHostname } from "../proxy/proxy.label.ts";
import type { ProxySiteRegistry } from "../proxy/proxy.registry.ts";
import { upgradeProxySocket, type ProxySocketData } from "../proxy/proxy.socket.ts";

/**
 * Where the frontend bundle actually lives. Underscore-prefixed and
 * wall-host-only: a proxied site's request for this path is proxied like any
 * other, so the name cannot shadow anything of the site's.
 */
export const WALL_SHELL_PATH = "/__noc-shell";

/**
 * The one mark on a wall URL that means "answer me on this host, do not move
 * me". Structural, not a user-agent sniff: a browser's address is typed by a
 * human and will never carry this, while the native shell's address is
 * *configured* by this server — Rust parses `noc-ready <url>` off stdout and
 * opens that URL verbatim (invariant 4), so what the shell asks for is decided
 * here, in `server.entry.ts`, by `stayOnHostUrl`. It survives a reload because
 * it lives in the address, and it costs `src-tauri/` nothing.
 *
 * A plain flag rather than a secret on purpose: the second thing that needs it
 * is the repo's own cross-site control run (`cookie.demo-page.ts`), where a
 * human wants the `127.0.0.1` wall precisely because sessions break there.
 */
export const STAY_ON_HOST_PARAM = "stay";

/** The address to announce on the ready line: this host, kept. */
export function stayOnHostUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.set(STAY_ON_HOST_PARAM, "1");
  return url.href;
}

export interface HostDispatchDeps {
  readonly registry: ProxySiteRegistry;
  readonly proxy: (request: Request, label: string) => Promise<Response>;
  /** Injected so a test can serve the shell without a second server. */
  readonly fetch?: typeof fetch;
}

export function createHostDispatch(deps: HostDispatchDeps) {
  const fetchShell = deps.fetch ?? fetch;

  const labelFor = (request: Request): string | null => {
    try {
      return siteLabelOf(new URL(request.url).hostname);
    } catch {
      return null;
    }
  };

  /**
   * Always to 127.0.0.1, and to the port the client already reached us on: only
   * Chrome promises to resolve `*.localhost` to loopback, the OS resolver this
   * process uses makes no such promise, and reading the port off the incoming
   * URL avoids handing the bound port in after `Bun.serve` returns.
   */
  const wallDocument = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const authority = url.port === "" ? "127.0.0.1" : `127.0.0.1:${url.port}`;
    return fetchShell(`http://${authority}${WALL_SHELL_PATH}`, {
      headers: { accept: request.headers.get("accept") ?? "text/html" },
    });
  };

  /**
   * The wall's two addresses are the same wall — the layout is in SQLite, not
   * in the browser — but only one of them makes a pane same-site, so a browser
   * that arrived on the other is sent to the one that works instead of being
   * told to go there itself. 307 because it is the method- and body-preserving
   * one; nothing but the wall document reaches here, but a redirect that
   * quietly turned a request into a GET would be a trap for the next route.
   *
   * Nothing else can be caught: `/api/*` and the shell path are explicit Bun
   * routes, which win over this catch-all, and a site host never reaches this
   * branch at all.
   */
  const landElsewhere = (url: URL): Response | null => {
    if (url.searchParams.has(STAY_ON_HOST_PARAM)) return null;
    const landing = wallLandingHostname(url.hostname);
    if (landing === null) return null;
    const authority = url.port === "" ? landing : `${landing}:${url.port}`;
    return Response.redirect(
      `${url.protocol}//${authority}${url.pathname}${url.search}`,
      307,
    );
  };

  return {
    /** Wraps a wall route so a proxied site keeps its own path of that name. */
    wallOnly<R extends Request>(
      handler: (request: R) => Response | Promise<Response>,
    ): (request: R) => Promise<Response> {
      return async (request: R): Promise<Response> => {
        const label = labelFor(request);
        if (label !== null) return deps.proxy(request, label);
        return handler(request);
      };
    },

    /** Everything else: a site host is proxied, any other host is the wall page. */
    async catchAll(
      request: Request,
      server: Bun.Server<ProxySocketData>,
    ): Promise<Response> {
      const label = labelFor(request);
      if (label === null) {
        return landElsewhere(new URL(request.url)) ?? wallDocument(request);
      }
      if (upgradeProxySocket(request, server, label, deps.registry)) {
        // Bun wants nothing back once the socket is upgraded; its types insist.
        return undefined as unknown as Response;
      }
      return deps.proxy(request, label);
    },
  };
}
