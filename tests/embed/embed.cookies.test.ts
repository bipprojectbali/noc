import { describe, expect, test } from "bun:test";

import { classifyFrameCookies } from "../../src/embed/embed.cookies.ts";
import {
  EXPIRES_WITH_COMMA,
  LAX,
  LOWERCASE_ATTRIBUTES,
  MIXED,
  NONE_WITHOUT_SECURE,
  NO_SAMESITE,
  SAFE_IN_FRAME,
  STRICT,
} from "../fixtures/set-cookie-headers.ts";

describe("classifyFrameCookies says which cookies a frame will not send", () => {
  test("SameSite=None with Secure is sent in a frame", () => {
    expect(classifyFrameCookies(SAFE_IN_FRAME)).toEqual({ verdict: "sendable" });
  });

  test("attribute case and spacing do not change the answer", () => {
    expect(classifyFrameCookies(LOWERCASE_ATTRIBUTES)).toEqual({
      verdict: "sendable",
    });
  });

  test("SameSite=None without Secure fails, and for its own reason", () => {
    expect(classifyFrameCookies(NONE_WITHOUT_SECURE)).toEqual({
      verdict: "blocked",
      blocked: [{ name: "sid", problem: "none-without-secure" }],
    });
  });

  test("SameSite=Lax fails", () => {
    expect(classifyFrameCookies(LAX)).toEqual({
      verdict: "blocked",
      blocked: [{ name: "sid", problem: "lax" }],
    });
  });

  test("SameSite=Strict fails", () => {
    expect(classifyFrameCookies(STRICT)).toEqual({
      verdict: "blocked",
      blocked: [{ name: "sid", problem: "strict" }],
    });
  });

  test("a missing SameSite attribute fails, since the default is Lax", () => {
    expect(classifyFrameCookies(NO_SAMESITE)).toEqual({
      verdict: "blocked",
      blocked: [{ name: "sid", problem: "no-samesite" }],
    });
  });

  test("an unrecognised SameSite value lands on the default, not on silence", () => {
    expect(classifyFrameCookies(["sid=x; SameSite=Wat"])).toEqual({
      verdict: "blocked",
      blocked: [{ name: "sid", problem: "no-samesite" }],
    });
  });

  test("a comma inside Expires does not split one cookie into two", () => {
    expect(classifyFrameCookies(EXPIRES_WITH_COMMA)).toEqual({
      verdict: "blocked",
      blocked: [{ name: "sid", problem: "lax" }],
    });
  });

  test("names only the cookies that fail, not the ones beside them", () => {
    expect(classifyFrameCookies(MIXED)).toEqual({
      verdict: "blocked",
      blocked: [{ name: "sid", problem: "no-samesite" }],
    });
  });

  test("no Set-Cookie at all is unknown, never safe", () => {
    expect(classifyFrameCookies([])).toEqual({ verdict: "unknown" });
  });

  test("a header with no name=value pair is not counted as a cookie", () => {
    expect(classifyFrameCookies(["; Path=/", "=x; SameSite=Lax"])).toEqual({
      verdict: "unknown",
    });
  });

  /**
   * The value is a credential. It is never returned, never formatted into a
   * reason, and this is the test that fails if it ever starts being.
   */
  test("a cookie value never appears in the decision", () => {
    const decision = classifyFrameCookies([
      "sid=super-secret-session-token; SameSite=Lax",
    ]);
    expect(JSON.stringify(decision)).not.toContain("super-secret");
  });
});
