/**
 * Three loopback routes that turn the wall's cookie warning into something a
 * user can watch happen.
 *
 * The split across these routes is the whole point, and it is not arbitrary:
 * `set` is the only one that issues cookies, `read` is the only one that
 * reports what came back, and nothing joins them except the browser's own jar.
 * That is what makes the result evidence rather than a claim — the server never
 * gets to say whether a cookie "worked", it only reports the `Cookie` header it
 * was handed.
 *
 * Security shape, deliberately narrower than `/api/embeddability` beside it:
 * zero outbound fetches, zero client-supplied URLs, zero file reads, and no
 * input of any kind is read off the request except the `Cookie` header's
 * *names*. There is nothing here to point at another host, so none of the SSRF
 * reasoning that keeps this server on loopback is extended by one inch.
 *
 * What these routes cannot prove on their own: see the page module. In short,
 * the demo only demonstrates anything when the page is framed by a *different*
 * site, and on loopback that means serving it to `localhost` while the wall
 * sits on `127.0.0.1` (or the reverse). Same host on both ends is same-site and
 * every variant comes back, which proves nothing at all.
 */

import { cookieDemoPage } from "./cookie.demo-page.ts";
import {
  COOKIE_DEMO_VARIANTS,
  setCookieHeaderFor,
  variantsSentBack,
} from "./cookie.variants.ts";

export const COOKIE_DEMO_PAGE_PATH = "/api/cookie-demo";
export const COOKIE_DEMO_SET_PATH = "/api/cookie-demo/set";
export const COOKIE_DEMO_READ_PATH = "/api/cookie-demo/read";

/**
 * Nothing here may be cached, by anyone, ever. A cached `set` response would
 * hand back yesterday's `Set-Cookie` headers, and a cached `read` would report
 * a jar that has since changed — either one turns the demo into a liar.
 */
const NO_STORE = "no-store, no-cache, must-revalidate";

export function handleCookieDemoPage(): Response {
  return new Response(cookieDemoPage({ set: COOKIE_DEMO_SET_PATH, read: COOKIE_DEMO_READ_PATH }), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": NO_STORE,
      // The page has to be framable by the wall — that is the entire exercise —
      // so it carries no X-Frame-Options and no frame-ancestors.
      "x-noc-demo": "cookie-samesite",
    },
  });
}

/**
 * The headers the `set` response carries, built apart from the `Response`.
 *
 * This split exists so the suite can read them, and that is not testability
 * theatre: happy-dom implements the browser's *response* header guard, so any
 * `Response` constructed under the test preload silently drops every
 * `Set-Cookie` — `getSetCookie()` on it returns an empty list no matter what
 * went in. A standalone `Headers` keeps them. So this is the last point at
 * which the demo's own headers are observable from a test at all.
 */
export function cookieDemoSetHeaders(): Headers {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": NO_STORE,
  });
  // `append`, never `set`: one `Set-Cookie` header per cookie is the only form
  // browsers parse reliably, and joining them with commas would let the comma
  // inside a date attribute fake a boundary.
  for (const variant of COOKIE_DEMO_VARIANTS) {
    headers.append("set-cookie", setCookieHeaderFor(variant));
  }
  return headers;
}

/**
 * Issues every variant in one response.
 *
 * One response rather than five requests because the browser's decision to
 * accept or refuse each cookie is then made under identical conditions: same
 * origin, same frame, same moment. Five sequential requests would let a
 * third-party cookie-blocking heuristic change its mind halfway through and
 * make the result unreproducible.
 */
export function handleCookieDemoSet(): Response {
  return new Response(
    JSON.stringify({
      attempted: COOKIE_DEMO_VARIANTS.map((variant) => ({
        id: variant.id,
        cookieName: variant.cookieName,
        attributes: variant.attributes,
        expectation: variant.expectation,
      })),
    }),
    { headers: cookieDemoSetHeaders() },
  );
}

/**
 * Everything `handleCookieDemoRead` reads of a request: one header, by name.
 *
 * A real `Request` satisfies this, so Bun's router is unaffected. Declaring the
 * narrow shape is what lets the suite exercise the measurement at all — under
 * the happy-dom preload, `new Request(url, { headers: { cookie } })` returns
 * null for that header, because happy-dom enforces the browser's forbidden
 * request-header list. A standalone `Headers` does carry it.
 *
 * It also states the access honestly: this handler can read one named header
 * and has no way to reach anything else about the request.
 */
export type CookieHeaderSource = {
  readonly headers: { get: (name: string) => string | null };
};

/**
 * Reports which variants the browser attached to *this* request.
 *
 * This is the measurement. The server has no opinion and runs no logic beyond
 * matching names: whatever is missing from the list was withheld by the browser
 * between the `set` call and this one.
 *
 * The incoming header is never logged. On a developer's machine it can hold
 * sessions belonging to every other app on loopback, and only the demo's own
 * cookie *names* ever leave this function.
 */
export function handleCookieDemoRead(request: CookieHeaderSource): Response {
  const sentBack = variantsSentBack(request.headers.get("cookie"));

  return new Response(JSON.stringify({ sentBack }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": NO_STORE,
    },
  });
}
