import { describe, expect, test } from "bun:test";

import type { Rect } from "../../src/geometry/geometry.rect.ts";
import { MIN_FRACTION } from "../../src/layout/layout.tree.ts";
import {
  axisCoordinate,
  axisExtent,
  beginResizeSession,
  clampFraction,
  fractionAt,
  trackExtent,
} from "../../src/resize/resize.session.ts";
import type { SplitDirection } from "../../src/layout/layout.types.ts";

const NO_SPLITTER: Rect = { left: 0, top: 0, width: 0, height: 0 };

/** A 1000x600 container, splitter of `thickness`, drag starting at the middle. */
function sessionFor(
  direction: SplitDirection,
  startFraction: number,
  thickness = 0,
) {
  const container: Rect = { left: 100, top: 50, width: 1000, height: 600 };
  const splitter: Rect = {
    left: 0,
    top: 0,
    width: direction === "row" ? thickness : 1000,
    height: direction === "column" ? thickness : 600,
  };
  return beginResizeSession({
    splitId: "split-1",
    direction,
    pointerId: 7,
    startFraction,
    container,
    splitter,
    pointer: { x: 600, y: 350 },
  });
}

describe("axis selection", () => {
  test("a row split drags along x and a column split along y", () => {
    const point = { x: 42, y: 99 };
    expect(axisCoordinate("row", point)).toBe(42);
    expect(axisCoordinate("column", point)).toBe(99);
  });

  test("extent is width for a row split and height for a column split", () => {
    const rect: Rect = { left: 0, top: 0, width: 800, height: 600 };
    expect(axisExtent("row", rect)).toBe(800);
    expect(axisExtent("column", rect)).toBe(600);
  });
});

describe("trackExtent", () => {
  test("subtracts the splitter's own thickness along the drag axis", () => {
    const container: Rect = { left: 0, top: 0, width: 1000, height: 600 };
    const splitter: Rect = { left: 0, top: 0, width: 6, height: 600 };
    expect(trackExtent("row", container, splitter)).toBe(994);
  });

  test("uses the other axis for a column split", () => {
    const container: Rect = { left: 0, top: 0, width: 1000, height: 600 };
    const splitter: Rect = { left: 0, top: 0, width: 1000, height: 6 };
    expect(trackExtent("column", container, splitter)).toBe(594);
  });

  test("never reports a negative track", () => {
    const container: Rect = { left: 0, top: 0, width: 4, height: 4 };
    const splitter: Rect = { left: 0, top: 0, width: 6, height: 6 };
    expect(trackExtent("row", container, splitter)).toBe(0);
  });
});

describe("clampFraction", () => {
  test("holds the fraction inside the tree's own bounds", () => {
    expect(clampFraction(0.5)).toBe(0.5);
    expect(clampFraction(-3)).toBe(MIN_FRACTION);
    expect(clampFraction(0)).toBe(MIN_FRACTION);
    expect(clampFraction(1)).toBe(1 - MIN_FRACTION);
    expect(clampFraction(9)).toBe(1 - MIN_FRACTION);
  });

  test("NaN falls back to the minimum instead of reaching the tree", () => {
    expect(clampFraction(Number.NaN)).toBe(MIN_FRACTION);
  });

  test("an infinite fraction still clamps to the end it points at", () => {
    expect(clampFraction(Number.POSITIVE_INFINITY)).toBe(1 - MIN_FRACTION);
    expect(clampFraction(Number.NEGATIVE_INFINITY)).toBe(MIN_FRACTION);
  });
});

describe("fractionAt — row", () => {
  test("moving right by a tenth of the track adds a tenth to the fraction", () => {
    const session = sessionFor("row", 0.5);
    expect(fractionAt(session, { x: 700, y: 350 })).toBeCloseTo(0.6, 10);
  });

  test("moving left subtracts", () => {
    const session = sessionFor("row", 0.5);
    expect(fractionAt(session, { x: 350, y: 350 })).toBeCloseTo(0.25, 10);
  });

  test("y movement is ignored", () => {
    const session = sessionFor("row", 0.4);
    expect(fractionAt(session, { x: 600, y: 10_000 })).toBeCloseTo(0.4, 10);
  });

  test("accounts for the splitter's thickness", () => {
    // Track is 1000 - 6 = 994, so +99.4px is exactly a tenth.
    const session = sessionFor("row", 0.5, 6);
    expect(session.trackExtent).toBe(994);
    expect(fractionAt(session, { x: 699.4, y: 350 })).toBeCloseTo(0.6, 10);
  });
});

describe("fractionAt — column", () => {
  test("moving down adds to the fraction", () => {
    const session = sessionFor("column", 0.5);
    // Track is 600, origin y is 350, so +60px is a tenth.
    expect(fractionAt(session, { x: 600, y: 410 })).toBeCloseTo(0.6, 10);
  });

  test("moving up subtracts", () => {
    const session = sessionFor("column", 0.5);
    expect(fractionAt(session, { x: 600, y: 200 })).toBeCloseTo(0.25, 10);
  });

  test("x movement is ignored", () => {
    const session = sessionFor("column", 0.7);
    expect(fractionAt(session, { x: -5_000, y: 350 })).toBeCloseTo(0.7, 10);
  });
});

describe("fractionAt — clamping at both ends", () => {
  test("dragging far past the leading edge stops at the minimum", () => {
    const session = sessionFor("row", 0.5);
    expect(fractionAt(session, { x: -100_000, y: 350 })).toBe(MIN_FRACTION);
  });

  test("dragging far past the trailing edge stops at the maximum", () => {
    const session = sessionFor("row", 0.5);
    expect(fractionAt(session, { x: 100_000, y: 350 })).toBe(1 - MIN_FRACTION);
  });

  test("clamps at both ends for a column split too", () => {
    const session = sessionFor("column", 0.5);
    expect(fractionAt(session, { x: 600, y: -100_000 })).toBe(MIN_FRACTION);
    expect(fractionAt(session, { x: 600, y: 100_000 })).toBe(1 - MIN_FRACTION);
  });

  test("a pane can never be dragged to nothing", () => {
    const session = sessionFor("row", 0.5);
    const squeezed = fractionAt(session, { x: -100_000, y: 350 });
    expect(squeezed).toBeGreaterThan(0);
    expect(1 - squeezed).toBeGreaterThan(0);
  });
});

describe("fractionAt — degenerate container", () => {
  test("a zero-extent track keeps the starting fraction instead of dividing by zero", () => {
    const session = beginResizeSession({
      splitId: "split-1",
      direction: "row",
      pointerId: 1,
      startFraction: 0.42,
      container: NO_SPLITTER,
      splitter: NO_SPLITTER,
      pointer: { x: 0, y: 0 },
    });
    expect(session.trackExtent).toBe(0);
    expect(fractionAt(session, { x: 500, y: 500 })).toBeCloseTo(0.42, 10);
  });
});

describe("beginResizeSession", () => {
  test("records what Escape needs to put the split back", () => {
    const session = sessionFor("row", 0.33, 6);
    expect(session).toMatchObject({
      splitId: "split-1",
      direction: "row",
      pointerId: 7,
      startFraction: 0.33,
      originCoordinate: 600,
      trackExtent: 994,
    });
  });

  test("takes the origin from the drag axis, not the other one", () => {
    expect(sessionFor("column", 0.5).originCoordinate).toBe(350);
  });
});
