import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AppShell } from "../../src/app/app.shell.tsx";
import { createTree } from "../../src/layout/layout.tree.ts";
import type { SplitNode } from "../../src/layout/layout.types.ts";
import { useWallStore } from "../../src/pane/pane.store.ts";
import { stubRect } from "../fixtures/dom-rect.ts";
import {
  RESIZING_BODY_CLASS,
  registerPanePointerSuppressor,
  resumePanePointerCapture,
  suspendPanePointerCapture,
} from "../../src/resize/resize.pointer-capture.ts";

const ROOT = "root";
const CONTAINER_WIDTH = 1000;
const SPLITTER_WIDTH = 6;
/** Container minus splitter: the extent the two children actually share. */
const TRACK = CONTAINER_WIDTH - SPLITTER_WIDTH;

beforeEach(() => {
  useWallStore.setState({
    tree: createTree(() => ROOT, 1),
    load: {},
    urlError: {},
  });
  document.body.classList.remove(RESIZING_BODY_CLASS);
});

afterEach(() => {
  cleanup();
  document.body.classList.remove(RESIZING_BODY_CLASS);
});

function splitNode(): SplitNode {
  const node = Object.values(useWallStore.getState().tree.nodes).find(
    (candidate) => candidate.kind === "split",
  );
  if (node === undefined) throw new Error("expected a split in the tree");
  return node as SplitNode;
}

function firstFraction(): number {
  return splitNode().sizes[0];
}

function treePaneIds(): string[] {
  return Object.values(useWallStore.getState().tree.nodes)
    .filter((node) => node.kind === "pane")
    .map((node) => node.id);
}

/** A rendered wall split in two, with measurable rects on the split and handle. */
async function splitScene(direction: "row" | "column" = "row") {
  render(<AppShell />);
  await act(async () => {
    useWallStore.getState().splitPane(ROOT, direction);
  });

  const splitId = splitNode().id;
  const splitter = screen.getByTestId(`splitter-${splitId}`);
  const container = splitter.parentElement;
  if (container === null) throw new Error("splitter has no split container");

  const vertical = direction === "column";
  stubRect(container, {
    left: 0,
    top: 0,
    width: vertical ? 600 : CONTAINER_WIDTH,
    height: vertical ? CONTAINER_WIDTH : 600,
  });
  stubRect(splitter, {
    left: 0,
    top: 0,
    width: vertical ? 600 : SPLITTER_WIDTH,
    height: vertical ? SPLITTER_WIDTH : 600,
  });

  return { splitId, splitter };
}

function down(splitter: Element, x: number, y: number): void {
  fireEvent.pointerDown(splitter, { pointerId: 1, button: 0, clientX: x, clientY: y });
}

function move(splitter: Element, x: number, y: number): void {
  fireEvent.pointerMove(splitter, { pointerId: 1, clientX: x, clientY: y });
}

describe("constraint 2: the panes stop taking the cursor during a drag", () => {
  test("pointerdown puts the class on <body>", async () => {
    const { splitter } = await splitScene();
    expect(document.body.classList.contains(RESIZING_BODY_CLASS)).toBe(false);

    down(splitter, 500, 300);

    // On <body>, not in React state: re-rendering the pane layer to quiet the
    // frames could disturb the very frames this protects.
    expect(document.body.classList.contains(RESIZING_BODY_CLASS)).toBe(true);
  });

  test("pointerup takes the class off again", async () => {
    const { splitter } = await splitScene();
    down(splitter, 500, 300);
    fireEvent.pointerUp(splitter, { pointerId: 1 });
    expect(document.body.classList.contains(RESIZING_BODY_CLASS)).toBe(false);
  });

  test("pointercancel takes the class off again", async () => {
    const { splitter } = await splitScene();
    down(splitter, 500, 300);
    // A cancelled pointer never delivers pointerup, so this must stand alone.
    fireEvent.pointerCancel(splitter, { pointerId: 1 });
    expect(document.body.classList.contains(RESIZING_BODY_CLASS)).toBe(false);
  });

  test("losing window focus takes the class off again", async () => {
    const { splitter } = await splitScene();
    down(splitter, 500, 300);
    fireEvent.blur(window);
    expect(document.body.classList.contains(RESIZING_BODY_CLASS)).toBe(false);
  });

  test("a move after the drag ended does not resize anything", async () => {
    const { splitter } = await splitScene();
    down(splitter, 500, 300);
    fireEvent.pointerUp(splitter, { pointerId: 1 });
    const settled = firstFraction();

    move(splitter, 900, 300);
    expect(firstFraction()).toBe(settled);
  });

  test("a secondary button never starts a drag", async () => {
    const { splitter } = await splitScene();
    fireEvent.pointerDown(splitter, {
      pointerId: 1,
      button: 2,
      clientX: 500,
      clientY: 300,
    });
    expect(document.body.classList.contains(RESIZING_BODY_CLASS)).toBe(false);
  });

  test("a second pointer lifting does not end the drag", async () => {
    const { splitter } = await splitScene("row");
    down(splitter, 500, 300);

    fireEvent.pointerUp(splitter, { pointerId: 2 });
    fireEvent.pointerCancel(splitter, { pointerId: 2 });
    expect(document.body.classList.contains(RESIZING_BODY_CLASS)).toBe(true);

    // The first pointer is still down, so its moves must still resize.
    move(splitter, 500 + TRACK / 10, 300);
    expect(firstFraction()).toBeCloseTo(0.6, 10);
  });

  test("losing the splitter mid-drag releases the panes too", async () => {
    const { splitter } = await splitScene();
    down(splitter, 500, 300);
    expect(document.body.classList.contains(RESIZING_BODY_CLASS)).toBe(true);

    // Deleting the sibling collapses the split, which unmounts the handle. No
    // pointerup ever arrives, so the unmount is the only chance to clean up.
    const sibling = treePaneIds().find((id) => id !== ROOT);
    if (sibling === undefined) throw new Error("expected a second pane");
    await act(async () => {
      useWallStore.getState().deletePane(sibling);
    });

    expect(screen.queryByTestId(/^splitter-/)).toBeNull();
    expect(document.body.classList.contains(RESIZING_BODY_CLASS)).toBe(false);
  });

  test("a move after the splitter is gone reaches no listener", async () => {
    const { splitter } = await splitScene();
    down(splitter, 500, 300);
    const sibling = treePaneIds().find((id) => id !== ROOT);
    if (sibling === undefined) throw new Error("expected a second pane");
    await act(async () => {
      useWallStore.getState().deletePane(sibling);
    });

    // A listener left attached would resize a split that is no longer in the
    // tree, and the tree throws on an unknown node rather than ignoring it.
    expect(() =>
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 900, clientY: 300 }),
    ).not.toThrow();
    expect(
      Object.values(useWallStore.getState().tree.nodes).some(
        (node) => node.kind === "split",
      ),
    ).toBe(false);
  });
});

describe("one drag at a time", () => {
  test("a second pointer on the handle does not take over the live drag", async () => {
    const { splitter } = await splitScene("row");
    down(splitter, 500, 300);

    // Two fingers on the same handle. The second press must be ignored outright:
    // taking over would strand the first session's window listeners.
    fireEvent.pointerDown(splitter, {
      pointerId: 2,
      button: 0,
      clientX: 800,
      clientY: 300,
    });

    move(splitter, 500 + TRACK / 10, 300);
    expect(firstFraction()).toBeCloseTo(0.6, 10);

    fireEvent.pointerMove(splitter, { pointerId: 2, clientX: 900, clientY: 300 });
    expect(firstFraction()).toBeCloseTo(0.6, 10);
  });

  test("the handle takes focus, so Escape is heard once a pane has been clicked", async () => {
    const { splitter } = await splitScene("row");
    const elsewhere = document.createElement("input");
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    expect(document.activeElement).toBe(elsewhere);

    down(splitter, 500, 300);

    // Escape is listened for on this window. Focus left inside a pane's iframe
    // would swallow the keydown, so the handle claims it for the drag.
    expect(document.activeElement).toBe(splitter);
    elsewhere.remove();
  });
});

describe("the pointer-capture seam", () => {
  test("a registered suppressor is suspended and resumed with the drag", () => {
    const calls: string[] = [];
    const unregister = registerPanePointerSuppressor({
      suspend: () => calls.push("suspend"),
      resume: () => calls.push("resume"),
    });

    try {
      suspendPanePointerCapture();
      resumePanePointerCapture();
    } finally {
      unregister();
    }
    expect(calls).toEqual(["suspend", "resume"]);

    // Once unregistered it must go quiet, or a dead renderer keeps being called.
    suspendPanePointerCapture();
    resumePanePointerCapture();
    expect(calls).toEqual(["suspend", "resume"]);
  });

  test("the built-in iframe suppressor still drives the body class", () => {
    suspendPanePointerCapture();
    expect(document.body.classList.contains(RESIZING_BODY_CLASS)).toBe(true);
    resumePanePointerCapture();
    expect(document.body.classList.contains(RESIZING_BODY_CLASS)).toBe(false);
  });
});

describe("drag arithmetic through the real component", () => {
  test("dragging a row splitter right grows the first pane", async () => {
    const { splitter } = await splitScene("row");
    expect(firstFraction()).toBe(0.5);

    down(splitter, 500, 300);
    move(splitter, 500 + TRACK / 10, 300);

    expect(firstFraction()).toBeCloseTo(0.6, 10);
  });

  test("dragging a column splitter down grows the first pane", async () => {
    const { splitter } = await splitScene("column");
    down(splitter, 300, 500);
    move(splitter, 300, 500 + TRACK / 10);

    expect(firstFraction()).toBeCloseTo(0.6, 10);
  });

  test("the two fractions always still sum to one", async () => {
    const { splitter } = await splitScene("row");
    down(splitter, 500, 300);
    move(splitter, 820, 300);
    fireEvent.pointerUp(splitter, { pointerId: 1 });

    const [first, second] = splitNode().sizes;
    expect(first + second).toBeCloseTo(1, 10);
  });

  test("dragging past the edge clamps instead of collapsing a pane", async () => {
    const { splitter } = await splitScene("row");
    down(splitter, 500, 300);
    move(splitter, -100_000, 300);

    expect(firstFraction()).toBeGreaterThan(0);
    expect(firstFraction()).toBeLessThan(0.1);
  });

  test("a move from a different pointer is ignored", async () => {
    const { splitter } = await splitScene("row");
    down(splitter, 500, 300);
    fireEvent.pointerMove(splitter, { pointerId: 99, clientX: 900, clientY: 300 });
    expect(firstFraction()).toBe(0.5);
  });
});

describe("Escape cancels the drag", () => {
  test("Escape puts the fraction back and ends the session", async () => {
    const { splitter } = await splitScene("row");
    const before = firstFraction();

    down(splitter, 500, 300);
    move(splitter, 800, 300);
    expect(firstFraction()).not.toBe(before);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(firstFraction()).toBe(before);
    expect(document.body.classList.contains(RESIZING_BODY_CLASS)).toBe(false);
  });

  test("a move after Escape does not resume the drag", async () => {
    const { splitter } = await splitScene("row");
    const before = firstFraction();

    down(splitter, 500, 300);
    move(splitter, 800, 300);
    fireEvent.keyDown(window, { key: "Escape" });
    move(splitter, 900, 300);

    expect(firstFraction()).toBe(before);
  });

  test("Escape with no drag in progress changes nothing", async () => {
    await splitScene("row");
    const before = firstFraction();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(firstFraction()).toBe(before);
  });

  test("another key does not cancel the drag", async () => {
    const { splitter } = await splitScene("row");
    down(splitter, 500, 300);
    move(splitter, 800, 300);
    const dragged = firstFraction();

    fireEvent.keyDown(window, { key: "a" });

    expect(firstFraction()).toBe(dragged);
    expect(document.body.classList.contains(RESIZING_BODY_CLASS)).toBe(true);
  });
});

describe("the splitter lives in the layout layer", () => {
  test("it is a sibling of both children, not inside a slot", async () => {
    const { splitId, splitter } = await splitScene("row");
    const container = splitter.parentElement;

    expect(container?.getAttribute("data-testid")).toBe(`split-${splitId}`);
    const classes = [...(container?.children ?? [])].map((c) => c.className);
    expect(classes).toEqual([
      "noc-split__child",
      "noc-splitter noc-splitter--row",
      "noc-split__child",
    ]);

    // Slots stay empty: chrome and handles never nest inside a pane's slot.
    for (const slot of screen.getAllByTestId(/^slot-/)) {
      expect(slot.children).toHaveLength(0);
    }
  });

  test("a wall with no split has no splitter", () => {
    render(<AppShell />);
    expect(screen.queryByTestId(/^splitter-/)).toBeNull();
  });
});
