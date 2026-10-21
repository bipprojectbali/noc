/**
 * One switch that stops every pane from taking the cursor during a drag.
 *
 * Without it a drag dies the moment the pointer crosses a pane: the pane eats
 * the move events and the splitter never hears them again.
 *
 * Why this is still a seam and not simply a CSS class. "Stop the panes taking
 * the cursor" is the concept; the body class below is one implementation of it,
 * and the registry is what kept this module from growing a branch per renderer
 * back when a pane could also be something CSS cannot reach. Three callers
 * share it now — splitter drags, the ⋮ panel and a pane drag — and each of them
 * wants the concept, not the class. A second implementation, if one is ever
 * needed again, registers itself rather than being chosen between here.
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
 * `app.base.css`. Deliberately not React state — re-rendering the pane layer to
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
