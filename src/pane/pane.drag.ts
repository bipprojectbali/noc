/**
 * Dragging a pane to another place on the wall.
 *
 * The handle is the ⋮ button, and it is the only candidate there is. A press on
 * a pane's body cannot be heard: an iframe is cross-origin and keeps the event
 * inside its own document, and a native child webview takes mouse input at the
 * OS level before the web layer sees anything. ⋮ is the one surface this app
 * owns that exists on a loaded pane under both renderers, so press-and-move
 * there is a drag and press-and-release is still the menu. The whole difference
 * between the two gestures is `DRAG_THRESHOLD_PX`.
 *
 * Its own store rather than fields on the wall store, for the reason
 * `session.store` gives: the wall store is at its line budget, and a drag is a
 * gesture in flight rather than wall state — nothing about it is persisted, and
 * it has to be readable from every pane at once so each can say whether it is
 * the one being dragged, the one being dropped on, or neither. The commit is
 * still the wall store's: `rearrangePane` owns the tree, this owns the gesture.
 *
 * While a drag runs it holds `suspendPanePointerCapture` — the same seam the
 * splitter and the menu use. That is not decoration. Every native webview goes
 * blank for the duration, which is what lets an overlay be drawn over one at
 * all, and the iframes stop taking the pointer, which is what keeps the moves
 * arriving at this window. The hold is one effect keyed on "is this pane the
 * one being dragged", so every way a drag can end — drop, Escape, lost focus, a
 * cancelled pointer, the pane itself being deleted mid-drag — releases it once
 * and exactly once. No call site below releases by hand.
 */

import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from "react";
import { create } from "zustand";

import type { Rect } from "../geometry/geometry.rect.ts";
import { domRectReader } from "../geometry/geometry.sync.ts";
import type { PaneId } from "../layout/layout.types.ts";
import {
  resumePanePointerCapture,
  suspendPanePointerCapture,
} from "../resize/resize.pointer-capture.ts";
import {
  dropZoneAt,
  hasCrossedDragThreshold,
  type DropZone,
  type Point,
} from "./pane.drag-geometry.ts";
import { useWallStore } from "./pane.store.ts";

const PRIMARY_BUTTON = 0;
const CANCEL_KEY = "Escape";
const PANE_HOST_ATTRIBUTE = "data-pane-host";

export type PaneDrag = {
  /** The pane being carried. */
  paneId: PaneId;
  /** The pane under the pointer, or null while the pointer is off the wall. */
  targetPaneId: PaneId | null;
  zone: DropZone;
};

export type PaneDragState = {
  drag: PaneDrag | null;
  begin: (paneId: PaneId) => void;
  hoverOver: (targetPaneId: PaneId | null, zone: DropZone) => void;
  cancel: () => void;
  /** Ends the drag by applying it. A drop on nothing is simply a drag undone. */
  drop: () => void;
};

export const usePaneDragStore = create<PaneDragState>((set, get) => ({
  drag: null,

  begin: (paneId) => {
    set({ drag: { paneId, targetPaneId: null, zone: "center" } });
  },

  hoverOver: (targetPaneId, zone) => {
    set((state) => {
      const drag = state.drag;
      if (drag === null) return {};
      // Pointer moves arrive far faster than the zone changes, and every one of
      // them would otherwise re-render an overlay in every pane on the wall.
      if (drag.targetPaneId === targetPaneId && drag.zone === zone) return {};
      return { drag: { ...drag, targetPaneId, zone } };
    });
  },

  cancel: () => {
    set({ drag: null });
  },

  drop: () => {
    const drag = get().drag;
    if (drag !== null && drag.targetPaneId !== null) {
      useWallStore
        .getState()
        .rearrangePane(drag.paneId, drag.targetPaneId, drag.zone);
    }
    set({ drag: null });
  },
}));

/**
 * Which pane is under a point, and the rect to measure the drop against.
 *
 * `elementFromPoint` reaches the right host whatever is on top: a cross-origin
 * iframe answers as the `<iframe>` element itself, which is a child of the
 * host, and a hidden webview leaves its anchor div behind — so `closest` lands
 * on the same host either way.
 */
function paneHostAt(point: Point): { paneId: PaneId; rect: Rect } | null {
  const element = document.elementFromPoint(point.x, point.y);
  const host = element?.closest(`[${PANE_HOST_ATTRIBUTE}]`) ?? null;
  if (host === null) return null;
  const paneId = host.getAttribute(PANE_HOST_ATTRIBUTE);
  if (paneId === null || paneId === "") return null;
  return { paneId, rect: domRectReader(host) };
}

export type PaneDragHandleProps = {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onClick: (event: MouseEvent<HTMLElement>) => void;
};

/**
 * Turns one element into this pane's drag handle without taking its click away.
 *
 * `onClick` is routed through here rather than left on the element, because a
 * press that became a drag still ends in a click event and would open the menu
 * on top of the move that just happened. A click synthesised from the keyboard
 * carries `detail === 0` and never follows a drag, so it is always let through.
 */
export function usePaneDragHandle(
  paneId: PaneId,
  onClick: () => void,
): PaneDragHandleProps {
  const startRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const swallowClickRef = useRef(false);
  const handleRef = useRef<HTMLElement | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const dragging = usePaneDragStore((state) => state.drag?.paneId === paneId);

  const endSession = useCallback((commit: boolean) => {
    const start = startRef.current;
    if (start === null) return;
    startRef.current = null;
    detachRef.current?.();
    detachRef.current = null;

    const handle = handleRef.current;
    if (handle !== null && handle.hasPointerCapture(start.pointerId)) {
      handle.releasePointerCapture(start.pointerId);
    }
    // A press that never crossed the threshold was a click on ⋮ and nothing
    // else: there is no drag to finish and no click to swallow.
    if (!movedRef.current) return;
    swallowClickRef.current = true;
    const store = usePaneDragStore.getState();
    if (commit) store.drop();
    else store.cancel();
  }, []);

  // The newest `endSession`, so the unmount cleanup can run it without taking
  // it as a dependency: a cleanup that re-ran on every change would end a live
  // drag. The pane can be deleted while its own ⋮ is still held down.
  const endSessionRef = useRef(endSession);
  endSessionRef.current = endSession;
  useEffect(() => () => endSessionRef.current(false), []);

  useEffect(() => {
    if (!dragging) return;
    suspendPanePointerCapture();
    return () => resumePanePointerCapture();
  }, [dragging]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== CANCEL_KEY || startRef.current === null) return;
      event.preventDefault();
      endSession(false);
    };
    // Losing focus mid-drag never delivers pointerup, so without this the wall
    // would stay suppressed and the next drop would land from a stale gesture.
    const onBlur = (): void => endSession(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [endSession]);

  const onPointerDown = (event: PointerEvent<HTMLElement>): void => {
    if (event.button !== PRIMARY_BUTTON) return;
    // A second pointer pressing the handle would overwrite the live session and
    // orphan its window listeners, leaving them attached for good.
    if (startRef.current !== null) return;

    const element = event.currentTarget;
    handleRef.current = element;
    startRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    movedRef.current = false;
    swallowClickRef.current = false;
    // Escape is heard on this window, and WebKit does not focus a button on
    // press. Without this the focus could sit inside a pane's iframe, whose
    // keydown never reaches this document, and the drag would be uncancellable.
    element.focus({ preventScroll: true });
    element.setPointerCapture(event.pointerId);

    // On the window, not the element: once the pointer is over another pane the
    // moves are delivered there, and pointer capture alone does not survive a
    // native webview, which takes the cursor at OS level.
    const onMove = (moveEvent: globalThis.PointerEvent): void => {
      const start = startRef.current;
      if (start === null || start.pointerId !== moveEvent.pointerId) return;
      const point = { x: moveEvent.clientX, y: moveEvent.clientY };

      if (!movedRef.current) {
        if (!hasCrossedDragThreshold(start, point)) return;
        movedRef.current = true;
        usePaneDragStore.getState().begin(paneId);
      }
      const target = paneHostAt(point);
      usePaneDragStore
        .getState()
        .hoverOver(
          target?.paneId ?? null,
          target === null ? "center" : dropZoneAt(target.rect, point),
        );
    };
    // Only the pointer that began the drag may end it. A second finger lifting
    // is not the user letting go of the pane.
    const onRelease = (releaseEvent: globalThis.PointerEvent): void => {
      if (startRef.current?.pointerId !== releaseEvent.pointerId) return;
      endSession(releaseEvent.type === "pointerup");
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onRelease);
    window.addEventListener("pointercancel", onRelease);
    detachRef.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onRelease);
      window.removeEventListener("pointercancel", onRelease);
    };
  };

  return {
    onPointerDown,
    onClick: (event) => {
      const swallow = swallowClickRef.current && event.detail > 0;
      swallowClickRef.current = false;
      if (!swallow) onClick();
    },
  };
}
