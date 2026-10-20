/**
 * The arithmetic behind a drop, which is the one part of the gesture a test
 * without a browser can really settle: given a rect and a point, which edge of
 * the pane is being aimed at, or is it the middle.
 *
 * Nothing here needs a DOM, so nothing here is stubbed. What it cannot say is
 * whether the resulting zones feel right under a real pointer — that is a
 * question for a running app, like every other geometry claim in this project.
 */

import { describe, expect, test } from "bun:test";

import {
  CENTER_ZONE_FRACTION,
  DRAG_THRESHOLD_PX,
  dropZoneAt,
  hasCrossedDragThreshold,
} from "../../src/pane/pane.drag-geometry.ts";

/** A 200×100 pane at an offset, so a bug that ignores `left`/`top` shows up. */
const RECT = { left: 100, top: 50, width: 200, height: 100 };

describe("the threshold tells a click on ⋮ from a drag of the pane", () => {
  test("a press that does not move is not a drag", () => {
    expect(hasCrossedDragThreshold({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(false);
  });

  test("a wobble under the threshold is not a drag", () => {
    expect(hasCrossedDragThreshold({ x: 10, y: 10 }, { x: 12, y: 12 })).toBe(false);
  });

  test("exactly the threshold is a drag, in any direction", () => {
    const start = { x: 10, y: 10 };
    for (const now of [
      { x: 10 + DRAG_THRESHOLD_PX, y: 10 },
      { x: 10 - DRAG_THRESHOLD_PX, y: 10 },
      { x: 10, y: 10 + DRAG_THRESHOLD_PX },
      { x: 10, y: 10 - DRAG_THRESHOLD_PX },
    ]) {
      expect(hasCrossedDragThreshold(start, now)).toBe(true);
    }
  });

  test("the distance is radial, not per axis", () => {
    // 3 across and 3 down is 4.24 away: under the threshold on either axis
    // alone, over it as a movement.
    expect(hasCrossedDragThreshold({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(true);
  });
});

describe("where a point lands on a pane", () => {
  test("each edge claims the band along it", () => {
    expect(dropZoneAt(RECT, { x: 110, y: 100 })).toBe("left");
    expect(dropZoneAt(RECT, { x: 290, y: 100 })).toBe("right");
    expect(dropZoneAt(RECT, { x: 200, y: 55 })).toBe("top");
    expect(dropZoneAt(RECT, { x: 200, y: 145 })).toBe("bottom");
  });

  test("the middle of the pane is a swap", () => {
    expect(dropZoneAt(RECT, { x: 200, y: 100 })).toBe("center");
  });

  test("the centre zone is the middle 40% of each axis", () => {
    // 0.3 in from each side leaves 0.4 in the middle. Just inside that band is
    // a swap; just outside it belongs to the nearer edge.
    const inside = RECT.left + RECT.width * (CENTER_ZONE_FRACTION + 0.01);
    const outside = RECT.left + RECT.width * (CENTER_ZONE_FRACTION - 0.01);
    expect(dropZoneAt(RECT, { x: inside, y: 100 })).toBe("center");
    expect(dropZoneAt(RECT, { x: outside, y: 100 })).toBe("left");
  });

  test("a corner goes to the nearer edge, measured as a fraction of the pane", () => {
    // Distances are fractions of the pane's own width and height, so the line
    // between two edges is the rect's diagonal rather than 45°. On a pane twice
    // as wide as it is tall, a point 10px in from both the left and the top is
    // a tenth of the way down but only a twentieth of the way across: left.
    expect(dropZoneAt(RECT, { x: 110, y: 60 })).toBe("left");
    expect(dropZoneAt(RECT, { x: 140, y: 55 })).toBe("top");
    expect(dropZoneAt(RECT, { x: 290, y: 140 })).toBe("right");
    expect(dropZoneAt(RECT, { x: 260, y: 145 })).toBe("bottom");
  });

  test("a point outside the rect still names the side it is outside of", () => {
    // The pointer leaves the pane between two moves; the last zone shown has to
    // keep making sense rather than flipping to a swap.
    expect(dropZoneAt(RECT, { x: 10, y: 100 })).toBe("left");
    expect(dropZoneAt(RECT, { x: 400, y: 100 })).toBe("right");
    expect(dropZoneAt(RECT, { x: 200, y: 0 })).toBe("top");
    expect(dropZoneAt(RECT, { x: 200, y: 999 })).toBe("bottom");
  });

  test("a tie goes to the first side in order, never to nothing", () => {
    // The exact centre of a square is the same distance from all four edges.
    // Which one wins does not matter; that one always does is what keeps the
    // highlight from flickering between them as the pointer sits still.
    const square = { left: 0, top: 0, width: 100, height: 100 };
    expect(dropZoneAt(square, { x: 25, y: 25 })).toBe("left");
    expect(dropZoneAt(square, { x: 75, y: 25 })).toBe("right");
  });

  test("a pane happy-dom has not measured is a swap, not a crash", () => {
    // Every rect is zero under happy-dom and a pane with no slot is zero for
    // real, so this path is reached, and dividing by the width is not an option.
    expect(dropZoneAt({ left: 0, top: 0, width: 0, height: 0 }, { x: 0, y: 0 })).toBe(
      "center",
    );
  });
});
