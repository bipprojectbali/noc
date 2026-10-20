/**
 * Reloading a pane that is served by a native webview.
 *
 * The iframe path reloads as a side effect of the load state machine: `probing`
 * takes the frame's `src` away and the next state puts it back, which is a real
 * second fetch. Nothing does that for a webview — it is handed its url once and
 * keeps it — so asking the pane to reload used to reach the shell as nothing at
 * all. `reopen` is the missing half: `pane_webview_show` navigates a view that
 * already exists, so the page is fetched again without the view being destroyed.
 *
 * The native shell is faked where `isNativeHost` actually sniffs, so the real
 * store, the real bridge and the real singleton renderer stay in the test.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

import type { PaneId } from "../../src/layout/layout.types.ts";
import type { NativePaneBridge, NativeRect } from "../../src/native/native.bridge.ts";
import { PaneFrame } from "../../src/pane/pane.frame.tsx";
import { useWallStore } from "../../src/pane/pane.store.ts";
import { createPaneWebviewRenderer } from "../../src/pane/pane.webview-renderer.ts";
import { resetWallStore, settleAsyncWork, siteIdsOf } from "../fixtures/wall-store.ts";

const WAIT = { timeout: 2000 };
const RECT: NativeRect = { x: 10, y: 20, width: 300, height: 200 };
const URL_ONE = "https://example.com/";

type Call =
  | { op: "show"; paneId: PaneId; url: string }
  | { op: "place"; paneId: PaneId; visible: boolean }
  | { op: "close"; paneId: PaneId };

function recordingBridge(): { bridge: NativePaneBridge; calls: Call[] } {
  const calls: Call[] = [];
  const bridge: NativePaneBridge = {
    show: async (paneId, url) => {
      calls.push({ op: "show", paneId, url });
    },
    place: async (paneId, _rect, visible) => {
      calls.push({ op: "place", paneId, visible });
    },
    close: async (paneId) => {
      calls.push({ op: "close", paneId });
    },
  };
  return { bridge, calls };
}

/** Lets the promise chains inside the renderer run to completion. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function opsFor(calls: Call[], op: Call["op"]): Call[] {
  return calls.filter((call) => call.op === op);
}

describe("reopen navigates a webview that is already there", () => {
  test("a reload asks the shell for the same url a second time", async () => {
    const { bridge, calls } = recordingBridge();
    const renderer = createPaneWebviewRenderer({ bridge, readRect: () => RECT });
    // Site id and pane id are the same string here: this renderer is driven
    // directly, and the webview's label is the site.
    renderer.registerAnchor("p1", "p1", document.createElement("div"));
    renderer.setUrl("p1", URL_ONE);
    renderer.place("p1", true);
    await settle();
    expect(opsFor(calls, "show")).toEqual([
      { op: "show", paneId: "p1", url: URL_ONE },
    ]);

    renderer.reopen("p1");
    await settle();

    expect(opsFor(calls, "show")).toEqual([
      { op: "show", paneId: "p1", url: URL_ONE },
      { op: "show", paneId: "p1", url: URL_ONE },
    ]);
    // Destroying and rebuilding would reload too, and would throw away
    // everything the page holds. The view must survive its own reload.
    expect(opsFor(calls, "close")).toEqual([]);
  });

  test("reopening a pane the layout has hidden leaves it hidden", async () => {
    const { bridge, calls } = recordingBridge();
    const renderer = createPaneWebviewRenderer({ bridge, readRect: () => RECT });
    renderer.registerAnchor("p2", "p2", document.createElement("div"));
    renderer.setUrl("p2", URL_ONE);
    renderer.place("p2", false);
    await settle();

    renderer.reopen("p2");
    await settle();

    // The shell shows a webview it navigates, so the follow-up place has to put
    // it back out of sight.
    expect(opsFor(calls, "place").at(-1)).toEqual({
      op: "place",
      paneId: "p2",
      visible: false,
    });
  });

  test("a pane with no url, and a pane the renderer never saw, reach nothing", async () => {
    const { bridge, calls } = recordingBridge();
    const renderer = createPaneWebviewRenderer({ bridge, readRect: () => RECT });
    renderer.registerAnchor("p3", "p3", document.createElement("div"));
    renderer.setUrl("p3", URL_ONE);
    await settle();
    renderer.setUrl("p3", null);
    await settle();
    const before = calls.length;

    renderer.reopen("p3");
    renderer.reopen("never-seen");
    await settle();

    expect(calls.length).toBe(before);
  });
});

type InvokeCall = { cmd: string; paneId: unknown };

let invokeCalls: InvokeCall[] = [];
let probeCalls: string[] = [];
const realFetch = globalThis.fetch;

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

/**
 * The native commands aimed at any of a pane's sites: the shell is addressed by
 * site, since a webview is one site's page rather than one pane's.
 */
function commandsFor(paneId: string): string[] {
  const sites = siteIdsOf(paneId);
  return invokeCalls.flatMap((call) =>
    sites.some((siteId) => call.paneId === siteId) ? [call.cmd] : [],
  );
}

function countOf(paneId: string, cmd: string): number {
  return commandsFor(paneId).filter((seen) => seen === cmd).length;
}

async function submit(paneId: string, raw: string): Promise<void> {
  await act(async () => {
    useWallStore.getState().submitUrl(paneId, raw);
  });
}

describe("reloadPane reaches whichever renderer the pane got", () => {
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

  test("a webview pane is navigated again, and is not torn down to do it", async () => {
    const PANE = "r1";
    enterNativeHost();
    resetWallStore(PANE);
    render(<PaneFrame paneId={PANE} />);
    await submit(PANE, "https://example.com");
    await waitFor(() => {
      expect(countOf(PANE, "pane_webview_show")).toBe(1);
    }, WAIT);

    await act(async () => {
      useWallStore.getState().reloadPane(PANE);
    });

    await waitFor(() => {
      expect(countOf(PANE, "pane_webview_show")).toBe(2);
    }, WAIT);
    expect(commandsFor(PANE)).not.toContain("pane_webview_close");
  });

  test("an empty pane has nothing to reload", async () => {
    const PANE = "r2";
    enterNativeHost();
    resetWallStore(PANE);
    render(<PaneFrame paneId={PANE} />);

    await act(async () => {
      useWallStore.getState().reloadPane(PANE);
    });

    expect(commandsFor(PANE)).toEqual([]);
  });

  test("the iframe path still reloads by dropping and restoring its src", async () => {
    const PANE = "r3";
    resetWallStore(PANE);
    render(<PaneFrame paneId={PANE} />);
    await submit(PANE, "https://example.com");
    await waitFor(() => {
      expect(screen.getByTestId(`pane-frame-${PANE}`).getAttribute("src")).toBe(
        URL_ONE,
      );
    }, WAIT);

    act(() => {
      useWallStore.getState().reloadPane(PANE);
    });

    // Back to `probing`: the frame has no src at all, which is what makes the
    // next one a real second fetch rather than a no-op.
    expect(screen.getByTestId(`pane-frame-${PANE}`).getAttribute("src")).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId(`pane-frame-${PANE}`).getAttribute("src")).toBe(
        URL_ONE,
      );
    }, WAIT);
    expect(probeCalls).toHaveLength(2);
    expect(invokeCalls).toEqual([]);
  });
});
