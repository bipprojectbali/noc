/**
 * Where a pane drag lands, as arithmetic: no DOM, no React, no store.
 *
 * Split out for the same reason `geometry.rect` is: happy-dom measures every
 * element as zero, so the only part of a drag that can be proven without a
 * browser is the part that takes rects and points as plain numbers. The hook in
 * `pane.drag` does the hit-testing and owns the session; everything it decides
 * about *which* drop a pointer means is decided here.
 */

import type { PaneSide } from "../layout/layout.types.ts";
import type { Rect } from "../geometry/geometry.rect.ts";

export type Point = { x: number; y: number };

/** An edge of the target pane, or its middle — which means trade places. */
export type DropZone = PaneSide | "center";

/**
 * How far a press has to travel before it stops being a click.
 *
 * The handle is the ⋮ button, which still opens the menu, so this threshold is
 * the whole difference between the two gestures. Four pixels is below the
 * tremor of letting go of a mouse button and well under any deliberate move.
 */
export const DRAG_THRESHOLD_PX = 4;

/**
 * How deep into the pane the middle reaches, as a fraction of its own width and
 * height, so it behaves the same on a wall of four panes and a wall of twenty.
 *
 * 0.3 makes the middle the central 40% of each axis — a sixth of the pane's
 * area. Deliberately the smaller share: the four edges are the gesture people
 * will reach for, and a swap that happens by accident is the expensive mistake,
 * since it moves two panes instead of one.
 */
export const CENTER_ZONE_FRACTION = 0.3;

export function hasCrossedDragThreshold(start: Point, now: Point): boolean {
  return Math.hypot(now.x - start.x, now.y - start.y) >= DRAG_THRESHOLD_PX;
}

/**
 * The zone a pointer is in, relative to one pane's rect.
 *
 * Normalised first, so the comparison is against fractions rather than pixels:
 * the nearest edge wins, and the middle is what is left when no edge is near.
 * That puts the boundaries on the diagonals, which is what makes the corners
 * behave — a corner is ambiguous, and the diagonal is the only split of it that
 * does not favour one axis.
 *
 * A point outside the rect reads as a negative distance, so it still resolves
 * to the edge it is outside of rather than to the middle. A degenerate rect has
 * no edges to be near, and a drop on it can only mean the pane itself.
 *
 * Ties go left, then right, then top: exact ties need a stable answer more than
 * a clever one, and only a pointer on a pane's exact centre line can hit one.
 */
export function dropZoneAt(rect: Rect, point: Point): DropZone {
  if (rect.width <= 0 || rect.height <= 0) return "center";

  const horizontal = (point.x - rect.left) / rect.width;
  const vertical = (point.y - rect.top) / rect.height;
  let nearest = { side: "left" as PaneSide, distance: horizontal };
  for (const edge of [
    { side: "right" as PaneSide, distance: 1 - horizontal },
    { side: "top" as PaneSide, distance: vertical },
    { side: "bottom" as PaneSide, distance: 1 - vertical },
  ]) {
    if (edge.distance < nearest.distance) nearest = edge;
  }
  return nearest.distance >= CENTER_ZONE_FRACTION ? "center" : nearest.side;
}
