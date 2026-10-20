/**
 * Why this exists: an iframed dashboard cannot keep its login session.
 *
 * A cookie that arrives without `SameSite` is treated by Chrome as `Lax`, and
 * "site" is computed from the *top-level* document — the wall. So a site framed
 * by a wall on another registrable domain is cross-site: `Set-Cookie` is
 * accepted and then never sent again, the server sees no session, and the page
 * bounces back to login. Nothing on the client can lift that: not a flag, not
 * the Storage Access API, not `credentials: "include"`. The only way out is to
 * make the framed page genuinely same-site with the wall.
 *
 * This file is the arithmetic that does it: every site is served from a sibling
 * subdomain of the wall's own host, so `wall.noc.localhost` frames
 * `s-grafana-…​.noc.localhost` and the browser computes one shared
 * registrable domain, `noc.localhost`, for both. `localhost` is absent from the
 * Public Suffix List, so Chrome's `GetDomainAndRegistry` (with
 * `INCLUDE_UNKNOWN_REGISTRIES`) treats the rightmost label as the eTLD and the
 * two hosts come out same-site. Measured, not assumed: with this shape a child
 * frame sends back cookies set `Strict`, `Lax` and with no attribute at all,
 * while `127.0.0.1`, plain `localhost` and a second base domain each send only
 * `None; Secure`.
 *
 * Two consequences are load-bearing and easy to break by accident:
 *
 *  - **The scheme must match.** Same-site compares scheme as well as
 *    registrable domain, so an http wall framing an https proxy host is
 *    cross-site again. `proxySiteUrl` therefore builds the frame URL from the
 *    *wall's* protocol, never the site's.
 *  - **`*.localhost` is required.** Chrome resolves `*.localhost` at any depth
 *    to loopback with no entry in `/etc/hosts` (RFC 6761 §6.3), and it counts
 *    as a potentially-trustworthy origin, so a `Secure` cookie set over plain
 *    http is still stored and still sent. No other suffix gives both, and no
 *    other suffix has been measured, so a wall served from anything else is
 *    reported as not proxy-capable rather than quietly half-working.
 *
 * Everything here is pure because the two sides must agree forever: the browser
 * turns a site origin into a hostname, the server reads that hostname back off
 * the `Host` header, and a label that disagreed between them — or between two
 * runs of the same wall — would land the user on a host holding none of his
 * cookies, which is precisely the bug being cured.
 */

/** Marks a hostname as one of ours, and keeps site hosts out of the wall's way. */
export const SITE_LABEL_PREFIX = "s-";

/**
 * The host to open the wall on. Fixed rather than configurable: it has to be a
 * `*.localhost` subdomain at depth ≥ 3 for the resolution and same-site rules
 * above, which leaves nothing for an operator to choose. Only the port varies,
 * and that comes from `NOC_PORT` as it always did.
 */
export const WALL_PROXY_HOSTNAME = "wall.noc.localhost";

const MAX_DNS_LABEL_LENGTH = 63;
const FINGERPRINT_RADIX = 36;
/** `(2 ** 32 - 1).toString(36)` is seven characters, so each half is padded to seven. */
const FINGERPRINT_HALF_LENGTH = 7;
const FINGERPRINT_LENGTH = FINGERPRINT_HALF_LENGTH * 2;
const MAX_READABLE_LENGTH =
  MAX_DNS_LABEL_LENGTH - SITE_LABEL_PREFIX.length - 1 - FINGERPRINT_LENGTH;

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Where the wall page is, as `window.location` happens to supply it. */
export interface WallLocation {
  readonly protocol: string;
  readonly hostname: string;
  readonly port: string;
}

function fnv1a(input: string, seed: number): number {
  let hash = seed;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * A short, stable digest of the whole origin. Not a security boundary — it only
 * has to keep two different sites from sharing one subdomain, and it has to
 * produce the same answer next week, which rules out anything seeded per run.
 * The second pass is chained through the first so both halves depend on the
 * entire input.
 */
function originFingerprint(origin: string): string {
  const low = fnv1a(origin, FNV_OFFSET_BASIS);
  const high = fnv1a(`${origin}\u0000${low}`, FNV_OFFSET_BASIS);
  return (
    low.toString(FINGERPRINT_RADIX).padStart(FINGERPRINT_HALF_LENGTH, "0") +
    high.toString(FINGERPRINT_RADIX).padStart(FINGERPRINT_HALF_LENGTH, "0")
  );
}

/**
 * The part of the label a human can read in devtools. Purely cosmetic: the
 * fingerprint already decides identity, so this may be truncated or mangled
 * without consequence. DNS labels allow only letters, digits and hyphens.
 */
function readableHost(hostname: string): string {
  const slug = hostname
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") return "site";
  return slug.slice(0, MAX_READABLE_LENGTH).replace(/-+$/g, "");
}

/**
 * The canonical origin of a pane address, or null for anything that cannot be
 * proxied. `URL.origin` lowercases the host and drops a default port, so the
 * same site typed two ways yields one label — and therefore one cookie jar.
 */
export function siteOriginOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.hostname === "") return null;
  return parsed.origin;
}

/** The subdomain label that stands for one site origin. */
export function siteLabel(siteOrigin: string): string {
  const hostname = new URL(siteOrigin).hostname;
  return `${SITE_LABEL_PREFIX}${readableHost(hostname)}-${originFingerprint(siteOrigin)}`;
}

function proxyLabels(hostname: string): string[] | null {
  const labels = hostname.toLowerCase().split(".");
  // Depth 3 is the minimum that leaves a registrable domain to share: on
  // `wall.localhost` the eTLD+1 is `wall.localhost` itself, and a sibling would
  // be a different site again. Measured as a control, and it failed.
  if (labels.length < 3) return null;
  if (labels[labels.length - 1] !== "localhost") return null;
  if (labels.some((label) => label === "")) return null;
  return labels;
}

/**
 * The registrable domain the wall shares with its site subdomains, or null when
 * the wall is on a host where none of this works (`127.0.0.1`, bare
 * `localhost`). Null is the signal to leave pane addresses alone and tell the
 * user why, never to half-apply the scheme.
 */
export function wallProxyBase(hostname: string): string | null {
  const labels = proxyLabels(hostname);
  return labels === null ? null : labels.slice(1).join(".");
}

/**
 * Reads a site label back off an incoming `Host`. The label alone decides
 * nothing: the registry still has to know it, so an invented hostname gets a
 * 404 rather than a fetch.
 */
export function siteLabelOf(hostname: string): string | null {
  const labels = proxyLabels(hostname);
  const first = labels?.[0];
  if (first === undefined) return null;
  if (!first.startsWith(SITE_LABEL_PREFIX)) return null;
  if (first.length === SITE_LABEL_PREFIX.length) return null;
  return first;
}

/**
 * The URL to point an iframe at, or null when the wall cannot proxy. Path,
 * query and fragment are carried over verbatim; only the authority moves. Built
 * by concatenation rather than `new URL(path, base)` because a path beginning
 * `//` would be read as protocol-relative and silently change host.
 */
export function proxySiteUrl(siteUrl: string, wall: WallLocation): string | null {
  const base = wallProxyBase(wall.hostname);
  if (base === null) return null;
  const origin = siteOriginOf(siteUrl);
  if (origin === null) return null;

  const target = new URL(siteUrl);
  const host = `${siteLabel(origin)}.${base}`;
  const authority = wall.port === "" ? host : `${host}:${wall.port}`;
  return `${wall.protocol}//${authority}${target.pathname}${target.search}${target.hash}`;
}
