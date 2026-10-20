/**
 * Switching a pane's renderer, from both sides of the host boundary.
 *
 * The native shell is faked at the seam `isNativeHost` actually sniffs — an
 * `__TAURI_INTERNALS__` object with an `invoke` that records — rather than by
 * replacing a module. That keeps the real bridge, the real singleton renderer
 * and the real store in the test, which is the only way the hazard this covers
 * is visible at all: a webview left behind on a switch is not in the DOM, so
 * nothing but the `pane_webview_close` call proves it was destroyed.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PaneFrame } from "../../src/pane/pane.frame.tsx";
import { rendererChange } from "../../src/pane/pane.renderer.ts";
import { paneLoadState, useWallStore } from "../../src/pane/pane.store.ts";
import type { PaneStrategy } from "../../src/layout/layout.types.ts";
import { resetWallStore, settleAsyncWork } from "../fixtures/wall-store.ts";

const WAIT = { timeout: 2000 };

type InvokeCall = { cmd: string; paneId: unknown };

let invokeCalls: InvokeCall[] = [];
let probeCalls: string[] = [];
const realFetch = globalThis.fetch;

/** Makes `isNativeHost()` true and gives `invoke` somewhere to land. */
function enterNativeHost(): void {
  (globalThis.window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args: { paneId?: unknown }) => {
      invokeCalls.push({ cmd, paneId: args?.paneId });
      return Promise.resolve();
    },
  };
}

function leaveNativeHost(): void {
  delete (globalThis.window as unknown as Record<string, unknown>)
    .__TAURI_INTERNALS__;
}

function commandsFor(paneId: string): string[] {
  return invokeCalls.flatMap((call) =>
    call.paneId === paneId ? [call.cmd] : [],
  );
}

async function setStrategy(paneId: string, strategy: PaneStrategy): Promise<void> {
  await act(async () => {
    useWallStore.getState().setPaneStrategy(paneId, strategy);
  });
}

async function submit(paneId: string, raw: string): Promise<void> {
  await act(async () => {
    useWallStore.getState().submitUrl(paneId, raw);
  });
}

function strategyOf(paneId: string): PaneStrategy {
  const node = useWallStore.getState().tree.nodes[paneId];
  if (node === undefined || node.kind !== "pane") throw new Error("not a pane");
  return node.strategy;
}

beforeEach(() => {
  invokeCalls = [];
  probeCalls = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    probeCalls.push(typeof input === "string" ? input : input.toString());
    return new Response(
      JSON.stringify({ verdict: "allowed", reason: "no framing headers present" }),
      { headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
});

afterEach(async () => {
  await settleAsyncWork();
  cleanup();
  leaveNativeHost();
  globalThis.fetch = realFetch;
});

describe("rendererChange knows what a switch costs", () => {
  test("in a browser every strategy is the same iframe, so nothing changes", () => {
    expect(rendererChange("auto", "webview")).toEqual({
      changed: false,
      releases: false,
    });
    expect(rendererChange("webview", "iframe")).toEqual({
      changed: false,
      releases: false,
    });
  });

  test("in the shell, leaving the webview is the direction that must release", () => {
    enterNativeHost();
    expect(rendererChange("auto", "iframe")).toEqual({
      changed: true,
      releases: true,
    });
    expect(rendererChange("iframe", "webview")).toEqual({
      changed: true,
      releases: false,
    });
    // `auto` already resolves to the webview here: picking it explicitly is not
    // a renderer change and must not tear anything down.
    expect(rendererChange("auto", "webview")).toEqual({
      changed: false,
      releases: false,
    });
  });
});

describe("the strategy action in a browser", () => {
  const PANE = "b1";

  beforeEach(() => {
    resetWallStore(PANE);
  });

  test("records the choice without disturbing the iframe", async () => {
    render(<PaneFrame paneId={PANE} />);
    await submit(PANE, "https://example.com");
    await waitFor(() => {
      expect(screen.getByTestId(`pane-frame-${PANE}`).getAttribute("src")).toBe(
        "https://example.com/",
      );
    }, WAIT);
    const before = screen.getByTestId(`pane-frame-${PANE}`);
    const probesBefore = probeCalls.length;

    await setStrategy(PANE, "webview");

    expect(strategyOf(PANE)).toBe("webview");
    // No native shell to switch to, so the pane is untouched: same iframe node,
    // same page, and no second probe.
    expect(Object.is(before, screen.getByTestId(`pane-frame-${PANE}`))).toBe(true);
    expect(probeCalls.length).toBe(probesBefore);
  });

  test("the picker offers the webview, disabled, with the reason in its label", () => {
    render(<PaneFrame paneId={PANE} />);
    const select = screen.getByTestId(`pane-strategy-${PANE}`) as HTMLSelectElement;
    const webview = Array.from(select.options).find(
      (option) => option.value === "webview",
    );

    expect(select.value).toBe("auto");
    expect(webview?.disabled).toBe(true);
    expect(webview?.textContent).toContain("desktop app only");
  });

  test("the picker writes the chosen strategy into the tree", () => {
    render(<PaneFrame paneId={PANE} />);
    act(() => {
      fireEvent.change(screen.getByTestId(`pane-strategy-${PANE}`), {
        target: { value: "iframe" },
      });
    });

    expect(strategyOf(PANE)).toBe("iframe");
  });

  test("the refusal names the real limit instead of a control that cannot exist", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ verdict: "refused", reason: "x-frame-options: deny" }),
        { headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    render(<PaneFrame paneId={PANE} />);
    await submit(PANE, "https://github.com");

    const refusal = await waitFor(
      () => screen.getByTestId(`pane-refused-${PANE}`),
      WAIT,
    );
    expect(refusal.textContent).toContain("only in the desktop app");
  });
});

describe("the strategy action in the native shell", () => {
  const PANE = "n1";

  beforeEach(() => {
    enterNativeHost();
    resetWallStore(PANE);
  });

  test("a webview pane is never probed: no header can refuse a top-level document", async () => {
    render(<PaneFrame paneId={PANE} />);
    await submit(PANE, "https://github.com");

    await waitFor(() => {
      expect(commandsFor(PANE)).toContain("pane_webview_show");
    }, WAIT);
    expect(probeCalls).toEqual([]);
    expect(paneLoadState(useWallStore.getState(), PANE)).toEqual({
      kind: "loading",
      url: "https://github.com/",
    });
  });

  test("switching away from the webview destroys it instead of orphaning it", async () => {
    render(<PaneFrame paneId={PANE} />);
    await submit(PANE, "https://github.com");
    await waitFor(() => {
      expect(commandsFor(PANE)).toContain("pane_webview_show");
    }, WAIT);

    await setStrategy(PANE, "iframe");

    // The native view is not in the DOM, so unmounting the anchor cannot remove
    // it. Without the explicit close it would keep painting over the wall.
    await waitFor(() => {
      expect(commandsFor(PANE)).toContain("pane_webview_close");
    }, WAIT);
    // And the pane really is an iframe now, probed for the first time.
    expect(screen.getByTestId(`pane-frame-${PANE}`).tagName).toBe("IFRAME");
    expect(screen.queryByTestId(`pane-webview-${PANE}`)).toBeNull();
    await waitFor(() => {
      expect(probeCalls).toHaveLength(1);
    }, WAIT);
  });

  test("picking the strategy the host already resolved to closes nothing", async () => {
    render(<PaneFrame paneId={PANE} />);
    await submit(PANE, "https://github.com");
    await waitFor(() => {
      expect(commandsFor(PANE)).toContain("pane_webview_show");
    }, WAIT);

    await setStrategy(PANE, "webview");

    expect(strategyOf(PANE)).toBe("webview");
    expect(commandsFor(PANE)).not.toContain("pane_webview_close");
    expect(screen.getByTestId(`pane-webview-${PANE}`)).toBeDefined();
  });

  test("switching to the webview hands the url to the shell", async () => {
    await setStrategy(PANE, "iframe");
    render(<PaneFrame paneId={PANE} />);
    await submit(PANE, "https://example.com");
    await waitFor(() => {
      expect(screen.getByTestId(`pane-frame-${PANE}`).getAttribute("src")).toBe(
        "https://example.com/",
      );
    }, WAIT);

    await setStrategy(PANE, "webview");

    await waitFor(() => {
      expect(commandsFor(PANE)).toContain("pane_webview_show");
    }, WAIT);
    expect(screen.getByTestId(`pane-webview-${PANE}`)).toBeDefined();
  });

  test("the refusal points at the picker and says the switch reloads", async () => {
    await setStrategy(PANE, "iframe");
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ verdict: "refused", reason: "x-frame-options: deny" }),
        { headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    render(<PaneFrame paneId={PANE} />);
    await submit(PANE, "https://github.com");

    const refusal = await waitFor(
      () => screen.getByTestId(`pane-refused-${PANE}`),
      WAIT,
    );
    expect(refusal.textContent).toContain("Webview in the URL bar");
    expect(refusal.textContent).toContain("reloads the page");
  });
});
