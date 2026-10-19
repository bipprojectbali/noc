/**
 * Registry of pane host elements and their last known rect.
 *
 * Deliberately outside React: during a drag every pane's rect changes on every
 * pointer move, and routing that through component state would re-render the
 * whole wall — and with it risk touching the iframes.
 */

import type { PaneId } from "../layout/layout.types.ts";
import { ZERO_RECT, type Rect } from "./geometry.rect.ts";

export type GeometryRegistry = {
  registerHost: (paneId: PaneId, element: HTMLElement | null) => void;
  hostElement: (paneId: PaneId) => HTMLElement | null;
  lastRect: (paneId: PaneId) => Rect;
  setLastRect: (paneId: PaneId, rect: Rect) => void;
  forget: (paneId: PaneId) => void;
  paneIds: () => PaneId[];
};

export function createGeometryRegistry(): GeometryRegistry {
  const hosts = new Map<PaneId, HTMLElement>();
  const rects = new Map<PaneId, Rect>();

  return {
    registerHost: (paneId, element) => {
      if (element === null) {
        hosts.delete(paneId);
        return;
      }
      hosts.set(paneId, element);
    },
    hostElement: (paneId) => hosts.get(paneId) ?? null,
    lastRect: (paneId) => rects.get(paneId) ?? ZERO_RECT,
    setLastRect: (paneId, rect) => {
      rects.set(paneId, rect);
    },
    forget: (paneId) => {
      hosts.delete(paneId);
      rects.delete(paneId);
    },
    paneIds: () => [...hosts.keys()],
  };
}

/** One registry for the running wall. Tests build their own. */
export const geometryRegistry = createGeometryRegistry();
