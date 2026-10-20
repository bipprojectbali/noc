/**
 * The dock strip: the only way back for a minimised pane.
 *
 * A docked pane keeps its node, its host and its live page — it just has no
 * slot in the tree, so `geometry.sync` hides it. Without this strip there would
 * be no handle on it at all: its own controls are hidden with it, which would
 * also leave it impossible to close.
 *
 * It lives outside `.noc-shell`, below the wall. The shell is the coordinate
 * space the pane hosts are placed into, and a native webview paints above the
 * web layer regardless of CSS, so a strip drawn inside that box would be
 * covered by the panes it is meant to control.
 *
 * `undockPane` wants a host pane to split, and the UI has no way yet to say
 * which one. It restores beside the first pane of the tree, splitting left and
 * right. Choosing a target needs either a selected-pane concept or a drop
 * target, and neither exists.
 */

import { isPane, type LayoutNode, type PaneId } from "../layout/layout.types.ts";
import { listTreePaneIds } from "../layout/layout.tree.ts";
import { useWallStore } from "./pane.store.ts";

export function PaneDock() {
  const tree = useWallStore((state) => state.tree);
  const undockPane = useWallStore((state) => state.undockPane);
  const deletePane = useWallStore((state) => state.deletePane);

  if (tree.dock.length === 0) return null;

  // The tree is never empty, so this is always a pane — but the type cannot say
  // so, and a disabled button beats a thrown error if that ever stops holding.
  const [hostPaneId] = listTreePaneIds(tree);

  return (
    <aside className="noc-dock" data-testid="pane-dock-strip">
      <span className="noc-dock__label">Minimised</span>
      {tree.dock.map(({ paneId }) => (
        <DockEntry
          key={paneId}
          paneId={paneId}
          title={titleOf(tree.nodes[paneId])}
          onRestore={
            hostPaneId === undefined
              ? null
              : () => undockPane(paneId, hostPaneId, "row")
          }
          onClose={() => deletePane(paneId)}
        />
      ))}
    </aside>
  );
}

function titleOf(node: LayoutNode | undefined): string {
  if (node === undefined || !isPane(node)) return "Unknown pane";
  return node.url ?? "Empty pane";
}

function DockEntry({
  paneId,
  title,
  onRestore,
  onClose,
}: {
  paneId: PaneId;
  title: string;
  onRestore: (() => void) | null;
  onClose: () => void;
}) {
  return (
    <span className="noc-dock__entry" data-testid={`dock-entry-${paneId}`}>
      <span className="noc-dock__title" title={title}>
        {title}
      </span>
      <button
        className="noc-pane__button"
        type="button"
        disabled={onRestore === null}
        onClick={() => onRestore?.()}
        aria-label={`Restore pane ${paneId}`}
        data-testid={`dock-restore-${paneId}`}
      >
        Restore
      </button>
      <button
        className="noc-pane__button noc-pane__button--danger"
        type="button"
        onClick={onClose}
        aria-label={`Close minimised pane ${paneId}`}
        data-testid={`dock-close-${paneId}`}
      >
        Close
      </button>
    </span>
  );
}
