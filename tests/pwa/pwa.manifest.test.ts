/**
 * Installability has no error channel: a browser that dislikes the manifest
 * simply never offers to install, and nothing in the page says why. So the
 * things Chromium silently requires are asserted here instead of discovered on
 * a monitor — a name, a start URL, a display mode, and icons at both 192 and
 * 512. None of this proves the wall installs; it proves the document cannot be
 * missing a field while looking fine.
 *
 * The other half is that the manifest and the routes agree. A manifest naming
 * an icon path no route answers fails the same way: quietly.
 */

import { describe, expect, test } from "bun:test";

import { pwaAssetRoutes } from "../../src/pwa/pwa.assets.ts";
import {
  PWA_ICON_192_PATH,
  PWA_ICON_512_PATH,
  WALL_MANIFEST,
  WEB_MANIFEST_PATH,
} from "../../src/pwa/pwa.manifest.ts";

describe("the fields Chromium requires", () => {
  test("a name, a start URL and a display mode", () => {
    expect(WALL_MANIFEST.name).not.toBe("");
    expect(WALL_MANIFEST.short_name).not.toBe("");
    expect(WALL_MANIFEST.start_url).toBe("/");
    expect(WALL_MANIFEST.display).toBe("standalone");
  });

  test("both icon sizes, because one of the two is not enough", () => {
    const sizes = WALL_MANIFEST.icons
      .filter((icon) => icon.purpose === "any")
      .map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  test("a maskable icon as well, so Android does not letterbox the artwork", () => {
    const maskable = WALL_MANIFEST.icons.filter((icon) => icon.purpose === "maskable");
    expect(maskable.length).toBeGreaterThan(0);
    expect(maskable[0]?.sizes).toBe("512x512");
  });
});

describe("display_override", () => {
  test("asks for the least chrome first and degrades, never demanding it", () => {
    // The order is the whole contract: a browser takes the first mode it knows,
    // and `display` below the list is what answers a browser that knows none.
    expect(WALL_MANIFEST.display_override).toEqual([
      "window-controls-overlay",
      "fullscreen",
      "minimal-ui",
    ]);
    expect(WALL_MANIFEST.display).toBe("standalone");
  });
});

describe("the manifest and the routes", () => {
  test("every icon it names is a path something answers", () => {
    for (const icon of WALL_MANIFEST.icons) {
      expect(Object.keys(pwaAssetRoutes)).toContain(icon.src);
    }
  });

  test("the manifest itself is served, and from under /pwa/", () => {
    expect(Object.keys(pwaAssetRoutes)).toContain(WEB_MANIFEST_PATH);
    // Grouped under one prefix on purpose: the wall's root namespace belongs to
    // the router, and these have to be real routes to beat the catch-all.
    for (const path of Object.keys(pwaAssetRoutes)) {
      expect(path.startsWith("/pwa/")).toBe(true);
    }
  });

  test("the two sizes the head also names are among them", () => {
    expect(Object.keys(pwaAssetRoutes)).toContain(PWA_ICON_192_PATH);
    expect(Object.keys(pwaAssetRoutes)).toContain(PWA_ICON_512_PATH);
  });
});
