/**
 * The wall saying out loud why a login inside a framed pane bounces.
 *
 * The native shell is faked at the seam `isNativeHost` sniffs, the same way
 * `pane.strategy.test.tsx` does it, so the real renderer resolution decides
 * which pane is an iframe. Nothing here mocks a module.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

import { PaneFrame } from "../../src/pane/pane.frame.tsx";
import type { FrameCookieDecision } from "../../src/embed/embed.cookies.ts";
import { useWallStore } from "../../src/pane/pane.store.ts";
import { resetWallStore, settleAsyncWork, siteIdsOf } from "../fixtures/wall-store.ts";
import {
  LAX,
  MIXED,
  NO_SAMESITE,
  SAFE_IN_FRAME,
} from "../fixtures/set-cookie-headers.ts";
import { classifyFrameCookies } from "../../src/embed/embed.cookies.ts";

const PANE_ID = "p1";
const WAIT = { timeout: 2000 };

let cookiesStub: FrameCookieDecision = { verdict: "unknown" };
const realFetch = globalThis.fetch;

function enterNativeHost(): void {
  (globalThis.window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
    invoke: () => Promise.resolve(),
  };
}

beforeEach(() => {
  cookiesStub = { verdict: "unknown" };
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        verdict: "allowed",
        reason: "no framing headers present",
        cookies: cookiesStub,
      }),
      { headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
  resetWallStore(PANE_ID);
});

afterEach(async () => {
  await settleAsyncWork();
  cleanup();
  globalThis.fetch = realFetch;
  delete (globalThis.window as unknown as Record<string, unknown>)
    .__TAURI_INTERNALS__;
});

async function submit(raw: string): Promise<void> {
  await act(async () => {
    useWallStore.getState().submitUrl(PANE_ID, raw);
  });
}

function warning(): HTMLElement | null {
  return screen.queryByTestId(`pane-cookie-warning-${PANE_ID}`);
}

describe("an iframe pane says when a session will not survive the frame", () => {
  test("names the cookie and both ways out", async () => {
    cookiesStub = classifyFrameCookies(NO_SAMESITE);
    render(<PaneFrame paneId={PANE_ID} />);
    await submit("https://dashboard.example");

    const note = await waitFor(() => screen.getByTestId(`pane-cookie-warning-${PANE_ID}`), WAIT);
    expect(note.textContent).toContain("sid");
    expect(note.textContent).toContain("no usable SameSite attribute");
    expect(note.textContent).toContain("desktop app");
    expect(note.textContent).toContain("SameSite=None; Secure; Partitioned");
    // Advice only: the page is still shown, exactly as it was before this.
    expect(screen.getByTestId(`pane-frame-${PANE_ID}`).getAttribute("src")).toBe(
      "https://dashboard.example/",
    );
  });

  test("points at the ⋮ menu instead of the app when already in the shell", async () => {
    enterNativeHost();
    cookiesStub = classifyFrameCookies(LAX);
    // `iframe` explicitly: in the shell, `auto` would be served as a webview.
    await act(async () => {
      useWallStore.getState().setPaneStrategy(PANE_ID, "iframe");
    });
    render(<PaneFrame paneId={PANE_ID} />);
    await submit("https://dashboard.example");

    const note = await waitFor(() => screen.getByTestId(`pane-cookie-warning-${PANE_ID}`), WAIT);
    expect(note.textContent).toContain("Webview in its ⋮ menu");
    expect(note.textContent).not.toContain("desktop app");
  });

  test("names only the cookie that fails, not the one beside it", async () => {
    cookiesStub = classifyFrameCookies(MIXED);
    render(<PaneFrame paneId={PANE_ID} />);
    await submit("https://dashboard.example");

    const note = await waitFor(() => screen.getByTestId(`pane-cookie-warning-${PANE_ID}`), WAIT);
    expect(note.textContent).toContain("sid");
    expect(note.textContent).not.toContain("csrf");
  });

  test("stays silent when every cookie survives a frame", async () => {
    cookiesStub = classifyFrameCookies(SAFE_IN_FRAME);
    render(<PaneFrame paneId={PANE_ID} />);
    await submit("https://dashboard.example");

    await waitFor(() => {
      expect(screen.getByTestId(`pane-frame-${PANE_ID}`).getAttribute("src")).toBe(
        "https://dashboard.example/",
      );
    }, WAIT);
    expect(warning()).toBeNull();
  });

  /**
   * The honest limit of the whole feature: a login page that sets nothing on
   * the GET the probe makes produces no evidence, and no evidence must mean
   * silence rather than a guess.
   */
  test("stays silent when the response set no cookie at all", async () => {
    cookiesStub = classifyFrameCookies([]);
    render(<PaneFrame paneId={PANE_ID} />);
    await submit("https://dashboard.example");

    await waitFor(() => {
      expect(screen.getByTestId(`pane-frame-${PANE_ID}`).getAttribute("src")).toBe(
        "https://dashboard.example/",
      );
    }, WAIT);
    expect(warning()).toBeNull();
  });
});

describe("a native webview pane never shows it", () => {
  /**
   * The verdict is pushed straight into load state rather than left to the
   * probe, because the store skips probing a webview pane entirely. Without
   * that, this would pass on the absence of a probe and prove nothing about
   * the boundary; with it, the only thing that can keep the line off screen is
   * the renderer check in `pane.frame`.
   */
  test("a blocked verdict on a webview pane renders nothing", async () => {
    enterNativeHost();
    render(<PaneFrame paneId={PANE_ID} />);
    await submit("https://dashboard.example");
    await act(async () => {
      useWallStore.getState().setPaneStrategy(PANE_ID, "webview");
    });

    const siteId = siteIdsOf(PANE_ID)[0];
    expect(siteId).toBeDefined();
    await act(async () => {
      useWallStore.getState().dispatchLoad(siteId as string, {
        type: "probe-settled",
        url: "https://dashboard.example/",
        verdict: "unknown",
        reason: "native webview: framing headers do not apply",
        cookies: classifyFrameCookies(NO_SAMESITE),
      });
    });

    expect(warning()).toBeNull();
  });
});
