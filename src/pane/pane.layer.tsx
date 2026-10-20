/**
 * The pane layer: every live pane, in one flat list that never reorders.
 *
 * Order is creation order, which never changes, so a new pane always appends
 * and React never moves an existing host. Each host is positioned over its slot
 * by `geometry.sync`. This is what keeps an iframe's DOM node — and the page
 * inside it — alive across splits, docks and deletes.
 */

import { useCallback } from "react";
import { useShallow } from "zustand/shallow";

import { geometryRegistry } from "../geometry/geometry.store.ts";
import { isPane, type PaneId } from "../layout/layout.types.ts";
import { PaneDropOverlay } from "./pane.drop-overlay.tsx";
import { PaneFrame } from "./pane.frame.tsx";
import { useWallStore } from "./pane.store.ts";

function PaneHost({ paneId }: { paneId: PaneId }) {
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      geometryRegistry.registerHost(paneId, element);
    },
    [paneId],
  );

  return (
    <div
      className="noc-pane-host"
      ref={attach}
      data-pane-host={paneId}
      data-testid={`pane-host-${paneId}`}
    >
      <PaneFrame paneId={paneId} />
      {/* A sibling of the frame, not a child: it has to cover the pane's own
          chrome, and subscribing here instead of inside `PaneFrame` keeps a
          drag from re-rendering the element the page lives in. */}
      <PaneDropOverlay paneId={paneId} />
    </div>
  );
}

/**
 * Every pane that exists, placed or docked, in stable creation order.
 *
 * `useShallow` matters here: without it this selector builds a new array on
 * every store change — including a pane's load state — and re-renders the whole
 * layer for nothing.
 */
export function usePaneIdsInCreationOrder(): PaneId[] {
  return useWallStore(
    useShallow((state) =>
      Object.values(state.tree.nodes)
        .filter(isPane)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
        .map((pane) => pane.id),
    ),
  );
}

export function PaneLayer() {
  const paneIds = usePaneIdsInCreationOrder();

  return (
    <div className="noc-pane-layer">
      {paneIds.map((paneId) => (
        <PaneHost key={paneId} paneId={paneId} />
      ))}
    </div>
  );
}
