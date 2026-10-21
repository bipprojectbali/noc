/**
 * What the pane points its iframe at once the wall is served from its own proxy
 * host — and, just as important, what the user still sees.
 *
 * The two must differ: the frame has to load from a sibling of the wall for the
 * site's cookie to be sent back at all, while the address the operator typed is
 * the only one worth showing them. A proxy hostname leaking into the URL field
 * would be an address they cannot copy, cannot read, and would try to correct.
 *
 * The wall's own location is what decides this, so each test sets it.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PaneFrame } from "../../src/pane/pane.frame.tsx";
import { useWallStore } from "../../src/pane/pane.store.ts";
import { paneLoadState } from "../../src/pane/pane.store-sites.ts";
import { siteLabel } from "../../src/proxy/proxy.label.ts";
import { resetWallStore, settleAsyncWork } from "../fixtures/wall-store.ts";

const PANE_ID = "p1";
const WAIT = { timeout: 2000 };
const SITE = "https://grafana.internal/d/abc?from=now-6h";

const realFetch = globalThis.fetch;
const originalHref = window.location.href;

/** happy-dom lets a test move the document, which is the input under test. */
function setWallUrl(href: string): void {
  (
    window as unknown as { happyDOM: { setURL(url: string): void } }
  ).happyDOM.setURL(href);
}

beforeEach(() => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ verdict: "allowed", reason: "no framing headers" }), {
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
  resetWallStore(PANE_ID);
});

afterEach(async () => {
  await settleAsyncWork();
  cleanup();
  globalThis.fetch = realFetch;
  setWallUrl(originalHref);
});

async function showSite(): Promise<void> {
  render(<PaneFrame paneId={PANE_ID} />);
  await act(async () => {
    useWallStore.getState().submitUrl(PANE_ID, SITE);
  });
}

function frameSrc(): string | null {
  return screen.getByTestId(`pane-frame-${PANE_ID}`).getAttribute("src");
}

describe("a wall served from its own proxy host", () => {
  beforeEach(() => setWallUrl("http://wall.noc.localhost:7788/"));

  test("frames the site through a sibling hostname, keeping path and query", async () => {
    await showSite();
    const label = siteLabel("https://grafana.internal");
    await waitFor(() => {
      expect(frameSrc()).toBe(
        `http://${label}.noc.localhost:7788/d/abc?from=now-6h`,
      );
    }, WAIT);
  });

  test("the url the user sees and edits is still the one they typed", async () => {
    await showSite();
    await waitFor(() => expect(frameSrc()).toContain(".noc.localhost"), WAIT);

    fireEvent.click(screen.getByTestId(`pane-menu-button-${PANE_ID}`));
    const input = screen.getByLabelText(`URL for pane ${PANE_ID}`) as HTMLInputElement;
    expect(input.value).toBe("https://grafana.internal/d/abc?from=now-6h");
  });

  test("the pane reaches ready, so the proxied src does not strand the load state", async () => {
    // The load reducer discards any event whose url is not the one it holds, and
    // the frame's own src is not that url — so `frame-loaded` has to carry the
    // typed address or the pane would sit in `loading` forever.
    await showSite();
    await waitFor(() => expect(frameSrc()).toContain(".noc.localhost"), WAIT);

    fireEvent.load(screen.getByTestId(`pane-frame-${PANE_ID}`));
    await waitFor(() => {
      expect(paneLoadState(useWallStore.getState(), PANE_ID).kind).toBe("ready");
    }, WAIT);
  });
});

describe("a wall reached some other way", () => {
  test("a loopback wall frames the typed url unchanged", async () => {
    // Where the proxy cannot work, nothing about the pane changes. A wall
    // typed as `127.0.0.1` is normally moved to the proxy host; this is the
    // case where it was told to stay, and the pane still has to work.
    setWallUrl("http://127.0.0.1:7788/");
    await showSite();
    await waitFor(() => {
      expect(frameSrc()).toBe("https://grafana.internal/d/abc?from=now-6h");
    }, WAIT);
  });
});
