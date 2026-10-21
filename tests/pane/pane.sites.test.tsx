/**
 * A pane with several pages: all of them mounted, one of them shown.
 *
 * The thing worth testing is not that the right page appears — it is that the
 * other one *stays*. A pane that unmounted the page it was leaving would look
 * identical in a screenshot and be useless in practice: every switch would cost
 * a reload, a scroll position and, on a logged-in dashboard, a session.
 *
 * So the test compares element identity across a switch: the same node, still
 * pointed at the same address, is the only evidence the page was never rebuilt.
 *
 * happy-dom measures every element as zero and loads no stylesheet, so nothing
 * here says anything about whether the pips fit or can be seen. That is on the
 * README's open items, where it stays until someone looks at a screen.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { PaneFrame } from "../../src/pane/pane.frame.tsx";
import { MAX_INLINE_SITE_PIPS } from "../../src/pane/pane.site-switcher.tsx";
import { useWallStore } from "../../src/pane/pane.store.ts";
import { resetWallStore, settleAsyncWork, siteIdsOf } from "../fixtures/wall-store.ts";

const PANE = "w1";
const realFetch = globalThis.fetch;

beforeEach(() => {
  resetWallStore(PANE);
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ verdict: "allowed", reason: "no framing headers present" }),
      { headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
});

afterEach(async () => {
  await settleAsyncWork();
  cleanup();
  globalThis.fetch = realFetch;
});

/** Gives the pane `count` pages, the last of them active. */
async function giveSites(count: number): Promise<string[]> {
  for (let i = 0; i < count; i += 1) {
    const raw = `https://site${i}.example`;
    await act(async () => {
      if (i === 0) useWallStore.getState().submitUrl(PANE, raw);
      else useWallStore.getState().addSite(PANE, raw);
    });
  }
  await settleAsyncWork();
  return siteIdsOf(PANE);
}

/** The frame of a site, whichever testid it carries at the moment. */
function frameOf(siteId: string): HTMLElement {
  const frame = document
    .querySelector(`[data-site-id="${siteId}"]`);
  if (frame === null) throw new Error(`no content mounted for site ${siteId}`);
  return frame as HTMLElement;
}

function shown(siteId: string): boolean {
  return !frameOf(siteId).className.includes("--hidden");
}

describe("a pane mounts every page it holds", () => {
  test("two sites are two live iframes, and only one of them is shown", async () => {
    render(<PaneFrame paneId={PANE} />);
    const [first, second] = await giveSites(2);

    // Both have a src: the page being left is loaded, not parked.
    expect(frameOf(first!).getAttribute("src")).toBe("https://site0.example/");
    expect(frameOf(second!).getAttribute("src")).toBe("https://site1.example/");
    expect(shown(second!)).toBe(true);
    expect(shown(first!)).toBe(false);
  });

  test("switching shows the other page without rebuilding either of them", async () => {
    render(<PaneFrame paneId={PANE} />);
    const [first, second] = await giveSites(2);
    const before = { first: frameOf(first!), second: frameOf(second!) };

    fireEvent.click(screen.getByTestId(`pane-site-${first}`));

    expect(shown(first!)).toBe(true);
    expect(shown(second!)).toBe(false);
    // The same two elements, in the same place, still pointed at the same
    // pages. A new node here would mean a reload nobody asked for.
    expect(Object.is(before.first, frameOf(first!))).toBe(true);
    expect(Object.is(before.second, frameOf(second!))).toBe(true);
    expect(frameOf(second!).getAttribute("src")).toBe("https://site1.example/");
  });
});

describe("the switch control is on the pane, next to ⋮", () => {
  test("one page is not a choice, so there is no switcher", async () => {
    render(<PaneFrame paneId={PANE} />);
    await giveSites(1);

    expect(screen.queryByTestId(`pane-site-switcher-${PANE}`)).toBeNull();
  });

  test("it sits in the pane's chrome, before ⋮", async () => {
    render(<PaneFrame paneId={PANE} />);
    await giveSites(2);

    const chrome = screen.getByTestId(`pane-chrome-${PANE}`);
    const switcher = screen.getByTestId(`pane-site-switcher-${PANE}`);
    expect(switcher.parentElement).toBe(chrome);
    // Reading order, and therefore tab order: pages first, then the menu.
    expect(
      switcher.compareDocumentPosition(
        screen.getByTestId(`pane-menu-button-${PANE}`),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
  });

  test("past the pips it becomes a counter that advances and wraps", async () => {
    render(<PaneFrame paneId={PANE} />);
    const sites = await giveSites(MAX_INLINE_SITE_PIPS + 1);
    const total = sites.length;

    // No pips at this length: they would stop being targets on a narrow pane.
    expect(screen.queryByTestId(`pane-site-${sites[0]}`)).toBeNull();
    const chip = screen.getByTestId(`pane-site-toggle-${PANE}`);
    expect(chip.textContent).toBe(`${total}/${total}`);

    fireEvent.click(chip);
    expect(screen.getByTestId(`pane-site-toggle-${PANE}`).textContent).toBe(
      `1/${total}`,
    );
    fireEvent.click(screen.getByTestId(`pane-site-toggle-${PANE}`));
    expect(screen.getByTestId(`pane-site-toggle-${PANE}`).textContent).toBe(
      `2/${total}`,
    );
  });
});

describe("the ⋮ panel names the pages and is the only way to add one", () => {
  test("a row per page picks it by name, and × drops it", async () => {
    render(<PaneFrame paneId={PANE} />);
    const [first, second] = await giveSites(2);
    fireEvent.click(screen.getByTestId(`pane-menu-button-${PANE}`));

    fireEvent.click(screen.getByTestId(`pane-site-row-${first}`));
    expect(shown(first!)).toBe(true);

    fireEvent.click(screen.getByTestId(`pane-site-remove-${second}`));

    expect(siteIdsOf(PANE)).toEqual([first!]);
    expect(document.querySelector(`[data-site-id="${second}"]`)).toBeNull();
  });

  test("add mode makes the panel's one field append instead of repoint", async () => {
    render(<PaneFrame paneId={PANE} />);
    const [first] = await giveSites(1);
    fireEvent.click(screen.getByTestId(`pane-menu-button-${PANE}`));

    fireEvent.click(screen.getByTestId(`pane-site-add-${PANE}`));
    const field = screen.getByLabelText(`New site URL for pane ${PANE}`);
    await act(async () => {
      fireEvent.change(field, { target: { value: "https://added.example" } });
      fireEvent.submit(field.closest("form")!);
    });

    // The page that was there is still there, and the new one is on screen.
    expect(siteIdsOf(PANE)).toHaveLength(2);
    expect(siteIdsOf(PANE)[0]).toBe(first!);
    expect(frameOf(siteIdsOf(PANE)[1]!).getAttribute("src")).toBe(
      "https://added.example/",
    );
  });
});
