import { describe, expect, test } from "bun:test";

import {
  proxyRequestHeaders,
  proxyResponseHeaders,
  rewriteLocation,
  stripCapturePolicy,
  stripCookieDomain,
  stripFrameAncestors,
} from "../../src/proxy/proxy.headers.ts";

const UPSTREAM = "https://grafana.internal";
const PROXY = "http://s-grafana-internal-abc123.noc.localhost:7788";

// No real credential anywhere in here: these are placeholders shaped like
// cookies, never values taken from a browser.
const SESSION = "grafana_session=placeholder-not-a-real-value";

describe("stripCookieDomain", () => {
  test("drops Domain so the cookie is host-only", () => {
    expect(stripCookieDomain(`${SESSION}; Domain=.grafana.internal; Path=/`)).toBe(
      `${SESSION}; Path=/`,
    );
  });

  test("keeps Secure, which is what makes the cookie work at all here", () => {
    // `*.localhost` is potentially-trustworthy, so a Secure cookie set over
    // plain http is stored and sent. Stripping the attribute is the single edit
    // that would break a site that sets it.
    const stripped = stripCookieDomain(
      `${SESSION}; Domain=grafana.internal; Path=/; Secure; HttpOnly; SameSite=Lax`,
    );
    expect(stripped).toContain("Secure");
    expect(stripped).toContain("HttpOnly");
    expect(stripped).toContain("SameSite=Lax");
    expect(stripped.toLowerCase()).not.toContain("domain=");
  });

  test("is case- and space-insensitive about the attribute", () => {
    expect(stripCookieDomain(`a=1;   DOMAIN=.example.com  ; Path=/`)).toBe(
      "a=1; Path=/",
    );
  });

  test("leaves a cookie that never had a Domain alone", () => {
    expect(stripCookieDomain(`${SESSION}; Path=/; Secure`)).toBe(
      `${SESSION}; Path=/; Secure`,
    );
  });
});

describe("cookie isolation between sites", () => {
  test("no site can scope a cookie to the shared registrable domain", () => {
    // Every pane now lives under one registrable domain, so a cookie left
    // scoped to a parent would be handed to every other pane on the wall. This
    // is the test that says site A cannot read site B's session.
    const attempts = [
      `${SESSION}; Domain=.noc.localhost; Path=/`,
      `${SESSION}; Domain=noc.localhost; Path=/`,
      `${SESSION}; Domain=.localhost; Path=/`,
      `${SESSION}; Domain=s-other-site.noc.localhost; Path=/`,
    ];
    for (const attempt of attempts) {
      expect(stripCookieDomain(attempt).toLowerCase()).not.toContain("domain=");
    }
  });

  test("the whole response path strips it too, cookie by cookie", () => {
    const upstream = new Headers();
    upstream.append("set-cookie", `${SESSION}; Domain=.noc.localhost; Path=/; Secure`);
    upstream.append("set-cookie", "csrf=placeholder; Domain=.grafana.internal; Path=/");

    const cookies = proxyResponseHeaders(upstream, UPSTREAM, PROXY).getSetCookie();
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) {
      expect(cookie.toLowerCase()).not.toContain("domain=");
    }
    expect(cookies[0]).toContain("Secure");
  });
});

describe("stripFrameAncestors", () => {
  test("removes only the directive that blocks framing", () => {
    expect(
      stripFrameAncestors("default-src 'self'; frame-ancestors 'none'; img-src *"),
    ).toBe("default-src 'self'; img-src *");
  });

  test("drops the header when that was the whole policy", () => {
    expect(stripFrameAncestors("frame-ancestors 'self'")).toBeNull();
  });

  test("does not confuse frame-src with frame-ancestors", () => {
    expect(stripFrameAncestors("frame-src 'self'")).toBe("frame-src 'self'");
  });
});

describe("stripCapturePolicy", () => {
  test("removes only the two features the pane already delegated", () => {
    // Measured in Chrome, not assumed: with `camera=()` standing, a pane reports
    // `featurePolicy.allowsFeature("camera") === false` and getUserMedia fails
    // with `NotAllowedError: Permission denied`.
    expect(
      stripCapturePolicy("geolocation=(), camera=(), microphone=(), usb=()", ","),
    ).toBe("geolocation=(), usb=()");
  });

  test("leaves a policy that never mentioned capture alone", () => {
    expect(stripCapturePolicy("geolocation=(self)", ",")).toBe("geolocation=(self)");
  });

  test("drops the header when capture was the whole policy", () => {
    // An empty policy header is not the same as no policy header.
    expect(stripCapturePolicy("camera=(), microphone=()", ",")).toBeNull();
  });

  test("is case-insensitive about the feature name", () => {
    expect(stripCapturePolicy("Camera=(), fullscreen=*", ",")).toBe("fullscreen=*");
  });

  test("handles the superseded Feature-Policy spelling and its separator", () => {
    expect(stripCapturePolicy("camera 'none'; geolocation 'self'", ";")).toBe(
      "geolocation 'self'",
    );
  });

  test("does not mistake a longer feature name for one of ours", () => {
    expect(stripCapturePolicy("camera-something=(), display-capture=()", ",")).toBe(
      "camera-something=(), display-capture=()",
    );
  });
});

describe("rewriteLocation", () => {
  test("keeps a redirect inside the proxy host", () => {
    // A login flow is a chain of redirects; released to the real origin even
    // once, the browser leaves the proxy subdomain and is cross-site again.
    expect(rewriteLocation(`${UPSTREAM}/login?next=%2Fd`, UPSTREAM, PROXY)).toBe(
      `${PROXY}/login?next=%2Fd`,
    );
  });

  test("leaves a relative redirect alone", () => {
    expect(rewriteLocation("/login", UPSTREAM, PROXY)).toBe("/login");
  });

  test("does not proxy a third party nobody put on the wall", () => {
    // A known limit, not an oversight: such a flow leaves the proxy.
    expect(rewriteLocation("https://sso.example.com/auth", UPSTREAM, PROXY)).toBe(
      "https://sso.example.com/auth",
    );
  });
});

describe("proxyRequestHeaders", () => {
  test("forwards the cookie untouched", () => {
    const incoming = new Headers({ cookie: SESSION });
    expect(proxyRequestHeaders(incoming, UPSTREAM, PROXY).get("cookie")).toBe(SESSION);
  });

  test("rewrites Origin and Referer so CSRF checks still pass", () => {
    const incoming = new Headers({
      origin: PROXY,
      referer: `${PROXY}/d/abc?x=1`,
    });
    const headers = proxyRequestHeaders(incoming, UPSTREAM, PROXY);
    expect(headers.get("origin")).toBe(UPSTREAM);
    expect(headers.get("referer")).toBe(`${UPSTREAM}/d/abc?x=1`);
  });

  test("leaves an Origin that is not ours alone", () => {
    const incoming = new Headers({ origin: "https://elsewhere.example.com" });
    expect(proxyRequestHeaders(incoming, UPSTREAM, PROXY).get("origin")).toBe(
      "https://elsewhere.example.com",
    );
  });

  test("drops hop-by-hop headers and lets fetch pick an encoding", () => {
    const incoming = new Headers({
      connection: "keep-alive",
      "transfer-encoding": "chunked",
      upgrade: "h2c",
      host: "s-grafana.noc.localhost:7788",
      "accept-encoding": "gzip, br, zstd",
      "content-length": "12",
    });
    const headers = proxyRequestHeaders(incoming, UPSTREAM, PROXY);
    for (const name of [
      "connection",
      "transfer-encoding",
      "upgrade",
      "host",
      "accept-encoding",
      "content-length",
    ]) {
      expect(headers.get(name)).toBeNull();
    }
  });
});

describe("proxyResponseHeaders", () => {
  test("drops the framing refusals", () => {
    const upstream = new Headers({
      "x-frame-options": "SAMEORIGIN",
      "content-security-policy": "frame-ancestors 'none'; default-src 'self'",
    });
    const headers = proxyResponseHeaders(upstream, UPSTREAM, PROXY);
    expect(headers.get("x-frame-options")).toBeNull();
    expect(headers.get("content-security-policy")).toBe("default-src 'self'");
  });

  test("clears the site's own veto on camera and microphone", () => {
    const upstream = new Headers({
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "feature-policy": "camera 'none'; fullscreen 'self'",
    });
    const headers = proxyResponseHeaders(upstream, UPSTREAM, PROXY);
    expect(headers.get("permissions-policy")).toBe("geolocation=()");
    expect(headers.get("feature-policy")).toBe("fullscreen 'self'");
  });

  test("removes the header outright when nothing but capture was in it", () => {
    const upstream = new Headers({ "permissions-policy": "camera=()" });
    expect(
      proxyResponseHeaders(upstream, UPSTREAM, PROXY).get("permissions-policy"),
    ).toBeNull();
  });

  test("drops content-encoding and content-length, which fetch has invalidated", () => {
    // fetch decompresses the body but leaves both headers describing the
    // compressed bytes; forwarding them makes the browser decode twice.
    const upstream = new Headers({
      "content-encoding": "gzip",
      "content-length": "27",
      "content-type": "text/html",
    });
    const headers = proxyResponseHeaders(upstream, UPSTREAM, PROXY);
    expect(headers.get("content-encoding")).toBeNull();
    expect(headers.get("content-length")).toBeNull();
    expect(headers.get("content-type")).toBe("text/html");
  });
});
