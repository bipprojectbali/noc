import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AppShell } from "../../src/app/app.shell.tsx";
import type { SplitNode } from "../../src/layout/layout.types.ts";
import { useWallStore } from "../../src/pane/pane.store.ts";
import { stubRect } from "../fixtures/dom-rect.ts";
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
  // Settles probes the test started, so none lands in the next test's store.
  await settleAsyncWork();
  cleanup();
  globalThis.fetch = realFetch;
});

function frameOf(paneId: string): HTMLIFrameElement {
  return screen.getByTestId(`pane-frame-${paneId}`) as HTMLIFrameElement;
}

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

describe("constraint 1: a pane's iframe survives every layout change", () => {
  test("splitting a pane keeps the very same iframe node and parent", async () => {
    render(<AppShell />);
    await loadUrl(ROOT, "https://example.com");

    const before = frameOf(ROOT);
    const parentBefore = before.parentNode;
    const srcBefore = before.getAttribute("src");
    expect(srcBefore).toBe("https://example.com/");

    await act(async () => {
      useWallStore.getState().splitPane(ROOT, "row");
    });

    const after = frameOf(ROOT);
    // The identity assertion is the whole point of the two-layer design.
    expect(Object.is(before, after)).toBe(true);
    expect(Object.is(parentBefore, after.parentNode)).toBe(true);
    expect(after.getAttribute("src")).toBe(srcBefore);
    expect(treePaneIds()).toHaveLength(2);
  });

  test("the iframe survives a nested split of its own subtree", async () => {
    render(<AppShell />);
    await loadUrl(ROOT, "https://example.com");
    const before = frameOf(ROOT);
    const parentBefore = before.parentNode;

    await act(async () => {
      useWallStore.getState().splitPane(ROOT, "row");
    });
    await act(async () => {
      useWallStore.getState().splitPane(ROOT, "column");
    });
    await act(async () => {
      useWallStore.getState().splitPane(ROOT, "row");
    });

    const after = frameOf(ROOT);
    expect(Object.is(before, after)).toBe(true);
    expect(Object.is(parentBefore, after.parentNode)).toBe(true);
    expect(after.getAttribute("src")).toBe("https://example.com/");
  });

  test("docking and restoring keeps the iframe and its page", async () => {
    render(<AppShell />);
    await loadUrl(ROOT, "https://example.com");
    const before = frameOf(ROOT);
    const parentBefore = before.parentNode;

    await act(async () => {
      useWallStore.getState().splitPane(ROOT, "row");
    });
    const sibling = treePaneIds().find((id) => id !== ROOT)!;

    await act(async () => {
      useWallStore.getState().dockPane(ROOT);
    });
    expect(useWallStore.getState().tree.dock.map((e) => e.paneId)).toEqual([ROOT]);
    // Docked, so it has no slot — but the node is untouched.
    expect(Object.is(before, frameOf(ROOT))).toBe(true);

    await act(async () => {
      useWallStore.getState().undockPane(ROOT, sibling, "column");
    });

    const after = frameOf(ROOT);
    expect(Object.is(before, after)).toBe(true);
    expect(Object.is(parentBefore, after.parentNode)).toBe(true);
    expect(after.getAttribute("src")).toBe("https://example.com/");
  });

  test("deleting a sibling does not disturb the surviving pane's iframe", async () => {
    render(<AppShell />);
    await act(async () => {
      useWallStore.getState().splitPane(ROOT, "row");
    });
    const sibling = treePaneIds().find((id) => id !== ROOT)!;
    await loadUrl(ROOT, "https://example.com");

    const before = frameOf(ROOT);
    const parentBefore = before.parentNode;

    await act(async () => {
      useWallStore.getState().deletePane(sibling);
    });

    const after = frameOf(ROOT);
    expect(Object.is(before, after)).toBe(true);
    expect(Object.is(parentBefore, after.parentNode)).toBe(true);
    expect(after.getAttribute("src")).toBe("https://example.com/");
    expect(treePaneIds()).toEqual([ROOT]);
  });

  test("a whole drag-resize session leaves the iframe untouched", async () => {
    render(<AppShell />);
    await loadUrl(ROOT, "https://example.com");
    await act(async () => {
      useWallStore.getState().splitPane(ROOT, "row");
    });

    const split = Object.values(useWallStore.getState().tree.nodes).find(
      (node) => node.kind === "split",
    ) as SplitNode;
    const splitter = screen.getByTestId(`splitter-${split.id}`);
    const container = splitter.parentElement!;
    stubRect(container, { left: 0, top: 0, width: 1000, height: 600 });
    stubRect(splitter, { left: 497, top: 0, width: 6, height: 600 });

    const before = frameOf(ROOT);
    const parentBefore = before.parentNode;

    // A resize re-renders the layout layer on every move. The pane layer must
    // sit it out entirely.
    fireEvent.pointerDown(splitter, {
      pointerId: 1,
      button: 0,
      clientX: 500,
      clientY: 300,
    });
    for (const x of [520, 560, 610, 680, 740]) {
      fireEvent.pointerMove(splitter, { pointerId: 1, clientX: x, clientY: 300 });
    }
    fireEvent.pointerUp(splitter, { pointerId: 1 });

    const sizes = (useWallStore.getState().tree.nodes[split.id] as SplitNode).sizes;
    expect(sizes[0]).toBeGreaterThan(0.5);

    const after = frameOf(ROOT);
    expect(Object.is(before, after)).toBe(true);
    expect(Object.is(parentBefore, after.parentNode)).toBe(true);
    expect(after.getAttribute("src")).toBe("https://example.com/");
  });

  test("deleting a pane removes its iframe and its transient state", async () => {
    render(<AppShell />);
    await act(async () => {
      useWallStore.getState().splitPane(ROOT, "row");
    });
    const sibling = treePaneIds().find((id) => id !== ROOT)!;
    await loadUrl(sibling, "https://example.com");
    expect(useWallStore.getState().load[sibling]).toBeDefined();

    await act(async () => {
      useWallStore.getState().deletePane(sibling);
    });

    expect(screen.queryByTestId(`pane-frame-${sibling}`)).toBeNull();
    expect(useWallStore.getState().load[sibling]).toBeUndefined();
    expect(useWallStore.getState().urlError[sibling]).toBeUndefined();
  });
});

describe("pane layer order is creation order and never shifts", () => {
  test("a new pane appends after the existing ones", async () => {
    render(<AppShell />);

    await act(async () => {
      useWallStore.getState().splitPane(ROOT, "row");
    });
    const firstOrder = screen
      .getAllByTestId(/^pane-host-/)
      .map((host) => host.getAttribute("data-pane-host"));
    expect(firstOrder[0]).toBe(ROOT);

    await act(async () => {
      useWallStore.getState().splitPane(ROOT, "column");
    });
    const secondOrder = screen
      .getAllByTestId(/^pane-host-/)
      .map((host) => host.getAttribute("data-pane-host"));

    // Existing hosts keep their positions; the new one is appended.
    expect(secondOrder.slice(0, firstOrder.length)).toEqual(firstOrder);
    expect(secondOrder).toHaveLength(firstOrder.length + 1);
  });

  test("splits inside one millisecond still only append", async () => {
    render(<AppShell />);
    const created = [ROOT];

    // Nothing is awaited between these splits, so they share a millisecond —
    // all the resolution a wall clock has. Ordering panes by anything that can
    // tie here puts a later pane before an earlier one, and React then moves a
    // mounted host, which reloads the page inside its iframe.
    await act(async () => {
      for (let i = 0; i < 20; i += 1) {
        const before = new Set(treePaneIds());
        useWallStore.getState().splitPane(ROOT, i % 2 === 0 ? "row" : "column");
        created.push(treePaneIds().find((id) => !before.has(id))!);
      }
    });

    const hosts = screen
      .getAllByTestId(/^pane-host-/)
      .map((host) => host.getAttribute("data-pane-host"));
    expect(hosts).toEqual(created);
  });
});

describe("the layout layer renders slots, not panes", () => {
  test("each tree pane gets exactly one slot, and a docked pane gets none", async () => {
    render(<AppShell />);
    await act(async () => {
      useWallStore.getState().splitPane(ROOT, "row");
    });

    const slots = screen.getAllByTestId(/^slot-/);
    expect(slots).toHaveLength(2);
    for (const slot of slots) {
      // A slot must stay empty: pane content here would tie the iframe to the tree.
      expect(slot.children).toHaveLength(0);
    }

    await act(async () => {
      useWallStore.getState().dockPane(ROOT);
    });
    expect(screen.queryByTestId(`slot-${ROOT}`)).toBeNull();
    expect(screen.getByTestId(`pane-host-${ROOT}`)).toBeDefined();
  });
});
