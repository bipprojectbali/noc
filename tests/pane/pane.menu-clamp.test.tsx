/**
 * The ⋮ panel is clamped against the window, not against the pane.
 *
 * Found on screen, not in the code: on a 1440x900 wall, splitting the leftmost
 * pane until it is ~84px wide and opening its ⋮ put the panel at x = -148.6.
 * The CSS hangs it from the pane's right edge and grows it leftwards, so a pane
 * at the wall's left edge pushes most of the menu past x = 0 — and `overflow:
 * hidden` on html/body means that part cannot be scrolled to, only lost.
 *
 * The arithmetic is proven directly, because that is the only part that can be:
 * happy-dom measures every element as zero, so the DOM cases here assert what a
 * zero measurement must *not* do (move the panel) and that a supplied rect is
 * acted on at all. Whether the slid panel reads well over a real dashboard is a
 * question for a browser, and a screenshot answered it.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AppShell } from "../../src/app/app.shell.tsx";
import { menuPanelShift } from "../../src/pane/pane.menu-panel.tsx";
import { useWallStore } from "../../src/pane/pane.store.ts";
import { stubRect } from "../fixtures/dom-rect.ts";
import { resetWallStore, settleAsyncWork } from "../fixtures/wall-store.ts";

const ROOT = "root";
const VIEWPORT = { width: 1440, height: 900 };
const realFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ verdict: "allowed", reason: "no framing headers present" }),
      { headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
  resetWallStore(ROOT);
});

afterEach(async () => {
  await settleAsyncWork();
  cleanup();
  globalThis.fetch = realFetch;
});

function rect(left: number, top: number): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  return { left, top, right: left + 224, bottom: top + 320 };
}

describe("menuPanelShift keeps the panel inside the window", () => {
  test("a panel already inside is left alone", () => {
    expect(menuPanelShift(rect(600, 100), VIEWPORT)).toEqual({ x: 0, y: 0 });
  });

  test("the measured bug: a panel hanging off the left is pushed right", () => {
    // The rect observed on screen, rounded: x = -148.6 on an 84px pane at x=0.
    expect(menuPanelShift(rect(-148.625, 0), VIEWPORT).x).toBe(156.625);
  });

  test("a panel hanging off the bottom is lifted, not clipped", () => {
    // A pane in the bottom row: the panel starts below its top edge and the
    // menu is 320px tall, so the last items fall past 900px.
    expect(menuPanelShift(rect(600, 640), VIEWPORT)).toEqual({ x: 0, y: -68 });
  });

  test("a panel flush against the top edge is inside the window", () => {
    // Every top-row pane is at y = 0. The margin puts an escaped edge back; it
    // is not a gap owed to a panel that never left.
    expect(menuPanelShift(rect(600, 0), VIEWPORT)).toEqual({ x: 0, y: 0 });
  });

  test("a panel hanging off the right is pulled back", () => {
    expect(menuPanelShift(rect(1300, 100), VIEWPORT).x).toBe(-92);
  });

  test("a rect that was never laid out asks for no shift", () => {
    // happy-dom's whole DOM looks like this, and so does a panel measured
    // before its first layout. Moving it would be inventing a position.
    expect(menuPanelShift({ left: 0, top: 0, right: 0, bottom: 0 }, VIEWPORT)).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe("the panel acts on what it measures", () => {
  test("a zero-measured panel carries no transform", () => {
    render(<AppShell />);
    fireEvent.click(screen.getByTestId(`pane-menu-button-${ROOT}`));

    expect(screen.getByTestId(`pane-menu-${ROOT}`).style.transform).toBe("");
  });

  test("a panel measured off the left slides back on the next layout", async () => {
    render(<AppShell />);
    // A pane with a page has a site row, which is what makes add-mode — and so
    // a second measurement — reachable.
    await act(async () => {
      useWallStore.getState().submitUrl(ROOT, "https://example.com");
    });
    fireEvent.click(screen.getByTestId(`pane-menu-button-${ROOT}`));
    const panel = screen.getByTestId(`pane-menu-${ROOT}`);
    stubRect(panel, { left: -148.625, top: 0, width: 224, height: 320 });

    // Switching to add-mode changes the panel's height, which is one of the
    // moments it re-measures itself. Any other re-layout does the same.
    fireEvent.click(screen.getByTestId(`pane-site-add-${ROOT}`));

    expect(panel.style.transform).toBe("translate(156.625px, 0px)");
  });
});
