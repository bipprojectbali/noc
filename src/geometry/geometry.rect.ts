/**
 * Rect maths for placing panes over their slots.
 *
 * Kept pure and free of the DOM so it can be tested with injected rects:
 * happy-dom reports every element as a zero rect, so the arithmetic has to be
 * verifiable without a real browser.
 */

export type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export const ZERO_RECT: Rect = { left: 0, top: 0, width: 0, height: 0 };

/** Converts a slot's viewport rect into coordinates inside the pane layer. */
export function toLayerRect(slot: Rect, layer: Rect): Rect {
  return {
    left: slot.left - layer.left,
    top: slot.top - layer.top,
    width: slot.width,
    height: slot.height,
  };
}

export function rectsEqual(a: Rect, b: Rect): boolean {
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height
  );
}

/** True when a rect has no area, which is how a docked or unplaced pane reads. */
export function isEmptyRect(rect: Rect): boolean {
  return rect.width <= 0 || rect.height <= 0;
}

/**
 * The style a pane host carries. Panes are placed with `transform` rather than
 * `left`/`top` so a resize does not trigger layout for every pane on the wall.
 */
export function rectToStyle(rect: Rect): Record<string, string> {
  return {
    transform: `translate(${rect.left}px, ${rect.top}px)`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };
}
