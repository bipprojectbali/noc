/** HTTP handlers shared by the dev server and the compiled binary. */

import { wallProxyBase } from "../proxy/proxy.label.ts";
import type { ProxySiteRegistry } from "../proxy/proxy.registry.ts";
import { probeEmbeddability } from "./embed.probe.ts";

export const EMBEDDABILITY_PATH = "/api/embeddability";

/**
 * Persistence endpoints. Declared here with the other paths so the browser can
 * import them without reaching into the server module that holds the database.
 */
export const WALL_PATH = "/api/wall";
export const WALL_VIEWS_PATH = "/api/wall/views";
export const WALL_VIEW_PATH = "/api/wall/views/:name";

/** A page the wall can always frame, so tests and setup never depend on the network. */
export const SELF_TEST_PATH = "/api/self-test";

const SELF_TEST_BODY = `<!doctype html>
<meta charset="utf-8">
<title>NOC self test</title>
<body style="margin:0;display:grid;place-items:center;height:100vh;font:600 14px system-ui;background:#0f1115;color:#7ee787">
pane renderer OK
</body>`;

export function handleSelfTest(): Response {
  return new Response(SELF_TEST_BODY, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export interface EmbeddabilityDeps {
  readonly registry: ProxySiteRegistry;
  /** Injected so tests can answer without reaching the network. */
  readonly probe?: typeof probeEmbeddability;
}

/**
 * Answers whether a pane address can be framed — and, on a proxy-capable wall,
 * is also where a site earns its subdomain.
 *
 * That double duty is deliberate: this endpoint is the single hook that runs
 * before any iframe is given a `src` (`pane.store-sites.ts` probes on every
 * address change and on every restored layout), so an origin registered here is
 * registered in time, and an origin that was never put in a pane never gets
 * registered at all.
 *
 * On such a wall the verdict is `unknown` without fetching anything. The site
 * is framed through this server, which removes `X-Frame-Options` and the CSP
 * `frame-ancestors` directive, so a refusal cannot reach the browser and a
 * verdict about one would be a claim this wall can no longer honour. Reporting
 * `refused` there would show the user a warning about something that is not
 * going to happen.
 */
export function createEmbeddabilityHandler(deps: EmbeddabilityDeps) {
  const probe = deps.probe ?? probeEmbeddability;

  return async function handleEmbeddability(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const target = url.searchParams.get("url");
    if (target === null || target === "") {
      return Response.json({ error: "query parameter 'url' is required" }, { status: 400 });
    }

    if (wallProxyBase(url.hostname) !== null && deps.registry.register(target) !== null) {
      return Response.json({
        verdict: "unknown",
        reason: "framed through this wall's own host, so framing headers do not apply",
      });
    }

    const result = await probe(target, url.origin);

    if (!result.ok) {
      return Response.json({ verdict: "unknown", reason: result.reason }, { status: 200 });
    }
    return Response.json({
      verdict: result.decision.verdict,
      reason: result.decision.reason,
      status: result.status,
    });
  };
}
