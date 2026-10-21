/**
 * The bytes behind the paths in `pwa.manifest.ts`.
 *
 * The PNGs are imported with `type: "file"` rather than read off disk, and that
 * is the whole reason this file exists separately from the manifest document.
 * `bun build --compile` embeds anything imported that way and rewrites the
 * import to a path inside the executable, so the same two lines serve the icons
 * from source and from a single-file binary. Reading them relative to the
 * process working directory would work in `bun run dev` and then fail in the
 * field: a compiled wall is launched from wherever the operator happened to be,
 * most often `/` when something else starts it.
 *
 * The icons live beside this module, in `src/pwa/`, because a `type: "file"`
 * import has to be relative to the module that embeds it and this module is the
 * only thing that ever reads them.
 *
 * Exported as a path-to-handler map rather than as loose functions so
 * `server.entry.ts` wraps the whole set in `wallOnly` in one place: a proxied
 * site must keep its own `/pwa/...` paths, and an icon added here must not need
 * the entrypoint edited to stay behind that guard.
 */

import {
  APPLE_TOUCH_ICON_PATH,
  PWA_ICON_192_PATH,
  PWA_ICON_512_PATH,
  PWA_ICON_MASKABLE_512_PATH,
  WALL_MANIFEST,
  WEB_MANIFEST_PATH,
} from "./pwa.manifest.ts";

import icon192 from "./pwa.icon-192.png" with { type: "file" };
import icon512 from "./pwa.icon-512.png" with { type: "file" };
import iconMaskable512 from "./pwa.icon-maskable-512.png" with { type: "file" };
import appleTouchIcon from "./pwa.icon-apple-touch-180.png" with { type: "file" };

/**
 * `application/manifest+json` and not `application/json`: Chrome accepts either,
 * but only the registered type makes the response self-describing to anything
 * else that reads it.
 */
function handleWebManifest(): Response {
  return new Response(JSON.stringify(WALL_MANIFEST), {
    headers: { "content-type": "application/manifest+json; charset=utf-8" },
  });
}

/**
 * Route path to the file the import resolved to — from source an absolute path
 * in this checkout, inside a compiled binary one of Bun's embedded paths.
 *
 * Exported because this is the pair worth checking and a `Response` is the one
 * way a test cannot check it: `bun test` preloads happy-dom, whose global
 * `Response` replaces Bun's and stringifies a `Bun.file` body to
 * `[object Blob]`. Reading these paths is also the stricter test — `Bun.file`
 * is lazy, so an import resolving to nothing yields a well-formed response with
 * an empty body and no error anywhere.
 */
export const pwaIconFiles: Readonly<Record<string, string>> = {
  [PWA_ICON_192_PATH]: icon192,
  [PWA_ICON_512_PATH]: icon512,
  [PWA_ICON_MASKABLE_512_PATH]: iconMaskable512,
  [APPLE_TOUCH_ICON_PATH]: appleTouchIcon,
};

/** The type is stated rather than inferred: inside a compiled binary the
 *  embedded path is Bun's, and nothing here should depend on its spelling. */
function servePng(path: string): Response {
  return new Response(Bun.file(path), {
    headers: { "content-type": "image/png" },
  });
}

export const pwaAssetRoutes: Readonly<Record<string, () => Response>> = {
  [WEB_MANIFEST_PATH]: handleWebManifest,
  ...Object.fromEntries(
    Object.entries(pwaIconFiles).map(([route, file]) => [route, () => servePng(file)]),
  ),
};
