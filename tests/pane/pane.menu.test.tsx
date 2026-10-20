/**
 * The pane menu: how it opens and closes, and what it costs while it is open.
 *
 * The suppressor is observed by registering a counting one of its own rather
 * than by reaching into the webview renderer — `resize.pointer-capture` is a
 * registry of ports, and a test that registers one sees exactly what a real
 * renderer would. The registry lives at module level, so each test takes its
 * own back out again.
 *
 * Nothing here says anything about layout. happy-dom measures every element as
 * zero; whether the panel is really visible over a pane is a question only a
 * running app can answer.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AppShell } from "../../src/app/app.shell.tsx";
import type { SplitNode } from "../../src/layout/layout.types.ts";
import { useWallStore } from "../../src/pane/pane.store.ts";
import {
  registerPanePointerSuppressor,
  type PanePointerSuppressor,
} from "../../src/resize/resize.pointer-capture.ts";
import { resetWallStore, settleAsyncWork } from "../fixtures/wall-store.ts";

const ROOT = "root";
const realFetch = globalThis.fetch;

let suppressor: { suspends: number; resumes: number };
let unregister: () => void;

beforeEach(() => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ verdict: "allowed", reason: "no framing headers present" }),
      { headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
  resetWallStore(ROOT);
  suppressor = { suspends: 0, resumes: 0 };
  const port: PanePointerSuppressor = {
    suspend: () => {
      suppressor.suspends += 1;
    },
    resume: () => {
      suppressor.resumes += 1;
    },
  };
  unregister = registerPanePointerSuppressor(port);
});

afterEach(async () => {
  await settleAsyncWork();
  cleanup();
  unregister();
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

function openMenu(paneId: string): void {
  click(`pane-menu-button-${paneId}`);
}

/** Submit is fired on the form: happy-dom does not bubble it up from the input. */
function typeAndSubmit(raw: string): void {
  const input = screen.getByLabelText(`URL for pane ${ROOT}`);
  fireEvent.change(input, { target: { value: raw } });
  fireEvent.submit(input.closest("form")!);
}

describe("⋮ is the only permanent chrome, and it opens the rest", () => {
  test("a closed pane shows the button and nothing else", () => {
    render(<AppShell />);

    expect(screen.getByTestId(`pane-menu-button-${ROOT}`)).toBeDefined();
    expect(screen.queryByTestId(`pane-menu-${ROOT}`)).toBeNull();
    expect(screen.queryByLabelText(`URL for pane ${ROOT}`)).toBeNull();
    expect(screen.queryByTestId(`pane-close-${ROOT}`)).toBeNull();
  });

  test("the chrome carries no host label of its own", async () => {
    render(<AppShell />);
    await loadUrl(ROOT, "https://example.com/some/deep/path");

    // The label was what made a wall of panes look stitched together. The host
    // survives only as the button's tooltip, which costs no pixels.
    const chrome = screen.getByTestId(`pane-chrome-${ROOT}`);
    expect(chrome.textContent).not.toContain("example.com");
    expect(screen.getByTestId(`pane-menu-button-${ROOT}`).getAttribute("title")).toBe(
      "https://example.com/some/deep/path",
    );
  });

  test("the iframe pane reserves no height for its chrome", () => {
    render(<AppShell />);

    // happy-dom measures nothing, so this asserts the mechanism rather than the
    // result: an absolutely positioned chrome is the only kind that takes no
    // room from the body. Whether it is really flush is a question for a
    // running browser.
    expect(screen.getByTestId(`pane-chrome-${ROOT}`).className).toContain(
      "noc-pane__chrome--floating",
    );
  });

  test("⋮ opens the menu and ⋮ again closes it", () => {
    render(<AppShell />);

    openMenu(ROOT);
    expect(screen.getByTestId(`pane-menu-${ROOT}`)).toBeDefined();
    expect(screen.getByLabelText(`URL for pane ${ROOT}`)).toBeDefined();

    openMenu(ROOT);
    expect(screen.queryByTestId(`pane-menu-${ROOT}`)).toBeNull();
  });

  test("right-click on the chrome opens the same menu", () => {
    render(<AppShell />);

    fireEvent.contextMenu(screen.getByTestId(`pane-chrome-${ROOT}`));

    expect(screen.getByTestId(`pane-menu-${ROOT}`)).toBeDefined();
  });

  test("right-click on ⋮ itself opens it too", () => {
    render(<AppShell />);

    // On a floating chrome the padding around the button is transparent to the
    // pointer, so the button is the only part of the chrome a right-click can
    // land on. The handler stays on the container and the event bubbles to it;
    // this is what says the ⋮ still answers once its box stops taking input.
    fireEvent.contextMenu(screen.getByTestId(`pane-menu-button-${ROOT}`));

    expect(screen.getByTestId(`pane-menu-${ROOT}`)).toBeDefined();
  });

  test("right-click on an empty pane's body opens it too", () => {
    render(<AppShell />);

    fireEvent.contextMenu(screen.getByTestId(`pane-empty-${ROOT}`));

    expect(screen.getByTestId(`pane-menu-${ROOT}`)).toBeDefined();
  });

  test("Escape closes it", () => {
    render(<AppShell />);
    openMenu(ROOT);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByTestId(`pane-menu-${ROOT}`)).toBeNull();
  });

  test("a click outside closes it", () => {
    render(<AppShell />);
    openMenu(ROOT);

    fireEvent.mouseDown(document.body);

    expect(screen.queryByTestId(`pane-menu-${ROOT}`)).toBeNull();
  });

  test("a click inside leaves it open", () => {
    render(<AppShell />);
    openMenu(ROOT);

    fireEvent.mouseDown(screen.getByLabelText(`URL for pane ${ROOT}`));

    expect(screen.getByTestId(`pane-menu-${ROOT}`)).toBeDefined();
  });

  test("focus follows the menu in and comes back out to ⋮", () => {
    render(<AppShell />);

    openMenu(ROOT);
    expect(document.activeElement).toBe(
      screen.getByLabelText(`URL for pane ${ROOT}`),
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(document.activeElement).toBe(
      screen.getByTestId(`pane-menu-button-${ROOT}`),
    );
  });

  test("each pane's menu is its own", () => {
    render(<AppShell />);
    openMenu(ROOT);
    click(`pane-split-row-${ROOT}`);
    const other = treePaneIds().find((id) => id !== ROOT)!;

    openMenu(other);

    expect(screen.getByTestId(`pane-menu-${other}`)).toBeDefined();
    expect(screen.queryByTestId(`pane-menu-${ROOT}`)).toBeNull();
  });
});

describe("an open menu suppresses the panes, and every close path releases", () => {
  test("opening suspends exactly once", () => {
    render(<AppShell />);

    openMenu(ROOT);

    expect(suppressor).toEqual({ suspends: 1, resumes: 0 });
  });

  test("the ⋮ button again resumes", () => {
    render(<AppShell />);
    openMenu(ROOT);

    openMenu(ROOT);

    expect(suppressor).toEqual({ suspends: 1, resumes: 1 });
  });

  test("Escape resumes", () => {
    render(<AppShell />);
    openMenu(ROOT);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(suppressor).toEqual({ suspends: 1, resumes: 1 });
  });

  test("a click outside resumes", () => {
    render(<AppShell />);
    openMenu(ROOT);

    fireEvent.mouseDown(document.body);

    expect(suppressor).toEqual({ suspends: 1, resumes: 1 });
  });

  test("a split from the menu closes it and resumes", () => {
    render(<AppShell />);
    openMenu(ROOT);

    click(`pane-split-row-${ROOT}`);

    expect(screen.queryByTestId(`pane-menu-${ROOT}`)).toBeNull();
    expect(suppressor).toEqual({ suspends: 1, resumes: 1 });
  });

  test("Close deletes the pane with its menu up, and still resumes", () => {
    render(<AppShell />);
    openMenu(ROOT);
    click(`pane-split-row-${ROOT}`);
    const other = treePaneIds().find((id) => id !== ROOT)!;
    openMenu(other);
    const suspendsBefore = suppressor.suspends;

    click(`pane-close-${other}`);

    // Nothing in the menu releases by hand: the pane is unmounted mid-menu and
    // the effect cleanup is the only thing that gets the wall back.
    expect(screen.queryByTestId(`pane-host-${other}`)).toBeNull();
    expect(suppressor.resumes).toBe(suspendsBefore);
  });
});

describe("the menu items call the store actions", () => {
  test("Split right splits the pane into a row", () => {
    render(<AppShell />);
    openMenu(ROOT);

    click(`pane-split-row-${ROOT}`);

    expect(treePaneIds()).toHaveLength(2);
    expect(splits()).toHaveLength(1);
    expect(splits()[0]?.direction).toBe("row");
    expect(splits()[0]?.children).toContain(ROOT);
  });

  test("Split down splits the pane into a column", () => {
    render(<AppShell />);
    openMenu(ROOT);

    click(`pane-split-column-${ROOT}`);

    expect(splits()[0]?.direction).toBe("column");
  });

  test("splitting from the menu leaves the pane's iframe untouched", async () => {
    render(<AppShell />);
    await loadUrl(ROOT, "https://example.com");
    const before = screen.getByTestId(`pane-frame-${ROOT}`);
    const parentBefore = before.parentNode;

    openMenu(ROOT);
    click(`pane-split-row-${ROOT}`);

    // The whole point of the two-layer design: the control must not reload the
    // page it is attached to.
    const after = screen.getByTestId(`pane-frame-${ROOT}`);
    expect(Object.is(before, after)).toBe(true);
    expect(Object.is(parentBefore, after.parentNode)).toBe(true);
    expect(after.getAttribute("src")).toBe("https://example.com/");
  });

  test("Close removes the pane and leaves its neighbour's iframe alone", async () => {
    render(<AppShell />);
    openMenu(ROOT);
    click(`pane-split-row-${ROOT}`);
    const other = treePaneIds().find((id) => id !== ROOT)!;
    await loadUrl(ROOT, "https://example.com");
    const before = screen.getByTestId(`pane-frame-${ROOT}`);
    const parentBefore = before.parentNode;

    openMenu(other);
    click(`pane-close-${other}`);

    expect(screen.queryByTestId(`pane-host-${other}`)).toBeNull();
    expect(treePaneIds()).toEqual([ROOT]);
    const after = screen.getByTestId(`pane-frame-${ROOT}`);
    expect(Object.is(before, after)).toBe(true);
    expect(Object.is(parentBefore, after.parentNode)).toBe(true);
  });

  test("closing the last pane leaves a fresh empty one, never an empty wall", () => {
    render(<AppShell />);
    openMenu(ROOT);

    click(`pane-close-${ROOT}`);

    const remaining = treePaneIds();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).not.toBe(ROOT);
    expect(screen.getByTestId(`pane-host-${remaining[0]}`)).toBeDefined();
  });

  test("Go closes the menu, but a rejected address keeps it open to say why", () => {
    render(<AppShell />);
    openMenu(ROOT);

    typeAndSubmit("javascript:alert(1)");

    expect(screen.getByTestId(`pane-menu-${ROOT}`)).toBeDefined();
    // `hidden: true` because every pane host here is `visibility: hidden`: the
    // wall is mounted whole and happy-dom measures no slot to place it in, so
    // the default accessibility filter would hide the whole pane from the query.
    expect(
      screen.getByRole("alert", { hidden: true }).textContent,
    ).toContain("Only http and https");

    typeAndSubmit("https://example.com");

    expect(screen.queryByTestId(`pane-menu-${ROOT}`)).toBeNull();
    expect(suppressor.resumes).toBe(suppressor.suspends);
  });

  test("minimise is gone: no dock strip, no dock button", () => {
    render(<AppShell />);
    openMenu(ROOT);

    expect(screen.queryByTestId("pane-dock-strip")).toBeNull();
    expect(screen.queryByTestId(`pane-dock-${ROOT}`)).toBeNull();
    expect(useWallStore.getState().tree.dock).toEqual([]);
  });
});
