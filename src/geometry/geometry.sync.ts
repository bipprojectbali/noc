/**
 * Copies slot geometry onto pane hosts, imperatively.
 *
 * This is the seam between the two layers: the layout layer renders empty slots
 * and may rebuild them freely, while the pane layer never moves. Nothing here
 * reads or writes React state.
 */

import type { PaneId } from "../layout/layout.types.ts";
import type { GeometryRegistry } from "./geometry.store.ts";
import {
  isEmptyRect,
  rectToStyle,
  rectsEqual,
  toLayerRect,
  ZERO_RECT,
  type Rect,
} from "./geometry.rect.ts";

export const SLOT_ATTRIBUTE = "data-pane-slot";

/** Lets tests supply rects without a browser, where every rect would be zero. */
export type RectReader = (element: Element) => Rect;

export const domRectReader: RectReader = (element) => {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
};

function slotRects(layer: Element, readRect: RectReader): Map<PaneId, Rect> {
  const found = new Map<PaneId, Rect>();
  for (const slot of layer.querySelectorAll(`[${SLOT_ATTRIBUTE}]`)) {
    const paneId = slot.getAttribute(SLOT_ATTRIBUTE);
    if (paneId === null || paneId === "") continue;
    found.set(paneId, readRect(slot));
  }
  return found;
}

export type SyncResult = {
  /** Panes whose rect changed, so callers can tell a no-op sync from real work. */
  moved: PaneId[];
  /** Panes with no slot in the tree — docked, or not placed yet. */
  unplaced: PaneId[];
};

/**
 * Writes each registered pane host to the rect of the slot carrying its id.
 * A pane with no slot is hidden rather than resized to nothing: collapsing it
 * would make the page inside reflow to a zero-width viewport and lose its
 * scroll position for no reason.
 */
export function syncPaneGeometry(
  container: Element,
  registry: GeometryRegistry,
  readRect: RectReader = domRectReader,
): SyncResult {
  const containerRect = readRect(container);
  const slots = slotRects(container, readRect);
  const moved: PaneId[] = [];
  const unplaced: PaneId[] = [];

  for (const paneId of registry.paneIds()) {
    const host = registry.hostElement(paneId);
    if (host === null) continue;

    const slot = slots.get(paneId);
    if (slot === undefined) {
      unplaced.push(paneId);
      host.style.visibility = "hidden";
      registry.setLastRect(paneId, ZERO_RECT);
      continue;
    }

    const rect = toLayerRect(slot, containerRect);
    const visible = !isEmptyRect(rect);
    host.style.visibility = visible ? "visible" : "hidden";

    if (!rectsEqual(rect, registry.lastRect(paneId))) {
      for (const [property, value] of Object.entries(rectToStyle(rect))) {
        host.style.setProperty(property, value);
      }
      registry.setLastRect(paneId, rect);
      moved.push(paneId);
    }
  }

  return { moved, unplaced };
}
