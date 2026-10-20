/**
 * Decides, from a target's `Set-Cookie` headers, whether its session survives
 * being framed — so the wall can say so before a login is attempted.
 *
 * Why this exists at all: a pane drawn as an iframe is a cross-site context,
 * and the "site" the browser compares against is the top-level document, which
 * is the wall page. A cookie issued without `SameSite`, or with `Lax` or
 * `Strict`, is accepted into the jar and then never attached to the framed
 * page's own requests. The server sees no session and answers with the login
 * form again, which reads as a login that silently failed. Nothing here can
 * change that — it is the browser's rule, and this app never rewrites a
 * target's headers (see the classifier beside this file). All it does is name
 * the cause, because without it the wall is mute and the app looks broken.
 *
 * Two deliberate limits:
 *
 * - Zero cookies means **unknown**, never "safe". A login page commonly sets
 *   nothing on a GET, and the probe only ever sees one GET.
 * - Cookie *values* are credentials and never leave this function. Only names
 *   and the attribute that disqualified them come back.
 */

export type FrameCookieProblem =
  | "no-samesite"
  | "lax"
  | "strict"
  | "none-without-secure";

/** A cookie that will not be attached inside a frame, and what disqualified it. */
export type FrameCookieBlock = { name: string; problem: FrameCookieProblem };

export type FrameCookieDecision =
  /** The response set no cookie, so nothing can be concluded either way. */
  | { verdict: "unknown" }
  /** Every cookie it set is `SameSite=None; Secure`, which a frame does send. */
  | { verdict: "sendable" }
  /** At least one cookie will be dropped. The others may still be fine. */
  | { verdict: "blocked"; blocked: readonly FrameCookieBlock[] };

/** Display text for the attribute that disqualified a cookie. */
export const FRAME_COOKIE_PROBLEM_TEXT: Record<FrameCookieProblem, string> = {
  "no-samesite": "no usable SameSite attribute, so the browser defaults it to Lax",
  lax: "SameSite=Lax",
  strict: "SameSite=Strict",
  "none-without-secure": "SameSite=None without Secure, which the browser rejects",
};

/**
 * Attributes of one `Set-Cookie` value, lowercased, name=value pair dropped.
 *
 * Splitting on `;` and never on `,` is load-bearing: `Expires=Wed, 09 Jun 2027
 * 10:18:14 GMT` carries a comma inside a single attribute, so a comma split
 * would tear one cookie into two halves and lose its `SameSite`.
 */
function attributesOf(raw: string): string[] {
  return raw
    .split(";")
    .slice(1)
    .map((attribute) => attribute.trim().toLowerCase());
}

/** The cookie's name, or null when the header carries no usable pair. */
function nameOf(raw: string): string | null {
  const pair = raw.split(";")[0] ?? "";
  const separator = pair.indexOf("=");
  if (separator === -1) return null;
  const name = pair.slice(0, separator).trim();
  return name === "" ? null : name;
}

/** What disqualifies this cookie inside a frame, or null if nothing does. */
function problemOf(raw: string): FrameCookieProblem | null {
  const attributes = attributesOf(raw);
  const prefix = "samesite=";
  const declared = attributes.find((attribute) => attribute.startsWith(prefix));
  const sameSite = declared?.slice(prefix.length).trim();

  switch (sameSite) {
    case "none":
      // `None` without `Secure` is refused by the browser outright, so the
      // cookie is not merely withheld in the frame — it never lands at all.
      return attributes.includes("secure") ? null : "none-without-secure";
    case "lax":
      return "lax";
    case "strict":
      return "strict";
    default:
      // Absent, empty, or a value no browser recognises. All three end up at
      // the same place: the default, which is Lax.
      return "no-samesite";
  }
}

/**
 * `setCookie` is the list of `Set-Cookie` headers as the runtime hands them
 * over — one entry per header, from `Headers.getSetCookie()`. Never one joined
 * string: joining them loses the boundary that an `Expires` comma then fakes.
 */
export function classifyFrameCookies(
  setCookie: readonly string[],
): FrameCookieDecision {
  const blocked: FrameCookieBlock[] = [];
  let usable = 0;

  for (const raw of setCookie) {
    const name = nameOf(raw);
    if (name === null) continue;
    usable += 1;
    const problem = problemOf(raw);
    if (problem !== null) blocked.push({ name, problem });
  }

  if (usable === 0) return { verdict: "unknown" };
  return blocked.length === 0 ? { verdict: "sendable" } : { verdict: "blocked", blocked };
}
