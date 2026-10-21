/**
 * The wall saying out loud why a login inside a framed pane bounces.
 *
 * Only a wall opened at `127.0.0.1` can see this: once a site is served from a
 * sibling subdomain of the wall's own host the cookies travel again, and on
 * such a wall `/api/embeddability` answers without a verdict for the line to
 * carry. The probe response is stubbed at `fetch`; nothing here mocks a module.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

import { PaneFrame } from "../../src/pane/pane.frame.tsx";
import type { FrameCookieDecision } from "../../src/embed/embed.cookies.ts";
import { useWallStore } from "../../src/pane/pane.store.ts";
import { resetWallStore, settleAsyncWork } from "../fixtures/wall-store.ts";
import {
  MIXED,
  NO_SAMESITE,
  SAFE_IN_FRAME,
} from "../fixtures/set-cookie-headers.ts";
import { classifyFrameCookies } from "../../src/embed/embed.cookies.ts";

const PANE_ID = "p1";
const WAIT = { timeout: 2000 };

let cookiesStub: FrameCookieDecision = { verdict: "unknown" };
const realFetch = globalThis.fetch;

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
    // Both ways out: the wall's own hostname, which this build can give, and
    // the header change, which only the site's owner can.
    expect(note.textContent).toContain("own hostname");
    expect(note.textContent).toContain("SameSite=None; Secure; Partitioned");
    // Advice only: the page is still shown, exactly as it was before this.
    expect(screen.getByTestId(`pane-frame-${PANE_ID}`).getAttribute("src")).toBe(
      "https://dashboard.example/",
    );
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

