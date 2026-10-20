/**
 * The zoom controls on a real pane, through the real store.
 *
 * What this can show is wiring: the ⋮ row reaches the site the pane is
 * showing, the other pages it holds are left alone, the ends of the ladder
 * disable rather than sit inert, and the magnification lands on the iframe
 * itself rather than on anything around it — re-parenting that element, or
 * putting the factor on the host that already carries the geometry layer's
 * `transform`, is the one way to break what the whole pane design protects.
 *
 * What it cannot show is that anything is magnified. happy-dom measures every
 * element as zero and loads no stylesheet, so "more of the page fits" and "the
 * click still lands where it looks" are answered in a browser, not here.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { PaneFrame } from "../../src/pane/pane.frame.tsx";
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

function openMenu(): void {
  fireEvent.click(screen.getByTestId(`pane-menu-button-${PANE}`));
}

function zoomOf(siteId: string): number {
  const node = useWallStore.getState().tree.nodes[PANE];
  if (node === undefined || node.kind !== "pane") throw new Error("no pane");
  const site = node.sites.find((held) => held.id === siteId);
  if (site === undefined) throw new Error(`no site ${siteId}`);
  return site.zoom;
}

function frameOf(siteId: string): HTMLElement {
  const frame = document.querySelector(`[data-site-id="${siteId}"]`);
  if (frame === null) throw new Error(`no content mounted for site ${siteId}`);
  return frame as HTMLElement;
}

describe("stepping a page's magnification", () => {
  test("a fresh page is at 100% and cannot be reset any further", async () => {
    render(<PaneFrame paneId={PANE} />);
    await giveSites(1);
    openMenu();

    const level = screen.getByTestId(`pane-zoom-level-${PANE}`);
    expect(level.textContent).toBe("100%");
    expect((level as HTMLButtonElement).disabled).toBe(true);
  });

  test("the buttons walk the ladder and the readout follows", async () => {
    render(<PaneFrame paneId={PANE} />);
    const [site] = await giveSites(1);
    openMenu();

    fireEvent.click(screen.getByTestId(`pane-zoom-in-${PANE}`));
    expect(zoomOf(site!)).toBe(1.1);
    expect(screen.getByTestId(`pane-zoom-level-${PANE}`).textContent).toBe("110%");

    fireEvent.click(screen.getByTestId(`pane-zoom-out-${PANE}`));
    fireEvent.click(screen.getByTestId(`pane-zoom-out-${PANE}`));
    expect(zoomOf(site!)).toBe(0.9);
    expect(screen.getByTestId(`pane-zoom-level-${PANE}`).textContent).toBe("90%");
  });

  test("the readout is the way back to 100%", async () => {
    render(<PaneFrame paneId={PANE} />);
    const [site] = await giveSites(1);
    openMenu();

    fireEvent.click(screen.getByTestId(`pane-zoom-out-${PANE}`));
    fireEvent.click(screen.getByTestId(`pane-zoom-out-${PANE}`));
    expect(zoomOf(site!)).not.toBe(1);

    fireEvent.click(screen.getByTestId(`pane-zoom-level-${PANE}`));
    expect(zoomOf(site!)).toBe(1);
    expect((screen.getByTestId(`pane-zoom-level-${PANE}`) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  test("the end of the ladder disables the button rather than ignoring it", async () => {
    render(<PaneFrame paneId={PANE} />);
    const [site] = await giveSites(1);
    openMenu();

    for (let i = 0; i < 20; i += 1) {
      const button = screen.getByTestId(`pane-zoom-in-${PANE}`) as HTMLButtonElement;
      if (button.disabled) break;
      fireEvent.click(button);
    }
    expect(zoomOf(site!)).toBe(2);
    // A button that can be pressed and does nothing reads as broken, and
    // wrapping to 50% from here would be worse than doing nothing.
    expect((screen.getByTestId(`pane-zoom-in-${PANE}`) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByTestId(`pane-zoom-out-${PANE}`) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  test("an empty pane offers the row, inert, rather than hiding it", () => {
    render(<PaneFrame paneId={PANE} />);
    openMenu();

    expect(screen.getByTestId(`pane-zoom-level-${PANE}`).textContent).toBe("100%");
    for (const slug of ["in", "out", "level"]) {
      const button = screen.getByTestId(`pane-zoom-${slug}-${PANE}`) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    }
  });
});

describe("the magnification belongs to one page", () => {
  test("the pane's other pages are not moved with it", async () => {
    render(<PaneFrame paneId={PANE} />);
    const [first, second] = await giveSites(2);
    openMenu();

    fireEvent.click(screen.getByTestId(`pane-zoom-in-${PANE}`));
    expect(zoomOf(second!)).toBe(1.1);
    // The page behind it is a live document at its own size; a pane-wide zoom
    // would have shifted a dashboard nobody was looking at.
    expect(zoomOf(first!)).toBe(1);
  });

  test("switching pages shows that page's own level", async () => {
    render(<PaneFrame paneId={PANE} />);
    const [first, second] = await giveSites(2);
    openMenu();
    fireEvent.click(screen.getByTestId(`pane-zoom-in-${PANE}`));

    // The menu stays open throughout: the row names the page on screen, so it
    // has to follow a switch made while it is up rather than go stale.
    act(() => {
      useWallStore.getState().activateSite(PANE, first!);
    });
    expect(screen.getByTestId(`pane-zoom-level-${PANE}`).textContent).toBe("100%");

    act(() => {
      useWallStore.getState().activateSite(PANE, second!);
    });
    expect(screen.getByTestId(`pane-zoom-level-${PANE}`).textContent).toBe("110%");
  });
});

describe("where the factor lands", () => {
  test("on the iframe itself, and on the same element as before", async () => {
    render(<PaneFrame paneId={PANE} />);
    const [site] = await giveSites(1);
    const before = frameOf(site!);
    const host = before.parentElement;
    openMenu();

    fireEvent.click(screen.getByTestId(`pane-zoom-out-${PANE}`));

    const after = frameOf(site!);
    expect(after.style.zoom).toBe("0.9");
    // The same node, still in the same parent: a wrapper around the iframe, or
    // a remount, reloads the page and costs it its scroll and its session.
    expect(Object.is(before, after)).toBe(true);
    expect(after.parentElement).toBe(host);
    // And nothing was written onto the element above it, which carries the
    // geometry layer's own transform.
    expect(host?.style.zoom ?? "").toBe("");
  });
});
