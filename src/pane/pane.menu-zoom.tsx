/**
 * The zoom row of the ⋮ panel: − , the level, + .
 *
 * It lives in the menu because there is nowhere else it could. Ctrl+scroll and
 * pinch over the page are impossible from here — a cross-origin iframe keeps
 * wheel events inside its own document — so the only surfaces this app can
 * hear are its own chrome. No keyboard shortcut either: the wall page never
 * has focus while someone is looking at a pane.
 *
 * Its own file because the panel is already past this repo's 150-line cap for a
 * component, and this block reads one site field and writes it back, sharing
 * nothing with the rows around it.
 *
 * The level doubles as the way back to 100% — a fourth button for "reset" in a
 * 224px panel buys nothing a click on the number does not, and the number is
 * where the eye already is. Disabled at 100%, which is also when there is
 * nothing to reset to.
 *
 * Both ends of the ladder disable rather than wrap or sit inert: a button that
 * can be pressed and does nothing reads as broken, and wrapping from 200% to
 * 50% would be a trap on a wall watched from across a room.
 */

import type { PaneId } from "../layout/layout.types.ts";
import {
  canZoomIn,
  canZoomOut,
  DEFAULT_ZOOM,
  formatZoom,
  isDefaultZoom,
  zoomIn,
  zoomOut,
} from "../layout/layout.zoom.ts";

export type PaneZoomControl = {
  /** The active page's level, or null when the pane holds no page to magnify. */
  level: number | null;
  set: (level: number) => void;
};

export type PaneMenuZoomFieldProps = { paneId: PaneId; zoom: PaneZoomControl };

export function PaneMenuZoomField({ paneId, zoom }: PaneMenuZoomFieldProps) {
  const level = zoom.level ?? DEFAULT_ZOOM;
  const off = zoom.level === null;
  // On the wrapper, not the buttons: a disabled button takes no pointer, so a
  // title on it is a tooltip nobody can summon.
  const reason = off ? "This pane has no page to magnify yet." : undefined;

  return (
    <div className="noc-pane__menu-field">
      <span>Zoom</span>
      <div className="noc-pane__zoom" title={reason}>
        <button
          className="noc-pane__zoom-step"
          type="button"
          aria-label={`Zoom out pane ${paneId}`}
          data-testid={`pane-zoom-out-${paneId}`}
          disabled={off || !canZoomOut(level)}
          onClick={() => zoom.set(zoomOut(level))}
        >
          −
        </button>
        <button
          className="noc-pane__zoom-level"
          type="button"
          aria-label={`Reset pane ${paneId} to 100%`}
          data-testid={`pane-zoom-level-${paneId}`}
          disabled={off || isDefaultZoom(level)}
          onClick={() => zoom.set(DEFAULT_ZOOM)}
        >
          {formatZoom(level)}
        </button>
        <button
          className="noc-pane__zoom-step"
          type="button"
          aria-label={`Zoom in pane ${paneId}`}
          data-testid={`pane-zoom-in-${paneId}`}
          disabled={off || !canZoomIn(level)}
          onClick={() => zoom.set(zoomIn(level))}
        >
          +
        </button>
      </div>
    </div>
  );
}
