/**
 * The handle between the two children of a split.
 *
 * It belongs to the layout layer and takes real space as a flex item between
 * the two slots rather than being an overlay over a pane, so it occupies the
 * seam instead of covering someone's page.
 */

import { useCallback, useEffect, useRef, type PointerEvent } from "react";

import { domRectReader } from "../geometry/geometry.sync.ts";
import type { NodeId, SplitDirection } from "../layout/layout.types.ts";
import { useWallStore } from "../pane/pane.store.ts";
import {
  resumePanePointerCapture,
  suspendPanePointerCapture,
} from "./resize.pointer-capture.ts";
import {
  beginResizeSession,
  fractionAt,
  type ResizeSession,
} from "./resize.session.ts";

const PRIMARY_BUTTON = 0;
const CANCEL_KEY = "Escape";

export type ResizeSplitterProps = {
  splitId: NodeId;
  direction: SplitDirection;
  firstFraction: number;
};

export function ResizeSplitter({
  splitId,
  direction,
  firstFraction,
}: ResizeSplitterProps) {
  const resizeSplit = useWallStore((state) => state.resizeSplit);
  const elementRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<ResizeSession | null>(null);
  // The fraction changes on every pointer move; a ref keeps the handlers stable
  // and gives pointerdown the value as it stands at that instant.
  const fractionRef = useRef(firstFraction);
  fractionRef.current = firstFraction;

  // Detaches the window listeners installed for the current drag.
  const detachRef = useRef<(() => void) | null>(null);

  const endSession = useCallback(
    (restoreStartFraction: boolean) => {
      const session = sessionRef.current;
      if (session === null) return;
      sessionRef.current = null;
      detachRef.current?.();
      detachRef.current = null;
      resumePanePointerCapture();

      const element = elementRef.current;
      if (element !== null && element.hasPointerCapture(session.pointerId)) {
        element.releasePointerCapture(session.pointerId);
      }
      if (restoreStartFraction) {
        resizeSplit(session.splitId, session.startFraction);
      }
    },
    [resizeSplit],
  );

  // The newest `endSession`, so the unmount cleanup can run it without taking it
  // as a dependency: a cleanup that re-ran on every change would end a live drag.
  const endSessionRef = useRef(endSession);
  endSessionRef.current = endSession;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== CANCEL_KEY || sessionRef.current === null) return;
      event.preventDefault();
      endSession(true);
    };
    // Losing focus mid-drag never delivers pointerup, so without this the panes
    // would stay deaf to the cursor after the user tabs away.
    const onBlur = (): void => endSession(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [endSession]);

  // A split can be deleted mid-drag, taking this component with it. Ending the
  // session here too is what gives the panes the cursor back, and it detaches
  // the window listeners that would otherwise go on resizing a split that no
  // longer exists.
  useEffect(() => () => endSessionRef.current(false), []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== PRIMARY_BUTTON) return;
    // A second pointer pressing the handle would overwrite the live session and
    // orphan its window listeners, leaving them attached for good.
    if (sessionRef.current !== null) return;
    const element = event.currentTarget;
    const container = element.parentElement;
    if (container === null) return;

    event.preventDefault();
    // `preventDefault` above keeps the press from moving focus, so move it here.
    // Escape is heard on this window, and focus is often inside a pane's iframe,
    // whose keydown never reaches this document — the drag would be uncancellable.
    element.focus({ preventScroll: true });
    // Pointer capture retargets the moves to this element. It is not enough on
    // its own: a cross-origin iframe swallows the pointer inside its own
    // document, which is what the suppressor below is for.
    element.setPointerCapture(event.pointerId);
    sessionRef.current = beginResizeSession({
      splitId,
      direction,
      pointerId: event.pointerId,
      startFraction: fractionRef.current,
      container: domRectReader(container),
      splitter: domRectReader(element),
      pointer: { x: event.clientX, y: event.clientY },
    });
    suspendPanePointerCapture();

    // Listening on the window, not on this element: once the cursor is over a
    // pane the moves are delivered there, and an element-level handler would
    // simply stop hearing them. This is also what makes the suppressor matter —
    // an iframe that still took the cursor would keep the events inside its own
    // document, where the window above never sees them.
    const onMove = (moveEvent: globalThis.PointerEvent): void => {
      const session = sessionRef.current;
      if (session === null || session.pointerId !== moveEvent.pointerId) return;
      resizeSplit(
        session.splitId,
        fractionAt(session, { x: moveEvent.clientX, y: moveEvent.clientY }),
      );
    };
    // Only the pointer that began the drag may end it. A second finger lifting
    // is not the user letting go of the splitter.
    const onRelease = (releaseEvent: globalThis.PointerEvent): void => {
      if (sessionRef.current?.pointerId !== releaseEvent.pointerId) return;
      endSession(false);
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

  return (
    <div
      ref={elementRef}
      className={`noc-splitter noc-splitter--${direction}`}
      data-testid={`splitter-${splitId}`}
      data-split-id={splitId}
      role="separator"
      aria-orientation={direction === "row" ? "vertical" : "horizontal"}
      aria-valuenow={Math.round(firstFraction * 100)}
      // Focusable only programmatically: the drag needs somewhere to put focus
      // so Escape reaches this document. Keyboard resize is not implemented, so
      // the handle deliberately stays out of the tab order.
      tabIndex={-1}
      onPointerDown={onPointerDown}
    />
  );
}
