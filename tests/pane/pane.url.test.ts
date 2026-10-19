import { describe, expect, test } from "bun:test";

import { normalizePaneUrl } from "../../src/pane/pane.url.ts";

describe("normalizePaneUrl accepts", () => {
  test("a full https url, normalized", () => {
    expect(normalizePaneUrl("https://example.com")).toEqual({
      ok: true,
      url: "https://example.com/",
    });
  });

  test("a bare host by assuming https", () => {
    expect(normalizePaneUrl("info.cern.ch")).toEqual({
      ok: true,
      url: "https://info.cern.ch/",
    });
  });

  test("plain http, which internal dashboards often still use", () => {
    expect(normalizePaneUrl("http://127.0.0.1:3000/d/abc")).toEqual({
      ok: true,
      url: "http://127.0.0.1:3000/d/abc",
    });
  });

  test("surrounding whitespace from a paste", () => {
    expect(normalizePaneUrl("  https://www.wikipedia.org/  ")).toEqual({
      ok: true,
      url: "https://www.wikipedia.org/",
    });
  });

  test("a url with query and fragment intact", () => {
    expect(normalizePaneUrl("https://example.com/a?b=1#c")).toEqual({
      ok: true,
      url: "https://example.com/a?b=1#c",
    });
  });
});

describe("normalizePaneUrl rejects", () => {
  test("an empty input", () => {
    expect(normalizePaneUrl("   ")).toEqual({ ok: false, reason: "Enter a URL" });
  });

  test("javascript:, which would execute in the wall's own context", () => {
    const result = normalizePaneUrl("javascript:alert(1)");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("Only http and https");
  });

  test("data:, for the same reason", () => {
    expect(normalizePaneUrl("data:text/html,<h1>x</h1>").ok).toBe(false);
  });

  test("file:, which would read the host machine", () => {
    expect(normalizePaneUrl("file:///etc/passwd").ok).toBe(false);
  });

  test("a scheme with no host", () => {
    expect(normalizePaneUrl("https://").ok).toBe(false);
  });

  test("text that is not a url at all", () => {
    expect(normalizePaneUrl("not a url").ok).toBe(false);
  });
});
