/**
 * The shape a cookie must have before it can be planted in a webview store.
 *
 * It exists as its own contract because the thing that reads an export file and
 * the thing that installs a cookie must not know each other: the parser is pure
 * and runs anywhere, the installer is native and runs only in the shell. This
 * type is the whole of what crosses between them, so neither side has to carry
 * the quirks of a browser extension's export format.
 */

export type SessionCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  /** Unix seconds. `null` is a session cookie, gone when the store is cleared. */
  expires: number | null;
};

/**
 * Why an export file yielded nothing.
 *
 * These are codes, not prose, because the message a user should read differs
 * per surface and is not the parser's business:
 * - `empty-file` — nothing but whitespace; the user probably exported the wrong tab.
 * - `unrecognised-format` — neither Netscape `cookies.txt` nor a JSON array.
 * - `no-valid-cookies` — the format was understood but every entry was malformed.
 */
export type SessionParseFailure =
  | "empty-file"
  | "unrecognised-format"
  | "no-valid-cookies";

/** Which of the two supported export shapes the text turned out to be. */
export type SessionCookieFormat = "netscape" | "json";

export type SessionParseResult =
  | {
      ok: true;
      format: SessionCookieFormat;
      cookies: SessionCookie[];
      /**
       * Entries that were understood as cookie-shaped but dropped. Surfaced so
       * an import can say "182 imported, 3 skipped" instead of silently losing
       * rows — a partial import that looks total is the worse failure.
       */
      skipped: number;
    }
  | { ok: false; reason: SessionParseFailure };
