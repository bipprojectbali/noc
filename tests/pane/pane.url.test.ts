import { describe, expect, test } from "bun:test";

import {
  normalizePaneUrl,
  siteShortLabel,
  siteShortLabels,
} from "../../src/pane/pane.url.ts";

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

describe("siteShortLabel", () => {
  const cases: [string, string][] = [
    ["https://ravenstone.wibudev.com/", "ravenstone"],
    ["https://contohweb.com/", "contohweb"],
    ["https://contoh.co.id/", "contoh"],
    ["https://app.contoh.co.id/", "app"],
    ["https://www.contohweb.com/", "contohweb"],
    ["https://www.ravenstone.wibudev.com/", "ravenstone"],
    ["https://grafana.ops.wibudev.com/", "grafana"],
    ["http://192.168.1.10:3000/x", "192.168.1.10:3000"],
    ["http://localhost:3000", "localhost:3000"],
    ["http://[::1]:8080", "[::1]:8080"],
    ["https://RavenStone.WibuDev.com./", "ravenstone"],
    ["https://ravenstone.wibudev.com:8443/", "ravenstone"],
    ["not a url", "not a url"],
    ["https://co.id/", "co.id"],
  ];
  for (const [url, label] of cases) {
    test(`${url} → ${label}`, () => {
      expect(siteShortLabel(url)).toBe(label);
    });
  }
});

describe("siteShortLabels", () => {
  test("a short name two hosts share falls back to both full hosts", () => {
    expect(siteShortLabels(["https://api.a.com/", "https://api.b.com/"])).toEqual([
      "api.a.com",
      "api.b.com",
    ]);
  });

  test("distinct short names stay short", () => {
    expect(
      siteShortLabels(["https://ravenstone.wibudev.com/", "https://contohweb.com/"]),
    ).toEqual(["ravenstone", "contohweb"]);
  });

  test("the same url twice is one host, so both stay short", () => {
    expect(siteShortLabels(["https://contohweb.com/a", "https://contohweb.com/b"])).toEqual(
      ["contohweb", "contohweb"],
    );
  });

  test("localhost on two ports is already distinct", () => {
    expect(siteShortLabels(["http://localhost:3000/", "http://localhost:9090/"])).toEqual([
      "localhost:3000",
      "localhost:9090",
    ]);
  });
});
