import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { PaneFrame } from "../../src/pane/pane.frame.tsx";
import { useWallStore } from "../../src/pane/pane.store.ts";
import type { EmbedVerdict } from "../../src/embed/embed.classifier.ts";
import { resetWallStore, settleAsyncWork } from "../fixtures/wall-store.ts";

const PANE_ID = "p1";

/**
 * How long a `waitFor` may poll for an outcome that depends on the probe chain.
 *
 * The probe here is an in-memory stub that resolves in a few milliseconds, so
 * the real cost is React rendering after the dispatch. Bun's default of 1000 ms
 * leaves little room if the machine pauses that work. 2000 ms allows for a
 * pause of that kind, while a genuine stall still fails within the run. This is
 * a chosen budget, not a measured figure: no timing was recorded to set it.
 */
const PROBE_WAIT_MS = 2000;
const WAIT = { timeout: PROBE_WAIT_MS };

type ProbeStub = { verdict: EmbedVerdict; reason: string };

let probeStub: ProbeStub = { verdict: "allowed", reason: "no framing headers present" };
let probeCalls: string[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  probeCalls = [];
  probeStub = { verdict: "allowed", reason: "no framing headers present" };
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    probeCalls.push(url);
    return new Response(JSON.stringify(probeStub), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  resetWallStore(PANE_ID);
});

afterEach(async () => {
  // Probes still in flight are settled first, while the tree is still mounted,
  // so none of them can land in the next test's store.
  await settleAsyncWork();
  cleanup();
  globalThis.fetch = realFetch;
});

/** The URL field lives in the menu now, so a test that wants it opens it. */
function openMenu(): void {
  fireEvent.click(screen.getByTestId(`pane-menu-button-${PANE_ID}`));
}

function urlInput(): HTMLInputElement {
  return screen.getByLabelText(`URL for pane ${PANE_ID}`) as HTMLInputElement;
}

/** Store mutations go through act() so React has flushed before assertions run. */
async function submit(raw: string): Promise<void> {
  await act(async () => {
    useWallStore.getState().submitUrl(PANE_ID, raw);
  });
}

describe("PaneFrame renders the pane shell", () => {
  test("starts empty and says how to fill it", () => {
    render(<PaneFrame paneId={PANE_ID} />);
    expect(screen.getByText(/Empty pane\. Right-click here/)).toBeDefined();
    openMenu();
    expect(urlInput().value).toBe("");
  });

  test("mounts the iframe even while the pane is empty", () => {
    render(<PaneFrame paneId={PANE_ID} />);
    const frame = screen.getByTestId(`pane-frame-${PANE_ID}`);
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("src")).toBeNull();
    expect(frame.className).toContain("noc-pane__frame--hidden");
  });
});

describe("PaneFrame shows an allowed target", () => {
  test("probes the url and then points the iframe at it", async () => {
    render(<PaneFrame paneId={PANE_ID} />);
    await submit("https://example.com");

    await waitFor(() => {
      expect(
        screen.getByTestId(`pane-frame-${PANE_ID}`).getAttribute("src"),
      ).toBe("https://example.com/");
    }, WAIT);
    expect(probeCalls).toHaveLength(1);
    expect(probeCalls[0]).toContain(encodeURIComponent("https://example.com/"));
    expect(
      screen.getByTestId(`pane-frame-${PANE_ID}`).className,
    ).not.toContain("--hidden");
  });

  test("normalizes a bare host before loading it", async () => {
    render(<PaneFrame paneId={PANE_ID} />);
    await submit("info.cern.ch");

    await waitFor(() => {
      expect(
        screen.getByTestId(`pane-frame-${PANE_ID}`).getAttribute("src"),
      ).toBe("https://info.cern.ch/");
    }, WAIT);
  });
});

describe("PaneFrame shows an explicit refusal, never a blank box", () => {
  test("renders the refusal with the header that caused it", async () => {
    probeStub = { verdict: "refused", reason: "x-frame-options: deny" };
    render(<PaneFrame paneId={PANE_ID} />);
    await submit("https://github.com");

    const refusal = await waitFor(
      () => screen.getByTestId(`pane-refused-${PANE_ID}`),
      WAIT,
    );
    expect(refusal.textContent).toContain("github.com refuses to be framed");
    expect(refusal.textContent).toContain("x-frame-options: deny");
    // The frame is hidden rather than removed, and was never pointed at the target.
    const frame = screen.getByTestId(`pane-frame-${PANE_ID}`);
    expect(frame.className).toContain("--hidden");
    expect(frame.getAttribute("src")).toBeNull();
  });

  test("a failed probe is optimistic and still attempts the frame", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 500 })) as unknown as typeof fetch;
    render(<PaneFrame paneId={PANE_ID} />);
    await submit("https://example.com");

    await waitFor(() => {
      expect(
        screen.getByTestId(`pane-frame-${PANE_ID}`).getAttribute("src"),
      ).toBe("https://example.com/");
    }, WAIT);
  });
});

describe("PaneFrame validates input before touching the iframe", () => {
  test("rejects javascript: and reports why", async () => {
    render(<PaneFrame paneId={PANE_ID} />);
    openMenu();
    await submit("javascript:alert(1)");

    const alert = await waitFor(() => screen.getByRole("alert"), WAIT);
    expect(alert.textContent).toContain("Only http and https");
    expect(screen.getByTestId(`pane-frame-${PANE_ID}`).getAttribute("src")).toBeNull();
    expect(probeCalls).toHaveLength(0);
  });

  test("rejects an empty submission", async () => {
    render(<PaneFrame paneId={PANE_ID} />);
    openMenu();
    await submit("   ");

    const alert = await waitFor(() => screen.getByRole("alert"), WAIT);
    expect(alert.textContent).toContain("Enter a URL");
    expect(probeCalls).toHaveLength(0);
  });
});

describe("PaneFrame chrome never disturbs the page", () => {
  test("opening and closing the menu keeps the iframe mounted and unchanged", async () => {
    render(<PaneFrame paneId={PANE_ID} />);
    await submit("https://example.com");
    await waitFor(() => {
      expect(
        screen.getByTestId(`pane-frame-${PANE_ID}`).getAttribute("src"),
      ).toBe("https://example.com/");
    }, WAIT);
    const before = screen.getByTestId(`pane-frame-${PANE_ID}`);
    const parentBefore = before.parentNode;

    openMenu();
    expect(screen.getByLabelText(`URL for pane ${PANE_ID}`)).toBeDefined();
    openMenu();

    expect(screen.queryByLabelText(`URL for pane ${PANE_ID}`)).toBeNull();
    const after = screen.getByTestId(`pane-frame-${PANE_ID}`);
    expect(Object.is(before, after)).toBe(true);
    expect(Object.is(parentBefore, after.parentNode)).toBe(true);
    expect(after.getAttribute("src")).toBe("https://example.com/");
  });
});
