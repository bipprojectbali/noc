/**
 * The cookie variants the loopback demo hands out, and the pure half of reading
 * the answer back.
 *
 * Why this exists: the wall tells users that a cookie issued without
 * `SameSite`, or with `Lax` or `Strict`, is accepted into the jar and then
 * never attached to a framed page's own requests — which is why a login inside
 * a pane appears to succeed and then bounces back to the form. That claim is
 * the entire justification for the warning the wall shows, and nothing in this
 * repository could check it: every test runs in happy-dom, which has no cookie
 * jar, no real origin, and no notion of a "site". The claim was an assertion in
 * a comment and nothing more, so a user had no way to believe it.
 *
 * This module is the generating half of a demo that makes it visible in a real
 * browser instead. One response sets every variant at once; a later request's
 * `Cookie` header says which of them the browser was willing to send back. The
 * gap between those two lists is the reported bug, reproduced on loopback with
 * no internet, no real login, and no credentials.
 *
 * Deliberate choices:
 *
 * - **Values announce themselves as a demo**, in the value itself. These land
 *   in a real jar on the user's own machine, so nothing here may ever be
 *   mistaken for a session. No value is ever logged, printed, or echoed.
 * - **`Path` is scoped to the demo, not `/`.** Cookies at `/` would ride along
 *   on every wall request, the persistence PUTs included, for no gain.
 * - **Short `Max-Age`.** The demo is a ten-second look, not state worth keeping.
 */

/** Where the demo's cookies apply — the demo's own routes and nothing else. */
export const COOKIE_DEMO_PATH_SCOPE = "/api/cookie-demo";

/** Long enough to click through the demo twice, short enough to forget. */
export const COOKIE_DEMO_MAX_AGE_SECONDS = 600;

/**
 * Says what it is in the value. Anyone who finds this in a jar, a devtools
 * panel, or a HAR file should be able to tell at a glance that it is inert.
 */
const COOKIE_DEMO_VALUE = "noc-demo-value-not-a-session";

export type CookieDemoVariant = {
  /** Stable id, and the suffix of the cookie name, so output reads itself. */
  readonly id: string;
  /** Names its own variant: results need no legend to be understood. */
  readonly cookieName: string;
  /** Exactly what follows the shared attributes in `Set-Cookie`. */
  readonly attributes: string;
  /** One line for the demo page, in the user's terms. */
  readonly expectation: string;
};

/**
 * The five variants, in increasing order of how well they survive a frame.
 *
 * `None` always carries `Secure`, because `SameSite=None` without it is refused
 * by the browser outright — that combination tests nothing about framing, only
 * about a malformed header, so it is not offered as a variant here.
 */
export const COOKIE_DEMO_VARIANTS: readonly CookieDemoVariant[] = [
  {
    id: "unspecified",
    cookieName: "noc_demo_samesite_unspecified",
    attributes: "",
    expectation:
      "No SameSite at all — the browser defaults it to Lax. This is what most login backends still emit, and it is the reported bug.",
  },
  {
    id: "lax",
    cookieName: "noc_demo_samesite_lax",
    attributes: "SameSite=Lax",
    expectation:
      "Lax spelled out. Sent on top-level navigation only, never on a request made from inside a frame.",
  },
  {
    id: "strict",
    cookieName: "noc_demo_samesite_strict",
    attributes: "SameSite=Strict",
    expectation: "Strict. Same-site requests only, so a frame never gets it.",
  },
  {
    id: "none-secure",
    cookieName: "noc_demo_samesite_none_secure",
    attributes: "SameSite=None; Secure",
    expectation:
      "The only variant a cross-site frame is meant to carry. Needs Secure, which plain HTTP allows here because loopback counts as trustworthy.",
  },
  {
    id: "none-secure-partitioned",
    cookieName: "noc_demo_samesite_none_secure_partitioned",
    attributes: "SameSite=None; Secure; Partitioned",
    expectation:
      "As above, plus CHIPS partitioning — kept in a jar keyed to the embedding site. Survives third-party cookie blocking, which plain None does not.",
  },
];

/** The full `Set-Cookie` value for one variant, shared attributes included. */
export function setCookieHeaderFor(variant: CookieDemoVariant): string {
  const shared = `Path=${COOKIE_DEMO_PATH_SCOPE}; Max-Age=${COOKIE_DEMO_MAX_AGE_SECONDS}`;
  const tail = variant.attributes === "" ? "" : `; ${variant.attributes}`;
  return `${variant.cookieName}=${COOKIE_DEMO_VALUE}; ${shared}${tail}`;
}

/**
 * The cookie names in an incoming `Cookie` request header.
 *
 * Splitting on `;` and never on `,` matters for the same reason it does in
 * `embed.cookies.ts`, from the opposite direction: `;` is the only separator
 * the `Cookie` header uses, so a comma split would tear a value in half and
 * invent a cookie that was never sent.
 *
 * Values are dropped here on purpose and never returned. A real `Cookie` header
 * on a loopback request can hold the user's own sessions for other local apps;
 * this demo only ever needs to know which names arrived.
 */
export function cookieNamesIn(header: string | null): ReadonlySet<string> {
  const names = new Set<string>();
  if (header === null) return names;

  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    // A segment with no `=` is not a cookie pair; skipping it is the only
    // reading that cannot invent a name.
    if (separator === -1) continue;
    const name = pair.slice(0, separator).trim();
    if (name !== "") names.add(name);
  }
  return names;
}

/** Ids of the variants the browser actually sent back, in declaration order. */
export function variantsSentBack(header: string | null): readonly string[] {
  const names = cookieNamesIn(header);
  return COOKIE_DEMO_VARIANTS.filter((variant) =>
    names.has(variant.cookieName),
  ).map((variant) => variant.id);
}
