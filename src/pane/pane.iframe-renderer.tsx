/**
 * The browser path: a pane is an iframe.
 *
 * Kept as a first-class renderer, not a fallback. Layout and UI work happens
 * here because `bun run dev` reloads in milliseconds and devtools can see
 * everything, while the native shell has to be rebuilt to be looked at.
 *
 * Its limit is the reason the webview renderer exists: a site sending
 * `X-Frame-Options: sameorigin` cannot be shown here, by anyone, ever.
 */

import type { PaneContentProps, PaneRenderer } from "./pane.renderer.ts";
import { useWallStore } from "./pane.store.ts";

/** Set on the body for the duration of a drag. See `setCursorCapture`. */
export const NO_CURSOR_CAPTURE_CLASS = "noc-no-pane-cursor";

function PaneIframe({ paneId, load }: PaneContentProps) {
  const dispatchLoad = useWallStore((state) => state.dispatchLoad);

  // Only these two states have a frameable url; the rest are the chrome's job.
  const showFrame = load.kind === "loading" || load.kind === "ready";
  const frameSrc = showFrame ? load.url : undefined;

  return (
    <iframe
      className={
        showFrame ? "noc-pane__frame" : "noc-pane__frame noc-pane__frame--hidden"
      }
      data-testid={`pane-frame-${paneId}`}
      title={`Pane ${paneId}`}
      src={frameSrc}
      onLoad={() => {
        if (frameSrc === undefined) return;
        dispatchLoad(paneId, { type: "frame-loaded", url: frameSrc });
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

  setCursorCapture: (capturing) => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle(NO_CURSOR_CAPTURE_CLASS, !capturing);
  },
};
