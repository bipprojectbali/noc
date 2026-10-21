/**
 * What the control renders, which is mostly a question about what it does
 * *not* render. On one monitor — the common case, and the only one happy-dom
 * can present — it has to be a single button: a list offering the screen the
 * wall is already filling is noise sitting permanently over a dashboard, and
 * that corner is expensive.
 *
 * The other half is that an absent Window Management API changes none of this.
 * The API is Chromium-only, so for Firefox and Safari the degraded path is the
 * only path, and the failure to avoid is not a missing feature but a throw
 * during render taking the wall down with it.
 *
 * Nothing here says where any of it is on screen. happy-dom measures every
 * element as zero and `requestFullscreen` does not exist in it, so whether the
 * button is legible over a bright dashboard, and whether the wall actually
 * fills a monitor, are questions only a running browser answers.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";

import { WallFullscreen } from "../../src/display/display.fullscreen.tsx";
import { settleAsyncWork } from "../fixtures/wall-store.ts";

afterEach(cleanup);

/** The permission probe is async, so the first paint is never the last one. */
async function renderSettled() {
  render(<WallFullscreen />);
  await settleAsyncWork();
}

describe("on a single monitor", () => {
  test("offers one button and no list of one", async () => {
    await renderSettled();
    expect(screen.getByTestId("wall-fullscreen-toggle")).toBeTruthy();
    expect(screen.queryByTestId("wall-fullscreen-screen-0")).toBeNull();
  });

  test("says what the button does, since its label is a glyph", async () => {
    await renderSettled();
    expect(screen.getByTestId("wall-fullscreen-toggle").getAttribute("aria-label")).toBe(
      "Fill the screen",
    );
  });

  test("nothing is wrong, so nothing is said", async () => {
    await renderSettled();
    expect(screen.queryByTestId("wall-fullscreen-problem")).toBeNull();
  });
});

describe("without the Window Management API", () => {
  test("still renders the button that does plain fullscreen", async () => {
    const host = globalThis as { getScreenDetails?: unknown };
    const saved = host.getScreenDetails;
    delete host.getScreenDetails;
    try {
      await renderSettled();
      expect(screen.getByTestId("wall-fullscreen-toggle")).toBeTruthy();
      // No prompt to chase either: there is nothing behind it to grant.
      expect(screen.queryByTestId("wall-fullscreen-find")).toBeNull();
    } finally {
      host.getScreenDetails = saved;
    }
  });
});
