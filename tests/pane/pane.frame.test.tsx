import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

import { createTree } from "../../src/layout/layout.tree.ts";
import { PaneFrame } from "../../src/pane/pane.frame.tsx";
import { useWallStore } from "../../src/pane/pane.store.ts";
import type { EmbedVerdict } from "../../src/embed/embed.classifier.ts";

const PANE_ID = "p1";

type ProbeStub = { verdict: EmbedVerdict; reason: string };

let probeStub: ProbeStub = { verdict: "allowed", reason: "no framing headers present" };
let probeCalls: string[] = [];
const realFetch = globalThis.fetch;

function resetStore(): void {
  let counter = 0;
  const tree = createTree(() => (counter === 0 ? (counter++, PANE_ID) : `x${counter++}`), 1);
  useWallStore.setState({ tree, load: {}, urlError: {} });
}

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
  resetStore();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

function urlInput(): HTMLInputElement {
  return screen.getByLabelText(`URL for pane ${PANE_ID}`) as HTMLInputElement;
}

/** Store mutations go through act() so React has flushed before assertions run. */
async function submit(raw: string): Promise<void> {
  await act(async () => {
    useWallStore.getState().submitUrl(PANE_ID, raw);
  });
}

async function setUrlBarVisible(visible: boolean): Promise<void> {
  await act(async () => {
    useWallStore.getState().setUrlBarVisible(PANE_ID, visible);
  });
}

describe("PaneFrame renders the pane shell", () => {
  test("starts empty and asks for a URL", () => {
    render(<PaneFrame paneId={PANE_ID} />);
    expect(screen.getByText(/Enter a URL to fill this pane/)).toBeDefined();
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
    });
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
    });
  });
});

describe("PaneFrame shows an explicit refusal, never a blank box", () => {
  test("renders the refusal with the header that caused it", async () => {
    probeStub = { verdict: "refused", reason: "x-frame-options: deny" };
    render(<PaneFrame paneId={PANE_ID} />);
    await submit("https://github.com");

    const refusal = await waitFor(() =>
      screen.getByTestId(`pane-refused-${PANE_ID}`),
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
    });
  });
});

describe("PaneFrame validates input before touching the iframe", () => {
  test("rejects javascript: and reports why", async () => {
    render(<PaneFrame paneId={PANE_ID} />);
    await submit("javascript:alert(1)");

    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert.textContent).toContain("Only http and https");
    expect(screen.getByTestId(`pane-frame-${PANE_ID}`).getAttribute("src")).toBeNull();
    expect(probeCalls).toHaveLength(0);
  });

  test("rejects an empty submission", async () => {
    render(<PaneFrame paneId={PANE_ID} />);
    await submit("   ");

    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert.textContent).toContain("Enter a URL");
    expect(probeCalls).toHaveLength(0);
  });
});

describe("PaneFrame URL bar visibility", () => {
  test("hiding the bar keeps the iframe mounted and unchanged", async () => {
    render(<PaneFrame paneId={PANE_ID} />);
    await submit("https://example.com");
    await waitFor(() => {
      expect(
        screen.getByTestId(`pane-frame-${PANE_ID}`).getAttribute("src"),
      ).toBe("https://example.com/");
    });
    const before = screen.getByTestId(`pane-frame-${PANE_ID}`);

    await setUrlBarVisible(false);

    await waitFor(() => {
      expect(screen.queryByLabelText(`URL for pane ${PANE_ID}`)).toBeNull();
    });
    const after = screen.getByTestId(`pane-frame-${PANE_ID}`);
    expect(Object.is(before, after)).toBe(true);
    expect(after.getAttribute("src")).toBe("https://example.com/");
    expect(screen.getByText("Show URL bar")).toBeDefined();
  });
});
