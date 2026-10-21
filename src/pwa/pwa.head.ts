/**
 * The tags that make the wall installable, added to the served document
 * instead of to `index.html`.
 *
 * Not a preference — `index.html` cannot hold them. Bun's HTML bundler resolves
 * every `href` in the file against the filesystem while building: an absolute
 * `/pwa/...` path is a hard build error because nothing is there on disk, and a
 * relative `./src/pwa/...` path is bundled and rewritten to a hashed asset URL,
 * which the manifest's own `icons[].src` has no way to learn. Inserting here
 * keeps `pwa.manifest.ts` the only place any of these paths are written.
 *
 * Server-side and in the markup rather than appended by the frontend at
 * runtime: Chromium runs its installability check against the document it
 * parsed, and a manifest link that arrives after first paint is a race nothing
 * here could observe losing.
 *
 * A string in and a string out, with the caller doing the `Response` work.
 * `HTMLRewriter` would be the streaming answer and was the first one, but it
 * refuses any `Response` it did not recognise — and under `bun test` the
 * happy-dom preload has replaced that global, so the whole of this file would
 * have been unreachable from a test. The document is a two-kilobyte shell
 * fetched over loopback; buying coverage with one buffered read is the trade.
 */

import {
  APPLE_TOUCH_ICON_PATH,
  PWA_ICON_192_PATH,
  PWA_ICON_512_PATH,
  WALL_THEME_COLOR,
  WEB_MANIFEST_PATH,
} from "./pwa.manifest.ts";

/** Both sizes are named here as well as in the manifest: the manifest is what
 *  the install prompt reads, these are what the tab and the dock read. */
export const WALL_HEAD_TAGS = [
  `<link rel="manifest" href="${WEB_MANIFEST_PATH}">`,
  `<meta name="theme-color" content="${WALL_THEME_COLOR}">`,
  `<link rel="icon" type="image/png" sizes="192x192" href="${PWA_ICON_192_PATH}">`,
  `<link rel="icon" type="image/png" sizes="512x512" href="${PWA_ICON_512_PATH}">`,
  `<link rel="apple-touch-icon" href="${APPLE_TOUCH_ICON_PATH}">`,
].join("");

const HEAD_END = /<\/head\s*>/i;

/**
 * Last thing in the head, so nothing the bundler wrote is displaced. A document
 * with no head comes back untouched, which is what should happen to the
 * build-error page Bun serves in the frontend's place when it does not compile.
 */
export function withPwaHead(html: string): string {
  const end = HEAD_END.exec(html);
  if (end === null) return html;
  return `${html.slice(0, end.index)}${WALL_HEAD_TAGS}${html.slice(end.index)}`;
}
