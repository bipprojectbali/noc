/**
 * One switch that stops every pane from taking the cursor during a drag.
 *
 * Without it a drag dies the moment the pointer crosses a pane: the pane eats
 * the move events and the splitter never hears them again.
 *
 * Why this is a seam and not simply a CSS class. `pointer-events` is a CSS
 * concept, so it only reaches panes that are iframes. A native webview is not
 * in the DOM at all — it takes mouse input at the OS level over the region it
 * occupies — and no stylesheet can quiet it. So "stop the panes taking the
 * cursor" is the concept, and the body class below is one implementation of it.
 * The webview renderer registers its own suppressor here (ignore-cursor-events,
 * or hiding for the duration of the drag) instead of this module growing a
 * second mechanism and a branch to choose between them.
 */

export const RESIZING_BODY_CLASS = "noc-resizing";

export type PanePointerSuppressor = {
  suspend: () => void;
  resume: () => void;
};

const suppressors = new Set<PanePointerSuppressor>();

/** Returns an unregister function, so a renderer can detach with its lifecycle. */
export function registerPanePointerSuppressor(
  suppressor: PanePointerSuppressor,
): () => void {
  suppressors.add(suppressor);
  return () => {
    suppressors.delete(suppressor);
  };
}

/**
 * The iframe implementation: a class on `<body>`, paired with the rule in
 * `app.css`. Deliberately not React state — re-rendering the pane layer to
 * quiet the frames could disturb the very frames it is protecting.
 */
export const iframePanePointerSuppressor: PanePointerSuppressor = {
  suspend: () => {
    document.body.classList.add(RESIZING_BODY_CLASS);
  },
  resume: () => {
    document.body.classList.remove(RESIZING_BODY_CLASS);
  },
};

registerPanePointerSuppressor(iframePanePointerSuppressor);

export function suspendPanePointerCapture(): void {
  for (const suppressor of suppressors) suppressor.suspend();
}

export function resumePanePointerCapture(): void {
  for (const suppressor of suppressors) suppressor.resume();
}
