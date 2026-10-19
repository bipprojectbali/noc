/**
 * Drag-resize arithmetic and the state of one drag session.
 *
 * Pure on purpose: no DOM, no React, no store. The splitter component owns the
 * pointer and the rects; everything that can be got wrong about the numbers
 * lives here, where it can be tested without a browser.
 */

import type { Rect } from "../geometry/geometry.rect.ts";
import { MIN_FRACTION } from "../layout/layout.tree.ts";
import type { NodeId, SplitDirection } from "../layout/layout.types.ts";

export type Point = { x: number; y: number };

export type ResizeSession = {
  splitId: NodeId;
  direction: SplitDirection;
  pointerId: number;
  /** Space the two children actually divide, splitter thickness excluded. */
  trackExtent: number;
  /** Pointer position along the drag axis when the drag began. */
  originCoordinate: number;
  /** The first child's fraction at pointerdown. Escape restores exactly this. */
  startFraction: number;
};

export type ResizeSessionInput = {
  splitId: NodeId;
  direction: SplitDirection;
  pointerId: number;
  startFraction: number;
  container: Rect;
  splitter: Rect;
  pointer: Point;
};

/** A `row` split divides left|right, so it drags along x; `column` along y. */
export function axisCoordinate(
  direction: SplitDirection,
  point: Point,
): number {
  return direction === "row" ? point.x : point.y;
}

export function axisExtent(direction: SplitDirection, rect: Rect): number {
  return direction === "row" ? rect.width : rect.height;
}

/**
 * Keeps a fraction inside the same bounds the tree would clamp it to.
 *
 * An infinite fraction still means "as far as this side goes" and clamps to
 * that end. `NaN` carries no direction at all and would survive `Math.min`, so
 * it falls back to the minimum rather than reaching the tree.
 */
export function clampFraction(fraction: number): number {
  if (Number.isNaN(fraction)) return MIN_FRACTION;
  return Math.min(Math.max(fraction, MIN_FRACTION), 1 - MIN_FRACTION);
}

/**
 * The extent the two children share.
 *
 * The splitter is a flex item, so it takes a slice of the container for itself.
 * Measuring against the full container instead would make the boundary drift
 * behind the cursor by a fraction of the splitter's thickness on every drag.
 */
export function trackExtent(
  direction: SplitDirection,
  container: Rect,
  splitter: Rect,
): number {
  const extent =
    axisExtent(direction, container) - axisExtent(direction, splitter);
  return extent > 0 ? extent : 0;
}

export function beginResizeSession(input: ResizeSessionInput): ResizeSession {
  return {
    splitId: input.splitId,
    direction: input.direction,
    pointerId: input.pointerId,
    trackExtent: trackExtent(input.direction, input.container, input.splitter),
    originCoordinate: axisCoordinate(input.direction, input.pointer),
    startFraction: input.startFraction,
  };
}

/**
 * The first child's fraction for a pointer at `point`.
 *
 * Measured as a delta from where the drag began rather than from the container
 * edge, so grabbing the splitter off-centre does not make the boundary jump to
 * the cursor on the first move.
 */
export function fractionAt(session: ResizeSession, point: Point): number {
  // A container with no extent yet: keep the fraction rather than divide by zero.
  if (session.trackExtent <= 0) return clampFraction(session.startFraction);
  const travelled =
    axisCoordinate(session.direction, point) - session.originCoordinate;
  return clampFraction(
    session.startFraction + travelled / session.trackExtent,
  );
}
