/**
 * The icons are imported with `type: "file"` so that `bun build --compile`
 * embeds them, and the failure mode of that mechanism is a path that resolves
 * to nothing: `Bun.file` is lazy, so a handler built on a missing asset returns
 * a perfectly well-formed response whose body is empty. These tests read the
 * bytes.
 *
 * They read them through `pwaIconFiles` rather than through a handler's
 * `Response`, and that is forced: `bunfig.toml` preloads happy-dom, whose
 * global `Response` replaces Bun's and turns a `Bun.file` body into the string
 * `[object Blob]`. So the icon handlers' own bodies are only observable outside
 * `bun test` — which is where curl saw them, and what a browser sees.
 *
 * Running from source is all this can prove. Whether the same imports survive
 * into a compiled binary is the binary build's to show — the mechanism is the
 * same one Bun documents for both, but "documented" is not "seen".
 */

import { describe, expect, test } from "bun:test";

import { pwaAssetRoutes, pwaIconFiles } from "../../src/pwa/pwa.assets.ts";
import { WALL_MANIFEST, WEB_MANIFEST_PATH } from "../../src/pwa/pwa.manifest.ts";

/** The first eight bytes of every PNG, so a stub or an HTML error page fails. */
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

function handlerFor(path: string) {
  const handler = pwaAssetRoutes[path];
  if (handler === undefined) throw new Error(`no route for ${path}`);
  return handler;
}

describe("the manifest route", () => {
  test("answers the registered media type, not plain JSON", () => {
    const response = handlerFor(WEB_MANIFEST_PATH)();
    expect(response.headers.get("content-type")).toBe(
      "application/manifest+json; charset=utf-8",
    );
  });

  test("answers the document itself", async () => {
    const body: unknown = await handlerFor(WEB_MANIFEST_PATH)().json();
    expect(body).toEqual(JSON.parse(JSON.stringify(WALL_MANIFEST)));
  });
});

describe("the icon routes", () => {
  test("every icon file is also a route, and nothing else is", () => {
    expect(Object.keys(pwaAssetRoutes).toSorted()).toEqual(
      [WEB_MANIFEST_PATH, ...Object.keys(pwaIconFiles)].toSorted(),
    );
  });

  for (const [path, file] of Object.entries(pwaIconFiles)) {
    test(`${path} serves a real PNG, not an empty lazy file`, async () => {
      expect(handlerFor(path)().headers.get("content-type")).toBe("image/png");

      const bytes = new Uint8Array(await Bun.file(file).arrayBuffer());
      expect(bytes.length).toBeGreaterThan(512);
      expect(bytes.slice(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);
    });
  }
});
