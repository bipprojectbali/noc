/**
 * What a pane looks like while a drag is in flight.
 *
 * It exists only while a drag is in flight; outside that window it renders
 * nothing at all. Every pane gets a marked state for the duration: the one
 * being carried, the one about to receive it with the landing area shaded, and
 * every other pane outlined and named by host — so the gesture reads as one
 * move across the whole wall rather than an effect on two of its boxes.
 *
 * `pointer-events: none` throughout, or the overlay would be the thing
 * `elementFromPoint` finds and every drop would land on the pane it started
 * from.
 */

import { activePaneUrl } from "../layout/layout.sites.ts";
import { isPane, type PaneId } from "../layout/layout.types.ts";
import { usePaneDragStore } from "./pane.drag.ts";
import { useWallStore } from "./pane.store.ts";
import { urlHostLabel } from "./pane.url.ts";

/** The pane's host, or a word for a pane that has no address yet. */
function paneLabel(url: string | null): string {
  return url === null ? "Empty pane" : urlHostLabel(url);
}

export function PaneDropOverlay({ paneId }: { paneId: PaneId }) {
  const drag = usePaneDragStore((state) => state.drag);
  const url = useWallStore((state) => {
    const node = state.tree.nodes[paneId];
    return node !== undefined && isPane(node) ? activePaneUrl(node) : null;
  });

  if (drag === null) return null;

  const role =
    drag.paneId === paneId
      ? "source"
      : drag.targetPaneId === paneId
        ? "target"
        : "idle";

  return (
    <div
      className={`noc-pane-drop noc-pane-drop--${role}`}
      data-testid={`pane-drop-${paneId}`}
      data-drop-role={role}
      data-drop-zone={role === "target" ? drag.zone : undefined}
    >
      {role === "target" && (
        <div className={`noc-pane-drop__zone noc-pane-drop__zone--${drag.zone}`} />
      )}
      <span className="noc-pane-drop__label">
        {role === "source" ? `Moving ${paneLabel(url)}` : paneLabel(url)}
      </span>
    </div>
  );
}
