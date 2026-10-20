/**
 * The buttons that change a pane's place on the wall: split, minimise, close.
 *
 * It takes callbacks and holds no state, like `pane.urlbar`, so the frame stays
 * the only place that knows about the store. It is a sibling row under the
 * pane's body, never an overlay: a native webview paints above the whole web
 * layer, so a control drawn on top of a pane would simply not be there.
 *
 * The row is rendered for the pane's whole life, including while the URL bar is
 * hidden — "Show URL bar" lives here too, so hiding the bar never leaves a pane
 * without a way to reach it.
 */

import type { PaneId, SplitDirection } from "../layout/layout.types.ts";

export type PaneControlsProps = {
  paneId: PaneId;
  urlBarVisible: boolean;
  onSplit: (direction: SplitDirection) => void;
  onDock: () => void;
  onClose: () => void;
  onShowUrlBar: () => void;
};

export function PaneControls({
  paneId,
  urlBarVisible,
  onSplit,
  onDock,
  onClose,
  onShowUrlBar,
}: PaneControlsProps) {
  return (
    <div className="noc-pane__controls" data-testid={`pane-controls-${paneId}`}>
      {!urlBarVisible && (
        <button
          className="noc-pane__button"
          type="button"
          onClick={onShowUrlBar}
          data-testid={`pane-show-urlbar-${paneId}`}
        >
          Show URL bar
        </button>
      )}

      <button
        className="noc-pane__button"
        type="button"
        onClick={() => onSplit("row")}
        aria-label={`Split pane ${paneId} to the right`}
        title="Split side by side"
        data-testid={`pane-split-row-${paneId}`}
      >
        Split right
      </button>

      <button
        className="noc-pane__button"
        type="button"
        onClick={() => onSplit("column")}
        aria-label={`Split pane ${paneId} downwards`}
        title="Split top and bottom"
        data-testid={`pane-split-column-${paneId}`}
      >
        Split down
      </button>

      <button
        className="noc-pane__button"
        type="button"
        onClick={onDock}
        aria-label={`Minimise pane ${paneId} to the dock`}
        title="Minimise to the dock — the page keeps running"
        data-testid={`pane-dock-${paneId}`}
      >
        Minimise
      </button>

      <button
        className="noc-pane__button noc-pane__button--danger"
        type="button"
        onClick={onClose}
        aria-label={`Close pane ${paneId}`}
        title="Close this pane and discard its page"
        data-testid={`pane-close-${paneId}`}
      >
        Close
      </button>
    </div>
  );
}
