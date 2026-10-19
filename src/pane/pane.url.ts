/** Normalizes and validates what a user types into a pane's URL bar. */

export type PaneUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: string };

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Accepts a bare host ("example.com") by assuming https, and rejects every
 * scheme a pane must never load — `javascript:` and `data:` would execute in
 * the wall's own context, and `file:` would read the host machine.
 */
export function normalizePaneUrl(input: string): PaneUrlResult {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: false, reason: "Enter a URL" };
  }

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, reason: `"${trimmed}" is not a valid URL` };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return {
      ok: false,
      reason: `Only http and https are allowed, got "${parsed.protocol}"`,
    };
  }
  if (parsed.hostname === "") {
    return { ok: false, reason: `"${trimmed}" has no host` };
  }

  return { ok: true, url: parsed.toString() };
}
