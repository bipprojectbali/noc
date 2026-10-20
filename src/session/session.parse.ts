/**
 * Reads a cookie export file into `SessionCookie`s.
 *
 * Users export from whatever extension they already have, so the format is not
 * ours to dictate — the file is sniffed rather than declared. Two shapes cover
 * nearly everything in the wild: Netscape `cookies.txt` and the JSON array that
 * EditThisCookie, Cookie-Editor and their clones emit.
 *
 * A malformed line is skipped, never fatal: one bad row must not discard the
 * 200 good ones around it. Only a file that yields nothing at all is a failure,
 * because that is the one case where the user has to do something differently.
 *
 * Pure: no I/O, no DOM. Reading the file and installing the cookies happen
 * elsewhere.
 */

import type {
  SessionCookie,
  SessionParseResult,
} from "./session.types.ts";

/** A record with unknown fields — what `JSON.parse` actually hands back. */
type UnknownRecord = Record<string, unknown>;

/**
 * `#HttpOnly_` is not a comment. It is a prefix on the domain column that curl
 * and Chrome both use to mark a cookie the page's scripts may not read.
 */
const HTTP_ONLY_PREFIX = "#HttpOnly_";

/**
 * Netscape stores an absolute Unix timestamp, with `0` meaning "session". Any
 * non-positive or non-finite value is treated the same way: better a cookie
 * that dies with the window than one with a nonsense expiry.
 */
function toExpiry(raw: unknown): number | null {
  const seconds = typeof raw === "string" ? Number(raw) : raw;
  if (typeof seconds !== "number") return null;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.floor(seconds);
}

function parseNetscape(text: string): { cookies: SessionCookie[]; skipped: number } {
  const cookies: SessionCookie[] = [];
  let skipped = 0;

  for (const line of text.split("\n")) {
    // Only trailing whitespace is stripped (CRLF, stray tabs). Trimming the
    // front would swallow an empty leading domain column and silently shift
    // every field one place left.
    const row = line.replace(/\s+$/, "");
    if (row.trim() === "") continue;

    const httpOnly = row.startsWith(HTTP_ONLY_PREFIX);
    if (!httpOnly && row.startsWith("#")) continue;

    const columns = (
      httpOnly ? row.slice(HTTP_ONLY_PREFIX.length) : row
    ).split("\t");
    // domain | includeSubdomains | path | secure | expires | name | value.
    // The value column may legitimately be empty, so a 6-column line is a
    // cookie with no value rather than a broken row.
    if (columns.length < 6) {
      skipped += 1;
      continue;
    }

    const domain = columns[0]?.trim() ?? "";
    const path = columns[2]?.trim() ?? "";
    const secure = columns[3]?.trim().toUpperCase() === "TRUE";
    const name = columns[5] ?? "";
    const value = columns[6] ?? "";

    if (domain === "" || name === "") {
      skipped += 1;
      continue;
    }

    cookies.push({
      name,
      value,
      domain,
      path: path === "" ? "/" : path,
      secure,
      httpOnly,
      expires: toExpiry(columns[4]),
    });
  }

  return { cookies, skipped };
}

function parseJsonEntry(entry: unknown): SessionCookie | null {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }
  const record = entry as UnknownRecord;

  const name = record["name"];
  const domain = record["domain"];
  if (typeof name !== "string" || name === "") return null;
  if (typeof domain !== "string" || domain === "") return null;

  const value = record["value"];
  const path = record["path"];

  // Extensions disagree on the expiry field and on whether a session cookie is
  // flagged or simply has no expiry, so all three spellings are honoured.
  const expires =
    record["session"] === true
      ? null
      : toExpiry(record["expirationDate"] ?? record["expires"]);

  return {
    name,
    value: typeof value === "string" ? value : "",
    domain,
    path: typeof path === "string" && path !== "" ? path : "/",
    secure: record["secure"] === true,
    httpOnly: record["httpOnly"] === true,
    expires,
  };
}

export function parseSessionCookies(text: string): SessionParseResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, reason: "empty-file" };

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { ok: false, reason: "unrecognised-format" };
    }
    if (!Array.isArray(parsed)) {
      return { ok: false, reason: "unrecognised-format" };
    }

    const cookies: SessionCookie[] = [];
    let skipped = 0;
    for (const entry of parsed) {
      const cookie = parseJsonEntry(entry);
      if (cookie === null) skipped += 1;
      else cookies.push(cookie);
    }
    return cookies.length === 0
      ? { ok: false, reason: "no-valid-cookies" }
      : { ok: true, format: "json", cookies, skipped };
  }

  // Netscape rows are tab-separated by definition. Without a single tab the
  // file is some third format we cannot guess at, and saying so beats
  // reporting every line as a broken cookie.
  if (!trimmed.includes("\t")) {
    return { ok: false, reason: "unrecognised-format" };
  }

  const { cookies, skipped } = parseNetscape(text);
  return cookies.length === 0
    ? { ok: false, reason: "no-valid-cookies" }
    : { ok: true, format: "netscape", cookies, skipped };
}
