/**
 * The browser path: a pane is an iframe.
 *
 * Kept as a first-class renderer, not a fallback. Layout and UI work happens
 * here because `bun run dev` reloads in milliseconds and devtools can see
 * everything, while the native shell has to be rebuilt to be looked at.
 *
 * Its limit is the reason the webview renderer exists: a site sending
 * `X-Frame-Options: sameorigin` cannot be shown here, by anyone, ever.
 *
 * One of these is mounted per *site*, not per pane, and the pane body stacks
 * them all in one grid cell. The site that is not on screen is hidden with
 * `visibility`, never unmounted and never collapsed to nothing: removing the
 * element reloads the page, and a zero-sized viewport makes it reflow and lose
 * its scroll position. Hidden is the one way to leave a page alone.
 */

import {
  paneContentTestId,
  type PaneContentProps,
  type PaneRenderer,
} from "./pane.renderer.ts";
import { useWallStore } from "./pane.store.ts";

/** Set on the body for the duration of a drag. See `setCursorCapture`. */
export const NO_CURSOR_CAPTURE_CLASS = "noc-no-pane-cursor";

/**
 * Permissions Policy delegated to every pane.
 *
 * A cross-origin iframe inherits none of these from the wall page: the default
 * allowlist for capture features is `self`, so without this attribute
 * `navigator.mediaDevices` inside a pane enumerates zero devices and the site
 * reports "device not found" — not "permission denied", because it was never
 * asked. That is a different failure from the user refusing a prompt, and no
 * amount of clicking inside the pane can fix it.
 *
 * Bare feature names mean `'src'`: the permission reaches the pane's own origin
 * and stops there, so a page cannot pass the camera on to whatever it nests.
 *
 * This is wall-wide on purpose, and it is a real widening — every address the
 * operator types can now ask for the camera. Three things bound it: the pane's
 * URL is always typed by the operator, the wall binds to loopback, and in a
 * browser the user still gets the permission prompt. The exception is the
 * native shell, where wry grants capture without asking; see
 * `src-tauri/src/pane_webview.rs`. Making this per-pane means a new field on the
 * pane node, which is a schema change, not a toggle.
 *
 * Deliberately absent: `display-capture` and `geolocation`. Neither was asked
 * for, and screen capture is a wider grant than the camera.
 */
export const PANE_ALLOW_POLICY = "camera; microphone";

function PaneIframe({ paneId, siteId, load, active }: PaneContentProps) {
  const dispatchLoad = useWallStore((state) => state.dispatchLoad);

  // Only these two states have a frameable url; the rest are the chrome's job.
  const hasPage = load.kind === "loading" || load.kind === "ready";
  const frameSrc = hasPage ? load.url : undefined;
  const showFrame = hasPage && active;

  return (
    <iframe
      className={
        showFrame ? "noc-pane__frame" : "noc-pane__frame noc-pane__frame--hidden"
      }
      data-testid={paneContentTestId("pane-frame", paneId, siteId, active)}
      data-site-id={siteId}
      title={`Pane ${paneId}`}
      allow={PANE_ALLOW_POLICY}
      src={frameSrc}
      onLoad={() => {
        if (frameSrc === undefined) return;
        dispatchLoad(siteId, { type: "frame-loaded", url: frameSrc });
      }}
    />
  );
}

export const paneIframeRenderer: PaneRenderer = {
  kind: "iframe",
  Content: PaneIframe,

  // Nothing to do: an iframe is inside its host, so the host's rect places it.
  place: () => {},

  // Nothing to release: React removes the iframe with the host.
  release: () => {},

  releaseSite: () => {},

  setCursorCapture: (capturing) => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle(NO_CURSOR_CAPTURE_CLASS, !capturing);
  },
};
