/**
 * What a pane looks like while a drag is in flight.
 *
 * This is the one overlay in the codebase that is unconditionally safe, and for
 * a narrow reason: it only ever exists while a drag holds the pointer
 * suppressor, which hides every native webview. For that window there is no
 * OS-level view left to paint over, so the wall is pure DOM and an overlay
 * behaves. Outside that window it renders nothing at all.
 *
 * Which is also the problem it has to solve. A dragged-over wall shows its
 * webview panes as empty boxes while its iframe panes keep their page, and a
 * wall can hold both — so without help the gesture reads as half the screen
 * breaking. Every pane therefore gets a marked state for the duration: the one
 * being carried, the one about to receive it with the landing area shaded, and
 * every other pane outlined and named by host. Naming them is what makes a
 * blanked webview pane identifiable rather than a hole.
 *
 * `pointer-events: none` throughout, or the overlay would be the thing
 * `elementFromPoint` finds and every drop would land on the pane it started
 * from.
 */

import { isPane, type PaneId } from "../layout/layout.types.ts";
import { usePaneDragStore } from "./pane.drag.ts";
import { useWallStore } from "./pane.store.ts";

/** The pane's host, or a word for a pane that has no address yet. */
function paneLabel(url: string | null): string {
  if (url === null) return "Empty pane";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function PaneDropOverlay({ paneId }: { paneId: PaneId }) {
  const drag = usePaneDragStore((state) => state.drag);
  const url = useWallStore((state) => {
    const node = state.tree.nodes[paneId];
    return node !== undefined && isPane(node) ? node.url : null;
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
