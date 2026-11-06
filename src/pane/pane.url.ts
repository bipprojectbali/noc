/**
 * Normalizes and validates what a user types into a pane's URL bar, and names
 * the page it points at.
 *
 * Two names, because a wall is watched on a shared screen: the short one
 * (`siteShortLabel`) is what the menu and the drag label show — shorter, and
 * the organisation's domain stays off screen. The full host (`urlHostLabel`)
 * stays wherever diagnosis or telling two pages apart needs it: tooltips, a
 * refusal message, and any short name two hosts in one pane would share.
 */

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

/**
 * The host, for the places a pane names a page in one word: a drop ring's
 * label, a site switch's tooltip, a refusal message.
 *
 * Falls back to the whole string rather than throwing. Everything the UI shows
 * came through `normalizePaneUrl` and parses — but it may have come through it
 * weeks ago and arrived back from the database since, and a URL that fails to
 * parse in a render blanks the wall.
 */
export function urlHostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// ponytail: a hand-picked list, not the Public Suffix List. An unlisted suffix
// only makes a less pretty label (`co.za` → "co"), never a wrong page — swap in
// `tldts` / the PSL if that ever matters.
const SECOND_LEVEL_SUFFIXES = new Set([
  "co.id", "go.id", "ac.id", "or.id", "web.id", "my.id", "sch.id", "biz.id",
  "net.id", "mil.id", "desa.id", "ponpes.id",
  "co.uk", "org.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au",
  "co.jp", "ne.jp", "com.sg", "com.my", "co.nz", "com.br", "co.in",
]);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * One word for a site: its leftmost subdomain (`ravenstone.wibudev.com` →
 * "ravenstone"), or the name of a bare domain (`contohweb.com` → "contohweb").
 * IPs and single-label hosts keep host + port, because there the port is what
 * tells dashboards apart. Never throws, for the same reason as `urlHostLabel`.
 */
export function siteShortLabel(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const labels = hostname.split(".");
  if (hostname.includes(":") || IPV4.test(hostname) || labels.length < 2) {
    return parsed.host;
  }

  const suffixSize = SECOND_LEVEL_SUFFIXES.has(labels.slice(-2).join(".")) ? 2 : 1;
  if (labels.length <= suffixSize) return parsed.host;

  const registrable = labels.length - suffixSize - 1;
  const sub = labels.slice(0, registrable);
  if (sub[0] === "www") sub.shift();
  return sub[0] ?? labels[registrable] ?? parsed.host;
}

/**
 * `siteShortLabel` for every site in one pane, except a short name that two
 * different hosts would share falls back to the full host — `api.a.com` and
 * `api.b.com` side by side must not both read "api".
 */
export function siteShortLabels(urls: readonly string[]): string[] {
  const shorts = urls.map(siteShortLabel);
  const hostsByShort = new Map<string, Set<string>>();
  shorts.forEach((short, i) => {
    const hosts = hostsByShort.get(short) ?? new Set<string>();
    hosts.add(urlHostLabel(urls[i] ?? ""));
    hostsByShort.set(short, hosts);
  });
  return shorts.map((short, i) =>
    (hostsByShort.get(short)?.size ?? 0) > 1 ? urlHostLabel(urls[i] ?? "") : short,
  );
}
