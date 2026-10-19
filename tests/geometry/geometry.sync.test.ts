import { describe, expect, test } from "bun:test";

import {
  isEmptyRect,
  rectToStyle,
  rectsEqual,
  toLayerRect,
  type Rect,
} from "../../src/geometry/geometry.rect.ts";
import { createGeometryRegistry } from "../../src/geometry/geometry.store.ts";
import {
  SLOT_ATTRIBUTE,
  syncPaneGeometry,
  type RectReader,
} from "../../src/geometry/geometry.sync.ts";

describe("rect maths", () => {
  test("converts a viewport rect into layer coordinates", () => {
    const slot: Rect = { left: 120, top: 80, width: 300, height: 200 };
    const layer: Rect = { left: 20, top: 30, width: 1000, height: 800 };
    expect(toLayerRect(slot, layer)).toEqual({
      left: 100,
      top: 50,
      width: 300,
      height: 200,
    });
  });

  test("handles a layer that is scrolled past the viewport origin", () => {
    const slot: Rect = { left: -50, top: -100, width: 10, height: 10 };
    const layer: Rect = { left: -200, top: -400, width: 10, height: 10 };
    expect(toLayerRect(slot, layer)).toMatchObject({ left: 150, top: 300 });
  });

  test("treats a zero-area rect as empty", () => {
    expect(isEmptyRect({ left: 0, top: 0, width: 0, height: 100 })).toBe(true);
    expect(isEmptyRect({ left: 0, top: 0, width: 100, height: 0 })).toBe(true);
    expect(isEmptyRect({ left: 0, top: 0, width: 1, height: 1 })).toBe(false);
  });

  test("compares rects by value", () => {
    const a: Rect = { left: 1, top: 2, width: 3, height: 4 };
    expect(rectsEqual(a, { ...a })).toBe(true);
    expect(rectsEqual(a, { ...a, width: 9 })).toBe(false);
  });

  test("places panes with transform, not left and top", () => {
    // Using transform keeps a resize off the layout path for every other pane.
    expect(rectToStyle({ left: 10, top: 20, width: 30, height: 40 })).toEqual({
      transform: "translate(10px, 20px)",
      width: "30px",
      height: "40px",
    });
  });
});

/** Builds a container with slots and a matching registry of host elements. */
function scene(paneIds: string[], slotIds: string[]) {
  const container = document.createElement("div");
  for (const id of slotIds) {
    const slot = document.createElement("div");
    slot.setAttribute(SLOT_ATTRIBUTE, id);
    container.appendChild(slot);
  }

  const registry = createGeometryRegistry();
  const hosts = new Map<string, HTMLElement>();
  for (const id of paneIds) {
    const host = document.createElement("div");
    hosts.set(id, host);
    registry.registerHost(id, host);
  }
  return { container, registry, hosts };
}

/** Injected because happy-dom reports every element as a zero rect. */
function readerFor(rects: Record<string, Rect>, container: Element): RectReader {
  return (element) => {
    if (element === container) {
      return rects.container ?? { left: 0, top: 0, width: 0, height: 0 };
    }
    const id = element.getAttribute(SLOT_ATTRIBUTE) ?? "";
    return rects[id] ?? { left: 0, top: 0, width: 0, height: 0 };
  };
}

describe("syncPaneGeometry", () => {
  test("writes each pane host to its slot's rect, relative to the container", () => {
    const { container, registry, hosts } = scene(["p1", "p2"], ["p1", "p2"]);
    const read = readerFor(
      {
        container: { left: 10, top: 10, width: 800, height: 600 },
        p1: { left: 10, top: 10, width: 400, height: 600 },
        p2: { left: 410, top: 10, width: 400, height: 600 },
      },
      container,
    );

    const result = syncPaneGeometry(container, registry, read);

    expect(result.moved.sort()).toEqual(["p1", "p2"]);
    expect(result.unplaced).toEqual([]);
    expect(hosts.get("p1")!.style.transform).toBe("translate(0px, 0px)");
    expect(hosts.get("p2")!.style.transform).toBe("translate(400px, 0px)");
    expect(hosts.get("p2")!.style.width).toBe("400px");
    expect(hosts.get("p1")!.style.visibility).toBe("visible");
  });

  test("reports nothing moved when rects are unchanged", () => {
    const { container, registry } = scene(["p1"], ["p1"]);
    const read = readerFor(
      {
        container: { left: 0, top: 0, width: 800, height: 600 },
        p1: { left: 0, top: 0, width: 800, height: 600 },
      },
      container,
    );

    expect(syncPaneGeometry(container, registry, read).moved).toEqual(["p1"]);
    // A second pass must be a no-op, or every observer tick would rewrite styles.
    expect(syncPaneGeometry(container, registry, read).moved).toEqual([]);
  });

  test("hides a pane with no slot instead of collapsing it to zero", () => {
    // A docked pane keeps its renderer alive; resizing it to nothing would make
    // the page inside reflow to a zero-width viewport for no reason.
    const { container, registry, hosts } = scene(["p1", "docked"], ["p1"]);
    const read = readerFor(
      {
        container: { left: 0, top: 0, width: 800, height: 600 },
        p1: { left: 0, top: 0, width: 800, height: 600 },
      },
      container,
    );

    const result = syncPaneGeometry(container, registry, read);

    expect(result.unplaced).toEqual(["docked"]);
    expect(hosts.get("docked")!.style.visibility).toBe("hidden");
    expect(hosts.get("docked")!.style.width).toBe("");
  });

  test("hides a pane whose slot has collapsed to zero area", () => {
    const { container, registry, hosts } = scene(["p1"], ["p1"]);
    const read = readerFor(
      {
        container: { left: 0, top: 0, width: 800, height: 600 },
        p1: { left: 0, top: 0, width: 0, height: 600 },
      },
      container,
    );

    syncPaneGeometry(container, registry, read);
    expect(hosts.get("p1")!.style.visibility).toBe("hidden");
  });

  test("ignores a slot with no pane registered for it", () => {
    const { container, registry } = scene(["p1"], ["p1", "ghost"]);
    const read = readerFor(
      {
        container: { left: 0, top: 0, width: 800, height: 600 },
        p1: { left: 0, top: 0, width: 400, height: 600 },
        ghost: { left: 400, top: 0, width: 400, height: 600 },
      },
      container,
    );

    const result = syncPaneGeometry(container, registry, read);
    expect(result.moved).toEqual(["p1"]);
    expect(result.unplaced).toEqual([]);
  });

  test("skips a pane whose host element has been detached", () => {
    const { container, registry } = scene(["p1"], ["p1"]);
    registry.registerHost("p1", null);
    const read = readerFor(
      { container: { left: 0, top: 0, width: 800, height: 600 } },
      container,
    );

    expect(syncPaneGeometry(container, registry, read)).toEqual({
      moved: [],
      unplaced: [],
    });
  });
});
