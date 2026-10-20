/**
 * What a pane drag costs the wall while it runs, and what it shows for it.
 *
 * The two are one subject: the overlay is only legal because the suppressor is
 * held, which hides every native webview, and the suppressor is only bearable
 * because the overlay says why the wall went quiet. The tree edit a drag lands
 * is `pane.drag.test`; the rig both share is `fixtures/pane-drag`.
 *
 * Every drag here is started on a two-pane wall whose rects the test supplied.
 * Whether the highlight is legible over a real site, and whether a wall mixing
 * live iframes with blanked webviews reads as anything but broken, are
 * questions only a running app answers.
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
  press,
  release,
  resetPaneDragRig,
  ROOT,
  rootSplit,
  splitWallInTwo,
  type SuppressorCounts,
} from "../fixtures/pane-drag.ts";
import { resetWallStore, settleAsyncWork } from "../fixtures/wall-store.ts";

let suppressor: SuppressorCounts;
let unregister: () => void;

beforeEach(() => {
  resetWallStore(ROOT);
  resetPaneDragRig();
  ({ counts: suppressor, unregister } = countingSuppressor());
});

afterEach(async () => {
  await settleAsyncWork();
  cleanup();
  unregister();
  resetPaneDragRig();
});

describe("the wall is suppressed for exactly as long as the drag runs", () => {
  test("a press alone suppresses nothing", () => {
    render(<AppShell />);
    splitWallInTwo();

    press(ROOT, 10, 10);

    expect(suppressor).toEqual({ suspends: 0, resumes: 0 });
  });

  test("crossing the threshold suspends once, and the drop resumes once", () => {
    render(<AppShell />);
    splitWallInTwo();

    press(ROOT, 10, 10);
    move(390, 50);
    expect(suppressor).toEqual({ suspends: 1, resumes: 0 });

    // Every further move is still one drag, not a new hold per event.
    move(380, 60);
    move(370, 70);
    expect(suppressor).toEqual({ suspends: 1, resumes: 0 });

    release(ROOT, 370, 70);
    expect(suppressor).toEqual({ suspends: 1, resumes: 1 });
  });

  test("Escape cancels the drag and resumes", () => {
    render(<AppShell />);
    const other = splitWallInTwo();

    press(ROOT, 10, 10);
    move(390, 50);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(usePaneDragStore.getState().drag).toBeNull();
    expect(rootSplit().children).toEqual([ROOT, other]);
    expect(suppressor).toEqual({ suspends: 1, resumes: 1 });

    // The pointer coming up after the cancel must not land the drag again.
    lift(390, 50);
    expect(rootSplit().children).toEqual([ROOT, other]);
    expect(suppressor).toEqual({ suspends: 1, resumes: 1 });
  });

  test("losing the window cancels the drag and resumes", () => {
    render(<AppShell />);
    const other = splitWallInTwo();

    press(ROOT, 10, 10);
    move(390, 50);
    fireEvent.blur(window);

    expect(rootSplit().children).toEqual([ROOT, other]);
    expect(suppressor).toEqual({ suspends: 1, resumes: 1 });
  });

  test("a cancelled pointer cancels the drag and resumes", () => {
    render(<AppShell />);
    const other = splitWallInTwo();

    press(ROOT, 10, 10);
    move(390, 50);
    fireEvent.pointerCancel(window, { pointerId: 1, clientX: 390, clientY: 50 });

    expect(rootSplit().children).toEqual([ROOT, other]);
    expect(suppressor).toEqual({ suspends: 1, resumes: 1 });
  });

  test("the pane being deleted mid-drag resumes too", () => {
    render(<AppShell />);
    splitWallInTwo();

    press(ROOT, 10, 10);
    move(390, 50);
    act(() => {
      useWallStore.getState().deletePane(ROOT);
    });

    // Nothing releases by hand: the handle unmounts with its pane and the
    // effect cleanup is the only thing that gets the wall back.
    expect(suppressor).toEqual({ suspends: 1, resumes: 1 });
  });
});

describe("the drop overlay says what is about to happen", () => {
  test("nothing is drawn until a drag starts", () => {
    render(<AppShell />);
    splitWallInTwo();

    press(ROOT, 10, 10);

    expect(screen.queryByTestId(`pane-drop-${ROOT}`)).toBeNull();
  });

  test("the source, the target and its zone are all marked", () => {
    render(<AppShell />);
    const other = splitWallInTwo();

    press(ROOT, 10, 10);
    move(390, 50);

    const source = screen.getByTestId(`pane-drop-${ROOT}`);
    const target = screen.getByTestId(`pane-drop-${other}`);
    expect(source.getAttribute("data-drop-role")).toBe("source");
    expect(target.getAttribute("data-drop-role")).toBe("target");
    expect(target.getAttribute("data-drop-zone")).toBe("right");
  });

  test("the zone follows the pointer across the target", () => {
    render(<AppShell />);
    const other = splitWallInTwo();

    press(ROOT, 10, 10);
    move(390, 50);
    move(300, 50);

    expect(
      screen.getByTestId(`pane-drop-${other}`).getAttribute("data-drop-zone"),
    ).toBe("center");
  });

  test("a pane that is neither end of the drag is still outlined", () => {
    render(<AppShell />);
    const other = splitWallInTwo();

    press(ROOT, 10, 10);
    move(1000, 1000);

    // Off the wall: nothing is a target, and the other pane — blank if it is a
    // webview — still has to read as a pane rather than as something broken.
    expect(
      screen.getByTestId(`pane-drop-${other}`).getAttribute("data-drop-role"),
    ).toBe("idle");
  });

  test("it is gone once the drag ends", () => {
    render(<AppShell />);
    splitWallInTwo();

    press(ROOT, 10, 10);
    move(390, 50);
    release(ROOT, 390, 50);

    expect(screen.queryByTestId(`pane-drop-${ROOT}`)).toBeNull();
  });
});
