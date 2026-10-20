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

async function loadUrl(paneId: string, url: string): Promise<void> {
  await act(async () => {
    useWallStore.getState().submitUrl(paneId, url);
  });
}

function click(testId: string): void {
  fireEvent.click(screen.getByTestId(testId));
}

/** Splits ROOT twice and returns the two panes created, oldest first. */
function splitTwice(): [string, string] {
  click(`pane-split-row-${ROOT}`);
  const first = treePaneIds().find((id) => id !== ROOT)!;
  click(`pane-split-column-${ROOT}`);
  const second = treePaneIds().find((id) => id !== ROOT && id !== first)!;
  return [first, second];
}

describe("the dock strip is only there when something is docked", () => {
  test("an undocked wall shows no strip", () => {
    render(<AppShell />);
    expect(screen.queryByTestId("pane-dock-strip")).toBeNull();
  });

  test("the strip names a docked pane by its url", async () => {
    render(<AppShell />);
    await loadUrl(ROOT, "https://example.com");
    click(`pane-split-row-${ROOT}`);

    click(`pane-dock-${ROOT}`);

    const entry = screen.getByTestId(`dock-entry-${ROOT}`);
    expect(entry.textContent).toContain("https://example.com/");
  });

  test("a docked pane with no url is still listed", () => {
    render(<AppShell />);
    click(`pane-split-row-${ROOT}`);

    click(`pane-dock-${ROOT}`);

    expect(screen.getByTestId(`dock-entry-${ROOT}`).textContent).toContain(
      "Empty pane",
    );
  });
});

describe("restoring from the strip", () => {
  test("puts the pane back beside the first pane of the tree, page intact", async () => {
    render(<AppShell />);
    const [first, second] = splitTwice();
    await loadUrl(second, "https://example.com");
    const before = screen.getByTestId(`pane-frame-${second}`);
    const parentBefore = before.parentNode;

    click(`pane-dock-${second}`);
    expect(screen.queryByTestId(`slot-${second}`)).toBeNull();

    click(`dock-restore-${second}`);

    // ROOT is the oldest pane still in the tree, so it is the host; `first` is
    // the one the UI cannot offer a way to choose yet.
    const tree = useWallStore.getState().tree;
    const restored = tree.nodes[second];
    const parentSplit = tree.nodes[restored!.parentId!] as SplitNode;
    expect(parentSplit.children).toEqual([ROOT, second]);
    expect(parentSplit.direction).toBe("row");
    expect(tree.dock).toEqual([]);
    // The other tree pane was never offered as a host, and was left alone.
    expect(treePaneIds()).toContain(first);

    // The restored pane is the same DOM node, on the same page as before.
    const after = screen.getByTestId(`pane-frame-${second}`);
    expect(Object.is(before, after)).toBe(true);
    expect(Object.is(parentBefore, after.parentNode)).toBe(true);
    expect(after.getAttribute("src")).toBe("https://example.com/");
    expect(screen.queryByTestId("pane-dock-strip")).toBeNull();
  });

  test("the strip empties one entry at a time", () => {
    render(<AppShell />);
    const [first, second] = splitTwice();

    click(`pane-dock-${first}`);
    click(`pane-dock-${second}`);
    expect(screen.getAllByTestId(/^dock-entry-/)).toHaveLength(2);

    click(`dock-restore-${first}`);

    expect(screen.getAllByTestId(/^dock-entry-/)).toHaveLength(1);
    expect(screen.getByTestId(`dock-entry-${second}`)).toBeDefined();
  });
});

describe("closing from the strip", () => {
  test("deletes the docked pane outright, host and all", () => {
    render(<AppShell />);
    click(`pane-split-row-${ROOT}`);
    click(`pane-dock-${ROOT}`);

    click(`dock-close-${ROOT}`);

    // Without this the pane would be unreachable forever: its own controls are
    // hidden with it, so the strip is the only handle a docked pane has.
    expect(treePaneIds()).not.toContain(ROOT);
    expect(screen.queryByTestId(`pane-host-${ROOT}`)).toBeNull();
    expect(useWallStore.getState().tree.dock).toEqual([]);
    expect(screen.queryByTestId("pane-dock-strip")).toBeNull();
  });
});
