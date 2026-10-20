/**
 * What this suite can and cannot establish.
 *
 * It establishes the *shape* of the demo: that one `Set-Cookie` header goes out
 * per variant with the exact attributes claimed, that an incoming `Cookie`
 * header is read correctly, and that no cookie value ever reaches a response
 * body. All of that is pure string work and deserves a test.
 *
 * It establishes nothing whatsoever about browser behaviour, and must never be
 * read as doing so. These tests run under happy-dom, which has no cookie jar,
 * no real origin, and no notion of a "site" — the three things `SameSite` is
 * defined in terms of. Whether a browser actually withholds the Lax variant
 * inside a cross-site frame is provable only by loading the page in a real
 * browser, which is the entire reason the page exists. A green run here means
 * the demo is wired up, not that the diagnosis it illustrates is confirmed.
 */

import { describe, expect, test } from "bun:test";

import {
  COOKIE_DEMO_PAGE_PATH,
  COOKIE_DEMO_READ_PATH,
  COOKIE_DEMO_SET_PATH,
  cookieDemoSetHeaders,
  handleCookieDemoPage,
  handleCookieDemoRead,
  handleCookieDemoSet,
} from "../../src/server/cookie.demo.ts";
import {
  COOKIE_DEMO_PATH_SCOPE,
  COOKIE_DEMO_VARIANTS,
  cookieNamesIn,
  setCookieHeaderFor,
  variantsSentBack,
} from "../../src/server/cookie.variants.ts";

/**
 * A standalone `Headers` is the only carrier of a `Cookie` header available
 * here: happy-dom applies the browser's forbidden-header rule to `Request`, so
 * a cookie passed through a `Request` init comes back null. The `Headers`
 * itself is the real implementation doing real parsing — nothing is faked but
 * the envelope it travels in.
 */
function requestCarrying(header: string | null) {
  return { headers: new Headers(header === null ? {} : { cookie: header }) };
}

function readWithCookieHeader(header: string | null): Promise<unknown> {
  return handleCookieDemoRead(requestCarrying(header)).json();
}

/** Attributes only: the cookie *name* also contains the word "samesite". */
function attributesOf(setCookieHeader: string): string {
  return setCookieHeader.split(";").slice(1).join(";").toLowerCase();
}

function variantByIdOrThrow(id: string) {
  const variant = COOKIE_DEMO_VARIANTS.find((candidate) => candidate.id === id);
  if (variant === undefined) throw new Error(`no variant "${id}"`);
  return variant;
}

describe("the variant table is the set of cases worth comparing", () => {
  test("every SameSite value a browser recognises is covered", () => {
    expect(COOKIE_DEMO_VARIANTS.map((variant) => variant.id)).toEqual([
      "unspecified",
      "lax",
      "strict",
      "none-secure",
      "none-secure-partitioned",
    ]);
  });

  test("a cookie name says which variant it is, so results need no legend", () => {
    for (const variant of COOKIE_DEMO_VARIANTS) {
      const suffix = variant.id.replaceAll("-", "_");
      expect(variant.cookieName).toContain(suffix);
    }
  });

  test("ids and names are unique, or two rows would collide in one jar", () => {
    const ids = new Set(COOKIE_DEMO_VARIANTS.map((variant) => variant.id));
    const names = new Set(COOKIE_DEMO_VARIANTS.map((variant) => variant.cookieName));
    expect(ids.size).toBe(COOKIE_DEMO_VARIANTS.length);
    expect(names.size).toBe(COOKIE_DEMO_VARIANTS.length);
  });

  test("every variant explains itself, for the page's second column", () => {
    for (const variant of COOKIE_DEMO_VARIANTS) {
      expect(variant.expectation.length).toBeGreaterThan(20);
    }
  });
});

describe("setCookieHeaderFor emits exactly the attributes claimed", () => {
  test("the unspecified variant carries no SameSite at all", () => {
    const header = setCookieHeaderFor(variantByIdOrThrow("unspecified"));
    expect(attributesOf(header)).not.toContain("samesite");
    expect(header).toContain(`Path=${COOKIE_DEMO_PATH_SCOPE}`);
  });

  test.each([
    ["lax", "SameSite=Lax"],
    ["strict", "SameSite=Strict"],
    ["none-secure", "SameSite=None; Secure"],
    ["none-secure-partitioned", "SameSite=None; Secure; Partitioned"],
  ])("%s ends with %s", (id, attributes) => {
    expect(setCookieHeaderFor(variantByIdOrThrow(id))).toEndWith(attributes);
  });

  test("SameSite=None never ships without Secure, which browsers would refuse", () => {
    for (const variant of COOKIE_DEMO_VARIANTS) {
      const attributes = attributesOf(setCookieHeaderFor(variant));
      if (attributes.includes("samesite=none")) expect(attributes).toContain("secure");
    }
  });

  test("Partitioned never ships without Secure either, per CHIPS", () => {
    for (const variant of COOKIE_DEMO_VARIANTS) {
      const attributes = attributesOf(setCookieHeaderFor(variant));
      if (attributes.includes("partitioned")) expect(attributes).toContain("secure");
    }
  });

  test("every cookie is scoped to the demo, never to the whole wall", () => {
    for (const variant of COOKIE_DEMO_VARIANTS) {
      expect(setCookieHeaderFor(variant)).toContain(`Path=${COOKIE_DEMO_PATH_SCOPE}`);
      expect(setCookieHeaderFor(variant)).not.toContain("Path=/;");
    }
  });

  test("every value announces itself as an inert demo and expires", () => {
    for (const variant of COOKIE_DEMO_VARIANTS) {
      const header = setCookieHeaderFor(variant);
      const value = header.slice(header.indexOf("=") + 1, header.indexOf(";"));
      expect(value).toContain("demo");
      expect(value).toContain("not-a-session");
      expect(header).toContain("Max-Age=");
    }
  });
});

describe("cookieNamesIn reads an incoming Cookie header", () => {
  test("no header at all is no cookies, not a crash", () => {
    expect([...cookieNamesIn(null)]).toEqual([]);
    expect([...cookieNamesIn("")]).toEqual([]);
  });

  test("names come back trimmed, values are dropped entirely", () => {
    expect([...cookieNamesIn("a=1;  b=2 ; c=3")]).toEqual(["a", "b", "c"]);
  });

  test("a comma inside a value is never a separator", () => {
    // `;` is the only separator the Cookie header uses. Splitting on `,` would
    // invent a cookie called "09 Jun 2027 10" out of one ordinary value.
    expect([...cookieNamesIn("when=Wed, 09 Jun 2027 10:18:14 GMT; b=2")]).toEqual([
      "when",
      "b",
    ]);
  });

  test("a segment with no '=' is skipped rather than guessed at", () => {
    expect([...cookieNamesIn("bare; a=1")]).toEqual(["a"]);
  });

  test("an empty name is not a cookie", () => {
    expect([...cookieNamesIn("=orphan; a=1")]).toEqual(["a"]);
  });

  test("a value containing '=' keeps only the name before the first one", () => {
    expect([...cookieNamesIn("token=aGk=padding=")]).toEqual(["token"]);
  });
});

describe("variantsSentBack is the measurement at the heart of the demo", () => {
  test("nothing sent back is the cross-site-frame outcome being demonstrated", () => {
    expect(variantsSentBack(null)).toEqual([]);
  });

  test("only the None variants surviving is the shape of the real bug", () => {
    const header = COOKIE_DEMO_VARIANTS.filter((variant) =>
      variant.id.startsWith("none-"),
    )
      .map((variant) => `${variant.cookieName}=whatever`)
      .join("; ");
    expect(variantsSentBack(header)).toEqual([
      "none-secure",
      "none-secure-partitioned",
    ]);
  });

  test("all five surviving is the top-level baseline", () => {
    const header = COOKIE_DEMO_VARIANTS.map(
      (variant) => `${variant.cookieName}=whatever`,
    ).join("; ");
    expect(variantsSentBack(header)).toEqual(
      COOKIE_DEMO_VARIANTS.map((variant) => variant.id),
    );
  });

  test("unrelated cookies on the same loopback host are ignored", () => {
    expect(variantsSentBack("some_other_app_session=xyz; theme=dark")).toEqual([]);
  });

  test("results keep declaration order, not the browser's header order", () => {
    const reversed = [...COOKIE_DEMO_VARIANTS]
      .reverse()
      .map((variant) => `${variant.cookieName}=whatever`)
      .join("; ");
    expect(variantsSentBack(reversed)).toEqual(
      COOKIE_DEMO_VARIANTS.map((variant) => variant.id),
    );
  });
});

describe("handleCookieDemoSet", () => {
  // Read off `cookieDemoSetHeaders`, not the `Response`: happy-dom applies the
  // browser's response header guard and strips every Set-Cookie from a
  // constructed Response, so this is the last observable point. Real Bun does
  // send them — that part is only ever provable in a browser.
  test("sends one Set-Cookie header per variant, never a joined one", () => {
    const cookies = cookieDemoSetHeaders().getSetCookie();
    expect(cookies).toHaveLength(COOKIE_DEMO_VARIANTS.length);
    expect(cookies).toEqual(COOKIE_DEMO_VARIANTS.map(setCookieHeaderFor));
  });

  test("is never cached, or it would hand back a stale jar", () => {
    expect(cookieDemoSetHeaders().get("cache-control")).toContain("no-store");
    expect(handleCookieDemoSet().headers.get("cache-control")).toContain("no-store");
  });

  test("reports what it attempted, so the page can label every row", async () => {
    const body = (await handleCookieDemoSet().json()) as {
      attempted: { id: string; cookieName: string }[];
    };
    expect(body.attempted.map((entry) => entry.id)).toEqual(
      COOKIE_DEMO_VARIANTS.map((variant) => variant.id),
    );
  });
});

describe("handleCookieDemoRead", () => {
  test("reports only the variants present in the request", async () => {
    const lax = variantByIdOrThrow("lax");
    const none = variantByIdOrThrow("none-secure");
    const body = (await readWithCookieHeader(
      `${lax.cookieName}=x; ${none.cookieName}=y`,
    )) as { sentBack: string[] };
    expect(body.sentBack).toEqual(["lax", "none-secure"]);
  });

  test("a request with no cookies at all answers an empty list", async () => {
    expect(await readWithCookieHeader(null)).toEqual({ sentBack: [] });
  });

  test("never echoes a cookie value or an unrelated cookie name", async () => {
    const lax = variantByIdOrThrow("lax");
    const response = handleCookieDemoRead(
      requestCarrying(`${lax.cookieName}=secret-value-here; other_app_sid=abc123`),
    );
    const text = await response.text();
    expect(text).toContain("lax");
    expect(text).not.toContain("secret-value-here");
    expect(text).not.toContain("other_app_sid");
    expect(text).not.toContain("abc123");
  });

  test("is never cached, or the measurement would be a replay", () => {
    const response = handleCookieDemoRead(requestCarrying(null));
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});

describe("handleCookieDemoPage", () => {
  test("serves HTML the wall is allowed to frame", () => {
    const response = handleCookieDemoPage();
    expect(response.headers.get("content-type")).toContain("text/html");
    // Framability is the whole exercise: a refusal header here would make the
    // demo unable to demonstrate the thing it exists to demonstrate.
    expect(response.headers.get("x-frame-options")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  test("embeds the real endpoint paths, so the page cannot drift from the routes", async () => {
    const html = await handleCookieDemoPage().text();
    expect(html).toContain(JSON.stringify(COOKIE_DEMO_SET_PATH));
    expect(html).toContain(JSON.stringify(COOKIE_DEMO_READ_PATH));
  });

  test("explains the loopback trick, since a same-host frame proves nothing", async () => {
    const html = await handleCookieDemoPage().text();
    expect(html).toContain("localhost");
    expect(html).toContain("127.0.0.1");
  });

  test("the three paths are distinct and all live under the cookie scope", () => {
    const paths = [COOKIE_DEMO_PAGE_PATH, COOKIE_DEMO_SET_PATH, COOKIE_DEMO_READ_PATH];
    expect(new Set(paths).size).toBe(3);
    for (const path of paths) expect(path.startsWith(COOKIE_DEMO_PATH_SCOPE)).toBe(true);
  });
});
