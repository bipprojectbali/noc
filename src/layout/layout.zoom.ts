/**
 * The ladder a pane's page is magnified along, and how a button moves between
 * its rungs. Pure: no DOM, no React, no store.
 *
 * It lives in `layout/` rather than next to the controls because the tree is
 * where a zoom is kept — the serializer's upgrade step and the structural
 * checks both need the clamp, and `layout/` may not import from `pane/`.
 *
 * The rungs are Chrome's own, deliberately. An operator who has ever pressed
 * Cmd-+ in the browser this wall runs in already knows this ladder, and a
 * second, cleverer one would only be a second thing to learn. Both ends are
 * hard stops rather than wrap-arounds: a control that jumps from 200% straight
 * back to 50% reads as a bug, so the chrome asks `canZoomIn`/`canZoomOut` and
 * disables the button instead of letting it do nothing.
 *
 * `clampZoom` is the only way a number from outside becomes a zoom, and it
 * takes `unknown` on purpose — a stored layout, a hand-edited database and a
 * POST to the persistence endpoint all arrive untrusted, and a page scaled to
 * 0, to NaN or to 40 is a page with no way back through the control that hid
 * it. What it does *not* do is snap to the nearest rung: a value between two of
 * them is shown as it is, and the first press of either button steps onto the
 * ladder. Rounding someone's 95% to 90% behind their back would be a change
 * nobody asked for; refusing the impossible is not.
 */

/** What a site is magnified by until someone says otherwise. */
export const DEFAULT_ZOOM = 1;

// The ends are declared first and then used to build the ladder, rather than
// read back off it: `noUncheckedIndexedAccess` types the last element of even a
// literal tuple as possibly undefined, and a `?? 2` to get past that would be
// an unreachable second answer to "how far does this go".
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;

/**
 * Chrome's own zoom steps. Ordered, and the order is the contract — `zoomIn`
 * and `zoomOut` scan it.
 */
export const ZOOM_LEVELS = [
  MIN_ZOOM, 0.67, 0.75, 0.8, 0.9, DEFAULT_ZOOM, 1.1, 1.25, 1.5, 1.75, MAX_ZOOM,
] as const;

/**
 * Slack for the float comparisons below. The rungs are exact literals, so this
 * only has to absorb a value that arrived through arithmetic elsewhere; without
 * it a stored 0.9999999999 would offer a "zoom in" that moves nothing.
 */
const EPSILON = 1e-9;

/** Whether a value is usable as a zoom exactly as it stands. */
export function isZoomLevel(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_ZOOM - EPSILON &&
    value <= MAX_ZOOM + EPSILON
  );
}

/** Anything at all, turned into a zoom this app will render. */
export function clampZoom(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/** The next rung up, or the top one when there is none. */
export function zoomIn(current: number): number {
  const level = clampZoom(current);
  return ZOOM_LEVELS.find((step) => step > level + EPSILON) ?? MAX_ZOOM;
}

/** The next rung down, or the bottom one when there is none. */
export function zoomOut(current: number): number {
  const level = clampZoom(current);
  for (let index = ZOOM_LEVELS.length - 1; index >= 0; index -= 1) {
    const step = ZOOM_LEVELS[index];
    if (step !== undefined && step < level - EPSILON) return step;
  }
  return MIN_ZOOM;
}

export function canZoomIn(current: number): boolean {
  return clampZoom(current) < MAX_ZOOM - EPSILON;
}

export function canZoomOut(current: number): boolean {
  return clampZoom(current) > MIN_ZOOM + EPSILON;
}

/** Whether the page is at its ordinary size, which is what "reset" undoes. */
export function isDefaultZoom(current: number): boolean {
  return Math.abs(clampZoom(current) - DEFAULT_ZOOM) <= EPSILON;
}

/**
 * The label on the control, read from across a room. Whole percent: the rungs
 * are all whole percentages, and a stored 0.6666 must not read as "66.66%" in a
 * box 224px wide.
 */
export function formatZoom(current: number): string {
  return `${Math.round(clampZoom(current) * 100)}%`;
}
