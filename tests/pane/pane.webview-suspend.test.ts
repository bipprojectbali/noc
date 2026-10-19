import { describe, expect, test } from "bun:test";

import type { PaneId } from "../../src/layout/layout.types.ts";
import type { NativePaneBridge, NativeRect } from "../../src/native/native.bridge.ts";
import {
  createPaneWebviewRenderer,
  createWebviewPointerSuppressor,
} from "../../src/pane/pane.webview-renderer.ts";
import {
  registerPanePointerSuppressor,
  resumePanePointerCapture,
  suspendPanePointerCapture,
} from "../../src/resize/resize.pointer-capture.ts";

type Call =
  | { op: "show"; paneId: PaneId }
  | { op: "place"; paneId: PaneId; rect: NativeRect; visible: boolean }
  | { op: "close"; paneId: PaneId };

/** Records every call so a test can see exactly what reached the shell. */
function recordingBridge(): { bridge: NativePaneBridge; calls: Call[] } {
  const calls: Call[] = [];
  const bridge: NativePaneBridge = {
    show: async (paneId) => {
      calls.push({ op: "show", paneId });
    },
    place: async (paneId, rect, visible) => {
      calls.push({ op: "place", paneId, rect, visible });
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

function placesFor(calls: Call[], paneId: PaneId) {
  return calls.flatMap((call) =>
    call.op === "place" && call.paneId === paneId ? [call] : [],
  );
}

function visibleSentFor(calls: Call[], paneId: PaneId): number {
  return placesFor(calls, paneId).filter((call) => call.visible).length;
}

/** A renderer with one pane that the layout has made visible. */
async function visiblePane(paneId: PaneId, rect: { current: NativeRect }) {
  const { bridge, calls } = recordingBridge();
  const renderer = createPaneWebviewRenderer({ bridge, readRect: () => rect.current });
  renderer.registerAnchor(paneId, document.createElement("div"));
  renderer.setUrl(paneId, "https://example.com/");
  renderer.place(paneId, true);
  await settle();
  return { renderer, calls };
}

const START: NativeRect = { x: 10, y: 20, width: 300, height: 200 };

describe("a drag hides the webviews and the end of the drag shows them", () => {
  test("suspend hides a visible pane and resume shows it at the same rect", async () => {
    const rect = { current: START };
    const { renderer, calls } = await visiblePane("p1", rect);
    const suppressor = createWebviewPointerSuppressor(renderer);

    suppressor.suspend();
    const hidden = placesFor(calls, "p1").at(-1);
    expect(hidden).toEqual({ op: "place", paneId: "p1", rect: START, visible: false });

    suppressor.resume();
    const shown = placesFor(calls, "p1").at(-1);
    expect(shown).toEqual({ op: "place", paneId: "p1", rect: START, visible: true });
  });

  test("webviews stay hidden until every overlapping drag has ended", async () => {
    const rect = { current: START };
    const { renderer, calls } = await visiblePane("p1", rect);
    const suppressor = createWebviewPointerSuppressor(renderer);
    const before = visibleSentFor(calls, "p1");

    suppressor.suspend();
    suppressor.suspend();
    suppressor.resume();
    expect(visibleSentFor(calls, "p1")).toBe(before);
    expect(placesFor(calls, "p1").at(-1)?.visible).toBe(false);

    suppressor.resume();
    expect(placesFor(calls, "p1").at(-1)?.visible).toBe(true);
  });

  test("a resume with no suspend before it changes nothing", async () => {
    const rect = { current: START };
    const { renderer, calls } = await visiblePane("p1", rect);
    const suppressor = createWebviewPointerSuppressor(renderer);
    const count = calls.length;

    suppressor.resume();
    expect(calls.length).toBe(count);
  });

  test("a pane moved during the drag comes back at its new rect", async () => {
    const rect = { current: START };
    const { renderer, calls } = await visiblePane("p1", rect);
    const suppressor = createWebviewPointerSuppressor(renderer);
    const MOVED: NativeRect = { x: 400, y: 20, width: 300, height: 200 };

    suppressor.suspend();
    rect.current = MOVED;
    renderer.remeasure("p1");
    expect(placesFor(calls, "p1").at(-1)).toEqual({
      op: "place",
      paneId: "p1",
      rect: MOVED,
      visible: false,
    });

    suppressor.resume();
    expect(placesFor(calls, "p1").at(-1)).toEqual({
      op: "place",
      paneId: "p1",
      rect: MOVED,
      visible: true,
    });
  });

  test("a pane the layout had hidden is not shown when the drag ends", async () => {
    const { bridge, calls } = recordingBridge();
    const rect = { current: START };
    const renderer = createPaneWebviewRenderer({ bridge, readRect: () => rect.current });
    renderer.registerAnchor("p2", document.createElement("div"));
    renderer.setUrl("p2", "https://example.com/");
    renderer.place("p2", false);
    await settle();
    const suppressor = createWebviewPointerSuppressor(renderer);

    suppressor.suspend();
    suppressor.resume();
    expect(visibleSentFor(calls, "p2")).toBe(0);
  });

  test("repeated drags, some ended abruptly, leave no pane hidden", async () => {
    // A drag that ends by Escape, blur or pointercancel still resumes exactly
    // once in the splitter; this checks that the pairing survives many drags.
    const rect = { current: START };
    const { renderer, calls } = await visiblePane("p1", rect);
    const suppressor = createWebviewPointerSuppressor(renderer);

    for (let drag = 0; drag < 3; drag += 1) {
      suppressor.suspend();
      expect(placesFor(calls, "p1").at(-1)?.visible).toBe(false);
      suppressor.resume();
      expect(placesFor(calls, "p1").at(-1)?.visible).toBe(true);
    }
  });
});

describe("the drag seam reaches the webview renderer", () => {
  test("suspendPanePointerCapture and resumePanePointerCapture hide and show the panes", async () => {
    const rect = { current: START };
    const { renderer, calls } = await visiblePane("p1", rect);
    const unregister = registerPanePointerSuppressor(
      createWebviewPointerSuppressor(renderer),
    );
    try {
      suspendPanePointerCapture();
      expect(placesFor(calls, "p1").at(-1)?.visible).toBe(false);

      resumePanePointerCapture();
      expect(placesFor(calls, "p1").at(-1)?.visible).toBe(true);
    } finally {
      unregister();
    }
  });
});
