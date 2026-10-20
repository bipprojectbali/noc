import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AppShell } from "../../src/app/app.shell.tsx";
import type { SplitNode } from "../../src/layout/layout.types.ts";
import { useWallStore } from "../../src/pane/pane.store.ts";
import { resetWallStore, settleAsyncWork } from "../fixtures/wall-store.ts";

const ROOT = "root";
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

function treePaneIds(): string[] {
  return Object.values(useWallStore.getState().tree.nodes)
    .filter((node) => node.kind === "pane")
    .map((node) => node.id);
}

function splits(): SplitNode[] {
  return Object.values(useWallStore.getState().tree.nodes).filter(
    (node): node is SplitNode => node.kind === "split",
  );
}

async function loadUrl(paneId: string, url: string): Promise<void> {
  await act(async () => {
    useWallStore.getState().submitUrl(paneId, url);
  });
}

function click(testId: string): void {
  fireEvent.click(screen.getByTestId(testId));
}

describe("the pane controls call the store actions that had no caller", () => {
  test("Split right splits the pane into a row", () => {
    render(<AppShell />);

    click(`pane-split-row-${ROOT}`);

    expect(treePaneIds()).toHaveLength(2);
    expect(splits()).toHaveLength(1);
    expect(splits()[0]?.direction).toBe("row");
    expect(splits()[0]?.children).toContain(ROOT);
  });

  test("Split down splits the pane into a column", () => {
    render(<AppShell />);

    click(`pane-split-column-${ROOT}`);

    expect(splits()[0]?.direction).toBe("column");
  });

  test("splitting from the control leaves the pane's iframe untouched", async () => {
    render(<AppShell />);
    await loadUrl(ROOT, "https://example.com");
    const before = screen.getByTestId(`pane-frame-${ROOT}`);
    const parentBefore = before.parentNode;

    click(`pane-split-row-${ROOT}`);

    // The whole point of the two-layer design: the control must not reload the
    // page it is attached to.
    const after = screen.getByTestId(`pane-frame-${ROOT}`);
    expect(Object.is(before, after)).toBe(true);
    expect(Object.is(parentBefore, after.parentNode)).toBe(true);
    expect(after.getAttribute("src")).toBe("https://example.com/");
  });

  test("Minimise docks the pane and keeps its host and page alive", async () => {
    render(<AppShell />);
    await loadUrl(ROOT, "https://example.com");
    click(`pane-split-row-${ROOT}`);
    const before = screen.getByTestId(`pane-frame-${ROOT}`);

    click(`pane-dock-${ROOT}`);

    expect(useWallStore.getState().tree.dock.map((e) => e.paneId)).toEqual([ROOT]);
    // Docked is not deleted: no slot, same host, same iframe, same page.
    expect(screen.queryByTestId(`slot-${ROOT}`)).toBeNull();
    expect(screen.getByTestId(`pane-host-${ROOT}`)).toBeDefined();
    const after = screen.getByTestId(`pane-frame-${ROOT}`);
    expect(Object.is(before, after)).toBe(true);
    expect(after.getAttribute("src")).toBe("https://example.com/");
  });

  test("Close removes the pane and leaves its neighbour's iframe alone", async () => {
    render(<AppShell />);
    click(`pane-split-row-${ROOT}`);
    const other = treePaneIds().find((id) => id !== ROOT)!;
    await loadUrl(ROOT, "https://example.com");
    const before = screen.getByTestId(`pane-frame-${ROOT}`);
    const parentBefore = before.parentNode;

    click(`pane-close-${other}`);

    expect(screen.queryByTestId(`pane-host-${other}`)).toBeNull();
    expect(treePaneIds()).toEqual([ROOT]);
    const after = screen.getByTestId(`pane-frame-${ROOT}`);
    expect(Object.is(before, after)).toBe(true);
    expect(Object.is(parentBefore, after.parentNode)).toBe(true);
  });

  test("closing the last pane leaves a fresh empty one, never an empty wall", () => {
    render(<AppShell />);

    click(`pane-close-${ROOT}`);

    const remaining = treePaneIds();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).not.toBe(ROOT);
    expect(screen.getByTestId(`pane-host-${remaining[0]}`)).toBeDefined();
  });
});

describe("the control row is reachable whatever the URL bar is doing", () => {
  test("hiding the URL bar keeps the controls, and the way back to the bar", () => {
    render(<AppShell />);

    fireEvent.click(screen.getByTitle("Hide this URL bar"));

    expect(screen.queryByLabelText(`URL for pane ${ROOT}`)).toBeNull();
    expect(screen.getByTestId(`pane-controls-${ROOT}`)).toBeDefined();
    expect(screen.getByTestId(`pane-close-${ROOT}`)).toBeDefined();

    click(`pane-show-urlbar-${ROOT}`);
    expect(screen.getByLabelText(`URL for pane ${ROOT}`)).toBeDefined();
  });
});
