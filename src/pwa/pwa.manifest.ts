/**
 * The wall as something an operator installs, because the desktop shell that
 * used to supply the chrome-less window is gone.
 *
 * Nothing here is an effect: the manifest is one frozen document and a handful
 * of paths, declared in one place so the HTML head, the server routes and the
 * icons on disk cannot drift apart — a manifest that names an icon path no
 * route answers fails installability with no error anyone sees.
 *
 * Two things that look like oversights and are not:
 *
 *  - **No `serviceworker` and no offline story.** Chrome stopped requiring a
 *    fetch handler for installability in 112, and there is nothing here for one
 *    to do: every pane is a live iframe on *another* origin, which a wall-origin
 *    worker can neither see nor cache, and a cached app shell would outlive
 *    `bun build --compile` — a rebuilt binary would serve freshly hashed assets
 *    to clients still holding the old ones. Chrome supplies its own offline page
 *    for installed apps that have none. Staleness is the only thing a worker
 *    would add.
 *  - **`display_override` leads with `window-controls-overlay`.** A wall wants
 *    every pixel, and that mode hands the content the full surface with the
 *    window buttons drawn over it. It is still a WICG incubation, so it is
 *    written as a list that degrades — fullscreen, then minimal-ui, then the
 *    plain `display` below it — and never as a requirement.
 *
 * The paths are absolute and all under `/pwa/`: they are served by real Bun
 * routes, which win over the catch-all that would otherwise 307 them at the
 * landing host, and they are grouped so the wall's root namespace stays the
 * router's.
 */

export const WEB_MANIFEST_PATH = "/pwa/manifest.webmanifest";
export const PWA_ICON_192_PATH = "/pwa/icon-192.png";
export const PWA_ICON_512_PATH = "/pwa/icon-512.png";
export const PWA_ICON_MASKABLE_512_PATH = "/pwa/icon-maskable-512.png";
export const APPLE_TOUCH_ICON_PATH = "/pwa/apple-touch-icon.png";

/** Matches `--noc-bg` in `app.base.css`: the frame around a cold start should
 *  not flash a colour the wall never uses. */
export const WALL_THEME_COLOR = "#0f1115";

/**
 * Frozen so no caller can edit the document the browser is about to install;
 * `start_url` and `scope` are the wall root rather than the manifest's own
 * folder, and `id` is pinned to the same string so a later path change cannot
 * silently produce a *second* installed app beside the first.
 */
export const WALL_MANIFEST = Object.freeze({
  id: "/",
  name: "NOC wall",
  short_name: "NOC",
  description: "A tiling wall of monitoring dashboards, one pane each.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  display_override: ["window-controls-overlay", "fullscreen", "minimal-ui"],
  orientation: "landscape",
  background_color: WALL_THEME_COLOR,
  theme_color: WALL_THEME_COLOR,
  icons: [
    { src: PWA_ICON_192_PATH, sizes: "192x192", type: "image/png", purpose: "any" },
    { src: PWA_ICON_512_PATH, sizes: "512x512", type: "image/png", purpose: "any" },
    {
      src: PWA_ICON_MASKABLE_512_PATH,
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
});
