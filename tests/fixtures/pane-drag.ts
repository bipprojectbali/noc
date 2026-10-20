/**
 * The rig a pane-drag test needs, shared by the two files that drive one.
 *
 * Two things have to be faked, and they are really one: happy-dom measures
 * every element as zero and hit-tests nothing, so the pane hosts are given
 * rects with `stubRect` and `elementFromPoint` is answered out of those same
 * rects. Everything downstream — threshold, zone, store call, suppressor,
 * cancel paths — is the shipping code.
 *
 * The suppressor is watched by registering a counting port, the way
 * `pane.menu.test` does: `resize.pointer-capture` is a registry of ports, and a
 * test port sees exactly what a renderer would.
 */

import { act, fireEvent, screen } from "@testing-library/react";

import { isPane, type SplitNode } from "../../src/layout/layout.types.ts";
import { usePaneDragStore } from "../../src/pane/pane.drag.ts";
import { useWallStore } from "../../src/pane/pane.store.ts";
import {
  registerPanePointerSuppressor,
  type PanePointerSuppressor,
} from "../../src/resize/resize.pointer-capture.ts";
import { stubRect, type StubRect } from "./dom-rect.ts";

export const ROOT = "root";
/** Two panes side by side, 200×100 each, the right one starting at x=200. */
export const LEFT_RECT: StubRect = { left: 0, top: 0, width: 200, height: 100 };
export const RIGHT_RECT: StubRect = { left: 200, top: 0, width: 200, height: 100 };

const realElementFromPoint = document.elementFromPoint.bind(document);
/** The same pointer throughout: a drag is one pointer by definition. */
const POINTER_ID = 1;

export type SuppressorCounts = { suspends: number; resumes: number };

/**
 * Registers a port that counts what the wall is asked to do, and hands back the
 * counts and the way to take it out again. The registry is module-level, so a
 * test that forgets the second half leaks into the next one.
 */
export function countingSuppressor(): {
  counts: SuppressorCounts;
  unregister: () => void;
} {
  const counts: SuppressorCounts = { suspends: 0, resumes: 0 };
  const port: PanePointerSuppressor = {
    suspend: () => {
      counts.suspends += 1;
    },
    resume: () => {
      counts.resumes += 1;
    },
  };
  return { counts, unregister: registerPanePointerSuppressor(port) };
}

export function paneIds(): string[] {
  return Object.values(useWallStore.getState().tree.nodes)
    .filter(isPane)
    .map((pane) => pane.id);
}

export function rootSplit(): SplitNode {
  const tree = useWallStore.getState().tree;
  const root = tree.nodes[tree.rootId];
  if (root === undefined || root.kind !== "split") {
    throw new Error("the wall is not split");
  }
  return root;
}

/**
 * Splits the rendered wall in two, gives both halves a rect and the hit-testing
 * that goes with them, and returns the id of the pane that is not `ROOT`.
 *
 * Through the store rather than through the menu, because opening the menu
 * takes the suppressor too and these tests count suppressor calls.
 */
export function splitWallInTwo(): string {
  act(() => {
    useWallStore.getState().splitPane(ROOT, "row");
  });
  const other = paneIds().find((id) => id !== ROOT)!;

  const placed = [
    { rect: LEFT_RECT, host: screen.getByTestId(`pane-host-${ROOT}`) },
    { rect: RIGHT_RECT, host: screen.getByTestId(`pane-host-${other}`) },
  ];
  for (const { rect, host } of placed) stubRect(host, rect);

  document.elementFromPoint = (x: number, y: number) =>
    placed.find(
      ({ rect }) =>
        x >= rect.left &&
        x < rect.left + rect.width &&
        y >= rect.top &&
        y < rect.top + rect.height,
    )?.host ?? null;

  return other;
}

export function press(paneId: string, x: number, y: number): void {
  fireEvent.pointerDown(screen.getByTestId(`pane-menu-button-${paneId}`), {
    button: 0,
    pointerId: POINTER_ID,
    clientX: x,
    clientY: y,
  });
}

export function move(x: number, y: number): void {
  fireEvent.pointerMove(window, { pointerId: POINTER_ID, clientX: x, clientY: y });
}

export function lift(x: number, y: number): void {
  fireEvent.pointerUp(window, { pointerId: POINTER_ID, clientX: x, clientY: y });
}

/**
 * Lets go the way a browser does: the pointer comes up and a click follows on
 * the button that was pressed. A drag has to swallow that click, so leaving it
 * out would hide the bug it exists to prevent.
 */
export function release(paneId: string, x: number, y: number): void {
  lift(x, y);
  fireEvent.click(screen.getByTestId(`pane-menu-button-${paneId}`), { detail: 1 });
}

/** Puts back everything a drag test reaches outside its own render. */
export function resetPaneDragRig(): void {
  usePaneDragStore.setState({ drag: null });
  document.elementFromPoint = realElementFromPoint;
}
