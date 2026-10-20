import { describe, expect, test } from "bun:test";

import {
  SITE_LABEL_PREFIX,
  proxySiteUrl,
  siteLabel,
  siteLabelOf,
  siteOriginOf,
  wallProxyBase,
} from "../../src/proxy/proxy.label.ts";

const WALL = { protocol: "http:", hostname: "wall.noc.localhost", port: "7788" };

describe("siteOriginOf", () => {
  test("canonicalises so one site cannot end up with two labels", () => {
    expect(siteOriginOf("http://Grafana.Internal:80/d/abc?x=1#y")).toBe(
      "http://grafana.internal",
    );
    expect(siteOriginOf("https://grafana.internal:443/")).toBe(
      "https://grafana.internal",
    );
  });

  test("refuses anything that cannot be proxied", () => {
    expect(siteOriginOf("about:blank")).toBeNull();
    expect(siteOriginOf("file:///etc/hosts")).toBeNull();
    expect(siteOriginOf("not a url")).toBeNull();
  });
});

describe("siteLabel", () => {
  test("is stable for the same origin", () => {
    // The whole feature rests on this: a label that changed between two runs
    // would send the user to a hostname holding none of his cookies.
    const first = siteLabel("https://grafana.internal");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(siteLabel("https://grafana.internal")).toBe(first);
    }
  });

  test("separates origins that differ only in scheme or port", () => {
    const labels = new Set([
      siteLabel("http://grafana.internal"),
      siteLabel("https://grafana.internal"),
      siteLabel("http://grafana.internal:8080"),
      siteLabel("http://grafana.internal:9090"),
    ]);
    expect(labels.size).toBe(4);
  });

  test("is a legal DNS label of at most 63 characters", () => {
    const long = `https://${"dashboard-".repeat(12)}internal.example.com`;
    for (const url of [
      "https://grafana.internal",
      "http://127.0.0.1:3000",
      "https://a.b.c.d.e.f.example.com",
      long,
    ]) {
      const label = siteLabel(siteOriginOf(url) ?? "");
      expect(label.length).toBeLessThanOrEqual(63);
      expect(label).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
      expect(label.startsWith(SITE_LABEL_PREFIX)).toBe(true);
    }
  });

  test("keeps something readable from the hostname", () => {
    expect(siteLabel("https://grafana.internal")).toContain("grafana-internal");
  });
});

describe("wallProxyBase", () => {
  test("accepts a *.localhost host with a registrable domain to share", () => {
    expect(wallProxyBase("wall.noc.localhost")).toBe("noc.localhost");
    expect(wallProxyBase("a.b.c.noc.localhost")).toBe("b.c.noc.localhost");
  });

  test("rejects every host measured not to be same-site with its siblings", () => {
    // Each of these was tried against a real browser and sent back only
    // `SameSite=None` cookies, which is the failure this feature cures.
    expect(wallProxyBase("127.0.0.1")).toBeNull();
    expect(wallProxyBase("localhost")).toBeNull();
    expect(wallProxyBase("wall.localhost")).toBeNull();
    expect(wallProxyBase("wall.noc.example.com")).toBeNull();
    expect(wallProxyBase("")).toBeNull();
  });
});

describe("siteLabelOf", () => {
  test("recognises a label this wall minted", () => {
    const label = siteLabel("https://grafana.internal");
    expect(siteLabelOf(`${label}.noc.localhost`)).toBe(label);
    expect(siteLabelOf(`${label.toUpperCase()}.noc.localhost`)).toBe(label);
  });

  test("leaves the wall's own host and anything else to the wall", () => {
    expect(siteLabelOf("wall.noc.localhost")).toBeNull();
    expect(siteLabelOf("127.0.0.1")).toBeNull();
    expect(siteLabelOf("s-.noc.localhost")).toBeNull();
    expect(siteLabelOf("s-anything.localhost")).toBeNull();
  });
});

describe("proxySiteUrl", () => {
  test("moves only the authority, and takes the wall's scheme and port", () => {
    const framed = proxySiteUrl("https://grafana.internal/d/abc?from=now-6h#panel", WALL);
    const label = siteLabel("https://grafana.internal");
    // The wall's scheme, not the site's: same-site compares scheme too, so an
    // https frame under an http wall would be cross-site all over again.
    expect(framed).toBe(
      `http://${label}.noc.localhost:7788/d/abc?from=now-6h#panel`,
    );
  });

  test("round-trips through the server's own host parsing", () => {
    const framed = proxySiteUrl("https://grafana.internal/", WALL);
    const hostname = new URL(framed ?? "").hostname;
    expect(siteLabelOf(hostname)).toBe(siteLabel("https://grafana.internal"));
  });

  test("does not read a leading // in the path as another host", () => {
    const framed = proxySiteUrl("https://grafana.internal//evil.example.com/x", WALL);
    expect(new URL(framed ?? "").hostname.endsWith(".noc.localhost")).toBe(true);
    expect(new URL(framed ?? "").pathname).toBe("//evil.example.com/x");
  });

  test("declines on a wall host where it cannot work", () => {
    const plain = { protocol: "http:", hostname: "127.0.0.1", port: "7788" };
    expect(proxySiteUrl("https://grafana.internal/", plain)).toBeNull();
  });

  test("declines addresses it cannot proxy", () => {
    expect(proxySiteUrl("about:blank", WALL)).toBeNull();
  });
});
