/**
 * The zoom ladder, which is the one part of this feature that can be proved
 * without a browser: it is arithmetic over a list of numbers.
 *
 * Nothing here says a page is actually magnified — happy-dom neither lays out
 * nor paints, so that remains an open item answered by looking at a screen.
 * What it does cover is the behaviour the controls depend on: the ends stop
 * rather than wrap, an off-ladder value steps onto the ladder instead of being
 * silently rounded, and a number from a stored file cannot produce a page with
 * no way back.
 */

import { describe, expect, test } from "bun:test";

import {
  canZoomIn,
  canZoomOut,
  clampZoom,
  DEFAULT_ZOOM,
  formatZoom,
  isDefaultZoom,
  isZoomLevel,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_LEVELS,
  zoomIn,
  zoomOut,
} from "../../src/layout/layout.zoom.ts";

describe("the ladder itself", () => {
  test("is ordered, and runs from the minimum to the maximum", () => {
    expect([...ZOOM_LEVELS]).toEqual([...ZOOM_LEVELS].sort((a, b) => a - b));
    expect(ZOOM_LEVELS[0]).toBe(MIN_ZOOM);
    expect(ZOOM_LEVELS[ZOOM_LEVELS.length - 1]).toBe(MAX_ZOOM);
    // The rung the wall starts on has to be on the ladder, or the first press
    // of either button would move to somewhere unreachable afterwards.
    expect(ZOOM_LEVELS).toContain(DEFAULT_ZOOM);
  });

  test("steps up and down through every rung and back", () => {
    let level = MIN_ZOOM;
    const climbed = [level];
    for (let i = 0; i < ZOOM_LEVELS.length; i += 1) {
      level = zoomIn(level);
      climbed.push(level);
    }
    // One step past the top is still the top, which is the last duplicate.
    expect(climbed).toEqual([...ZOOM_LEVELS, MAX_ZOOM]);

    let down = MAX_ZOOM;
    const descended = [down];
    for (let i = 0; i < ZOOM_LEVELS.length; i += 1) {
      down = zoomOut(down);
      descended.push(down);
    }
    expect(descended).toEqual([...[...ZOOM_LEVELS].reverse(), MIN_ZOOM]);
  });

  test("both ends stop instead of wrapping, and say so before being pressed", () => {
    expect(zoomIn(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(zoomOut(MIN_ZOOM)).toBe(MIN_ZOOM);
    expect(canZoomIn(MAX_ZOOM)).toBe(false);
    expect(canZoomOut(MIN_ZOOM)).toBe(false);
    expect(canZoomIn(MIN_ZOOM)).toBe(true);
    expect(canZoomOut(MAX_ZOOM)).toBe(true);
  });

  test("a value between two rungs steps onto the ladder, in both directions", () => {
    // 0.95 is not a rung. Stepping must not go past the neighbour on that side.
    expect(zoomIn(0.95)).toBe(1);
    expect(zoomOut(0.95)).toBe(0.9);
  });

  test("a float that drifted off a rung does not offer a step that moves nothing", () => {
    // What a stored 100% can come back as. Without the epsilon, `zoomIn` would
    // find 1 > 0.9999999999 and "step" to a level the eye cannot tell apart.
    expect(zoomIn(0.9999999999)).toBe(1.1);
    expect(zoomOut(1.0000000001)).toBe(0.9);
    expect(isDefaultZoom(0.9999999999)).toBe(true);
  });
});

describe("clampZoom is the only way in", () => {
  test("keeps a usable number as it stands", () => {
    for (const level of ZOOM_LEVELS) expect(clampZoom(level)).toBe(level);
    // Not snapped to the nearest rung: nobody asked for their 95% to move.
    expect(clampZoom(0.95)).toBe(0.95);
  });

  test("pulls an out-of-range number back to the nearest end", () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(-4)).toBe(MIN_ZOOM);
    expect(clampZoom(40)).toBe(MAX_ZOOM);
  });

  test("answers the ordinary size for anything that is not a number at all", () => {
    // A hand-edited database, a layout from another build, a JSON null: all of
    // them reach this, and none may produce a page the control cannot undo.
    for (const junk of [undefined, null, "1.5", NaN, Infinity, {}, []]) {
      expect(clampZoom(junk)).toBe(DEFAULT_ZOOM);
    }
  });

  test("isZoomLevel accepts what needs no clamping and nothing else", () => {
    expect(isZoomLevel(1)).toBe(true);
    expect(isZoomLevel(0.95)).toBe(true);
    expect(isZoomLevel(MIN_ZOOM)).toBe(true);
    expect(isZoomLevel(MAX_ZOOM)).toBe(true);
    expect(isZoomLevel(0.1)).toBe(false);
    expect(isZoomLevel(2.5)).toBe(false);
    expect(isZoomLevel("1")).toBe(false);
    expect(isZoomLevel(undefined)).toBe(false);
  });
});

describe("the label on the control", () => {
  test("is whole percent, so a drifted float does not read as 66.6667%", () => {
    expect(formatZoom(1)).toBe("100%");
    expect(formatZoom(0.67)).toBe("67%");
    expect(formatZoom(2)).toBe("200%");
    expect(formatZoom(0.666_666)).toBe("67%");
  });

  test("shows something usable even for a value that should never arrive", () => {
    expect(formatZoom(99)).toBe("200%");
    expect(formatZoom(NaN)).toBe("100%");
  });
});
