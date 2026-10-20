/**
 * Every header this proxy rewrites, and why each one has to be rewritten.
 * Pure: no fetch, no DOM, so each rule below is provable without a network.
 *
 * The goal is one thing only — move a site onto a hostname that is same-site
 * with the wall so its session cookie is actually sent back (see
 * `proxy.label.ts`). Four of these rules are what *pays for* that move, and
 * removing any one of them breaks something that is currently working:
 *
 *  - **`Set-Cookie`: drop `Domain`.** This is security, not tidiness. Every
 *    site now lives under one registrable domain, so a cookie scoped
 *    `Domain=.noc.localhost` — or to any parent of the site's label — would be
 *    handed to every other pane on the wall. Host-only cookies keep site A's
 *    session out of site B. `Secure` and everything else is kept untouched;
 *    `Secure` in particular *must* survive, because `*.localhost` is
 *    potentially-trustworthy and the cookie works over plain http, while
 *    stripping the attribute is the one edit that would break a site that sets
 *    it.
 *  - **`Location`: rewrite back onto the proxy host.** A login flow is a chain
 *    of redirects. Released to the real origin even once, the browser leaves
 *    the proxy subdomain, and the cookie it is carrying is cross-site again.
 *  - **`Content-Encoding` and `Content-Length`: delete.** `fetch` decompresses
 *    the upstream body but leaves both headers describing the compressed bytes.
 *    Forwarding them makes the browser decode an already-decoded body and fail
 *    the response outright (`ZlibError`), with a `Content-Length` off by
 *    whatever the ratio was.
 *  - **`Origin` and `Referer`: rewrite to the upstream origin.** Backends that
 *    check either for CSRF reject a POST whose `Origin` is a hostname they have
 *    never heard of. The failure looks exactly like the login bug being cured
 *    here, which makes it the most expensive one to leave in.
 *
 * And one rule that is a deliberate revocation of an invariant, not an
 * oversight: **`X-Frame-Options` is dropped and `frame-ancestors` is removed
 * from any CSP.** The project's rule was that no target header is ever
 * rewritten and a framing refusal is reported to the user instead of worked
 * around. That rule is partly revoked on explicit instruction. Note what the
 * aim is: not defeating framing refusal for its own sake, but that a reverse
 * proxy cannot honour `frame-ancestors` meaningfully anyway — the site cannot
 * see the real embedder, and the headers it sends describe an origin that is no
 * longer in the picture. Losing the refusal notice is a side effect of moving
 * the site next to the wall, not the purpose. The rest of the CSP is left
 * alone: only the directive that blocks framing is removed.
 *
 * The same reasoning, and the same narrowness, cover one more rule: **`camera`
 * and `microphone` are removed from any `Permissions-Policy` the site sends.**
 * A pane delegates both features to the framed document (`PANE_ALLOW_POLICY` in
 * `pane.iframe-renderer.tsx`), but delegation is only half the decision — the
 * document's own policy header applies on top of it, and a site answering
 * `camera=()` switches the feature off for itself no matter what the container
 * allowed. Measured, not assumed: a stand-in serving exactly that header
 * reports `featurePolicy.allowsFeature("camera") === false` inside a pane and
 * fails with `NotAllowedError: Permission denied`, while the identical page
 * without the header reaches the device. Removing the directive is not the same
 * as forcing the feature on — it falls back to the default allowlist, which for
 * both features is `self`, which is exactly what the pane already delegated.
 * Every other directive is left standing, so a site's `geolocation=()` still
 * means what it said.
 */

/**
 * Headers that describe one hop of a connection and must never be forwarded.
 * `host` is omitted deliberately — `fetch` sets it from the target URL, and a
 * manual copy would be ignored at best.
 */
const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

/** Dropped from responses on the way back. See the docblock for each reason. */
const DROPPED_RESPONSE_HEADERS = [
  ...HOP_BY_HOP_HEADERS,
  "content-encoding",
  "content-length",
  "x-frame-options",
];

const CSP_HEADERS = [
  "content-security-policy",
  "content-security-policy-report-only",
];

/**
 * The features a pane hands to the site it frames. Kept in step with
 * `PANE_ALLOW_POLICY` by hand rather than imported: that constant lives in a
 * React renderer, and this module is loaded by the server, which must not pull
 * the frontend in behind it.
 */
const DELEGATED_CAPTURE_FEATURES = ["camera", "microphone"];

/**
 * The two spellings of a capture policy, with the separator each one uses
 * between directives. `Feature-Policy` is the superseded form and reaches here
 * only from a site old enough to still emit it; stripping both costs one entry
 * and avoids a hole that would be invisible until someone hit it.
 */
const CAPTURE_POLICY_HEADERS: readonly (readonly [string, string])[] = [
  ["permissions-policy", ","],
  ["feature-policy", ";"],
];

/**
 * Removes the `Domain` attribute so the cookie is stored host-only. Splitting
 * on `;` is safe: an unquoted cookie value may not contain a semicolon, and a
 * quoted one is still a single segment.
 */
export function stripCookieDomain(setCookie: string): string {
  const kept = setCookie
    .split(";")
    .filter((segment) => !segment.trim().toLowerCase().startsWith("domain="));
  return kept.join(";");
}

/**
 * Removes only `frame-ancestors`, keeping the rest of the policy. Returns null
 * when that was the whole policy, which means the header should be dropped —
 * an empty CSP header is not the same as no CSP header.
 */
export function stripFrameAncestors(policy: string): string | null {
  const kept = policy
    .split(";")
    .map((directive) => directive.trim())
    .filter((directive) => directive !== "")
    .filter((directive) => directive.split(/\s+/)[0]?.toLowerCase() !== "frame-ancestors");
  if (kept.length === 0) return null;
  return kept.join("; ");
}

/**
 * Removes only the capture directives, keeping the rest of the policy. Returns
 * null when nothing is left, which means the header should be dropped — an
 * empty policy header is not the same as no policy header.
 *
 * A directive name is whatever precedes the first `=` (`Permissions-Policy`) or
 * the first space (`Feature-Policy`); the allowlist that follows may contain
 * neither separator unquoted, so one split settles both spellings.
 */
export function stripCapturePolicy(policy: string, separator: string): string | null {
  const kept = policy
    .split(separator)
    .map((directive) => directive.trim())
    .filter((directive) => directive !== "")
    .filter(
      (directive) =>
        !DELEGATED_CAPTURE_FEATURES.includes(
          (directive.split(/[=\s]/)[0] ?? "").toLowerCase(),
        ),
    );
  if (kept.length === 0) return null;
  return kept.join(`${separator} `);
}

/**
 * Points a redirect back at the proxy host. Only the upstream's own origin is
 * rewritten: a redirect to a third party (an SSO provider, say) is left as it
 * stands, because proxying it would mean registering a host the user never put
 * on the wall. That is a real limit of this design, not an omission — such a
 * flow leaves the proxy and loses its session again.
 *
 * A relative `Location` is returned untouched; it already resolves against the
 * proxy host.
 */
export function rewriteLocation(
  location: string,
  upstreamOrigin: string,
  proxyOrigin: string,
): string {
  let parsed: URL;
  try {
    parsed = new URL(location);
  } catch {
    return location;
  }
  if (parsed.origin !== upstreamOrigin) return location;
  return `${proxyOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * The headers to send upstream. `Cookie` passes through verbatim — it is the
 * whole point of the exercise — and `Accept-Encoding` is dropped so `fetch`
 * negotiates an encoding it will actually decode.
 */
export function proxyRequestHeaders(
  incoming: Headers,
  upstreamOrigin: string,
  proxyOrigin: string,
): Headers {
  const headers = new Headers(incoming);
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
  headers.delete("host");
  headers.delete("accept-encoding");
  // The body is forwarded as a stream, so its length is no longer known here.
  headers.delete("content-length");

  const origin = headers.get("origin");
  if (origin !== null) {
    headers.set("origin", origin === proxyOrigin ? upstreamOrigin : origin);
  }
  const referer = headers.get("referer");
  if (referer !== null && referer.startsWith(proxyOrigin)) {
    headers.set("referer", `${upstreamOrigin}${referer.slice(proxyOrigin.length)}`);
  }
  return headers;
}

/** The headers to send back to the browser. */
export function proxyResponseHeaders(
  upstream: Headers,
  upstreamOrigin: string,
  proxyOrigin: string,
): Headers {
  const headers = new Headers(upstream);
  for (const name of DROPPED_RESPONSE_HEADERS) headers.delete(name);

  for (const name of CSP_HEADERS) {
    const policy = headers.get(name);
    if (policy === null) continue;
    const kept = stripFrameAncestors(policy);
    if (kept === null) headers.delete(name);
    else headers.set(name, kept);
  }

  for (const [name, separator] of CAPTURE_POLICY_HEADERS) {
    const policy = headers.get(name);
    if (policy === null) continue;
    const kept = stripCapturePolicy(policy, separator);
    if (kept === null) headers.delete(name);
    else headers.set(name, kept);
  }

  const location = headers.get("location");
  if (location !== null) {
    headers.set("location", rewriteLocation(location, upstreamOrigin, proxyOrigin));
  }

  // getSetCookie keeps one entry per cookie; a plain get() would join them with
  // a comma and corrupt any cookie carrying a date.
  const cookies = upstream.getSetCookie();
  if (cookies.length > 0) {
    headers.delete("set-cookie");
    for (const cookie of cookies) headers.append("set-cookie", stripCookieDomain(cookie));
  }

  return headers;
}
