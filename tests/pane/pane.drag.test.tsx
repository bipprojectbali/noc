/**
 * Dragging a pane by its ⋮ and what it does to the wall: the gesture, and the
 * tree edit it lands. What the gesture costs and shows while it runs is
 * `pane.drag-feedback.test`; the rig both share is `fixtures/pane-drag`.
 *
 * What none of this proves: that the gesture feels like dragging. happy-dom
 * measures nothing, so every rect here was supplied by the test.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AppShell } from "../../src/app/app.shell.tsx";
import { usePaneDragStore } from "../../src/pane/pane.drag.ts";
import { useWallStore } from "../../src/pane/pane.store.ts";
import {
  countingSuppressor,
  lift,
  move,
  paneIds,
  press,
  release,
  resetPaneDragRig,
  ROOT,
  rootSplit,
  splitWallInTwo,
} from "../fixtures/pane-drag.ts";
import { resetWallStore, settleAsyncWork } from "../fixtures/wall-store.ts";

const realFetch = globalThis.fetch;
let unregister: () => void;

beforeEach(() => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ verdict: "allowed", reason: "no framing headers present" }),
      { headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
  resetWallStore(ROOT);
  resetPaneDragRig();
  // Registered even where it is not asserted on: without a port the wall has
  // nothing to suspend, and a drag would run under conditions no wall has.
  unregister = countingSuppressor().unregister;
});

afterEach(async () => {
  await settleAsyncWork();
  cleanup();
  unregister();
  resetPaneDragRig();
  globalThis.fetch = realFetch;
});

describe("⋮ still opens the menu, and only a real movement takes that away", () => {
  test("a press and release without movement opens the menu", () => {
    render(<AppShell />);

    press(ROOT, 10, 10);
    release(ROOT, 10, 10);

    expect(screen.getByTestId(`pane-menu-${ROOT}`)).toBeDefined();
    expect(usePaneDragStore.getState().drag).toBeNull();
  });

  test("a wobble under the threshold is still a click", () => {
    render(<AppShell />);

    press(ROOT, 10, 10);
    move(12, 11);
    release(ROOT, 12, 11);

    expect(screen.getByTestId(`pane-menu-${ROOT}`)).toBeDefined();
  });

  test("a drag swallows the click it ends with, so no menu opens", () => {
    render(<AppShell />);
    const other = splitWallInTwo();

    press(ROOT, 10, 10);
    move(390, 50);
    release(ROOT, 390, 50);

    expect(screen.queryByTestId(`pane-menu-${ROOT}`)).toBeNull();
    expect(screen.queryByTestId(`pane-menu-${other}`)).toBeNull();
  });

  test("a keyboard click is never swallowed", () => {
    render(<AppShell />);
    splitWallInTwo();
    press(ROOT, 10, 10);
    move(390, 50);
    lift(390, 50);

    // Enter on a focused button fires a click with `detail: 0` and no pointer
    // events at all, so it can never be the tail of a drag.
    fireEvent.click(screen.getByTestId(`pane-menu-button-${ROOT}`), { detail: 0 });

    expect(screen.getByTestId(`pane-menu-${ROOT}`)).toBeDefined();
  });

  test("a press with the wrong button is not a handle at all", () => {
    render(<AppShell />);
    splitWallInTwo();

    fireEvent.pointerDown(screen.getByTestId(`pane-menu-button-${ROOT}`), {
      button: 2,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    move(390, 50);

    expect(usePaneDragStore.getState().drag).toBeNull();
  });
});

describe("a drop on an edge moves the pane there", () => {
  test("dropping on the right edge puts the pane after the target", () => {
    render(<AppShell />);
    const other = splitWallInTwo();
    expect(rootSplit().children).toEqual([ROOT, other]);

    press(ROOT, 10, 10);
    move(390, 50);
    release(ROOT, 390, 50);

    // Same two panes, same ids, opposite order: the move is a tree edit only.
    expect(paneIds().sort()).toEqual([ROOT, other].sort());
    expect(rootSplit().children).toEqual([other, ROOT]);
  });

  test("dropping on the top edge splits the target into a column", () => {
    render(<AppShell />);
    const other = splitWallInTwo();

    press(ROOT, 10, 10);
    move(300, 5);
    release(ROOT, 300, 5);

    const root = rootSplit();
    expect(root.direction).toBe("column");
    expect(root.children).toEqual([ROOT, other]);
  });

  test("the dragged pane keeps its id, its createdAt and its iframe", async () => {
    render(<AppShell />);
    const other = splitWallInTwo();
    await act(async () => {
      useWallStore.getState().submitUrl(ROOT, "https://example.com");
    });
    const before = screen.getByTestId(`pane-frame-${ROOT}`);
    const parentBefore = before.parentNode;
    const paneBefore = useWallStore.getState().tree.nodes[ROOT];

    press(ROOT, 10, 10);
    move(390, 50);
    release(ROOT, 390, 50);

    // The whole reason the move is a tree edit: the page must not reload, which
    // means React must not have been given a reason to rebuild the node.
    const after = screen.getByTestId(`pane-frame-${ROOT}`);
    expect(Object.is(before, after)).toBe(true);
    expect(Object.is(parentBefore, after.parentNode)).toBe(true);
    expect(after.getAttribute("src")).toBe("https://example.com/");
    // Only the parent split differs: the pane layer sorts on `createdAt` and
    // falls back to `id`, so a move that touched either would reorder the flat
    // list and make React rebuild every host after it.
    expect(useWallStore.getState().tree.nodes[ROOT]).toEqual({
      ...paneBefore!,
      parentId: rootSplit().id,
    });
    expect(other).not.toBe(ROOT);
  });
});

describe("a drop in the middle trades the two panes", () => {
  test("the tree keeps its shape and the panes change slots", async () => {
    render(<AppShell />);
    const other = splitWallInTwo();
    await act(async () => {
      useWallStore.getState().submitUrl(ROOT, "https://example.com");
      // Lopsided on purpose: a swap trades slots, so each pane has to come out
      // holding the other's share. Even halves would prove nothing.
      useWallStore.getState().resizeSplit(rootSplit().id, 0.7);
    });
    const before = screen.getByTestId(`pane-frame-${ROOT}`);
    const splitBefore = rootSplit();

    press(ROOT, 10, 10);
    move(300, 50);
    release(ROOT, 300, 50);

    const splitAfter = rootSplit();
    expect(splitAfter.id).toBe(splitBefore.id);
    expect(splitAfter.direction).toBe(splitBefore.direction);
    expect(splitAfter.sizes).toEqual(splitBefore.sizes);
    expect(splitAfter.children).toEqual([other, ROOT]);
    expect(Object.is(before, screen.getByTestId(`pane-frame-${ROOT}`))).toBe(true);
  });

  test("a drop on the pane the drag started from changes nothing", () => {
    render(<AppShell />);
    const other = splitWallInTwo();
    const treeBefore = useWallStore.getState().tree;

    press(ROOT, 10, 10);
    move(100, 50);
    release(ROOT, 100, 50);

    expect(rootSplit().children).toEqual([ROOT, other]);
    expect(useWallStore.getState().tree).toEqual(treeBefore);
  });
});

describe("a drag that lands nowhere leaves the wall alone", () => {
  test("releasing off the wall is a drag undone", () => {
    render(<AppShell />);
    const other = splitWallInTwo();
    const treeBefore = useWallStore.getState().tree;

    press(ROOT, 10, 10);
    move(390, 50);
    move(1000, 1000);
    release(ROOT, 1000, 1000);

    expect(rootSplit().children).toEqual([ROOT, other]);
    expect(useWallStore.getState().tree).toEqual(treeBefore);
  });

  test("a pane deleted mid-drag is not dropped onto", () => {
    render(<AppShell />);
    const other = splitWallInTwo();

    press(ROOT, 10, 10);
    move(390, 50);
    act(() => {
      useWallStore.getState().deletePane(other);
    });
    lift(390, 50);

    // The target is read off the DOM during the move and can be gone by the
    // time the pointer comes up; `rearrangePane` refuses rather than throwing.
    expect(paneIds()).toEqual([ROOT]);
  });
});
