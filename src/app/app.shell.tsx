import { isPane } from "../layout/layout.types.ts";
import { PaneFrame } from "../pane/pane.frame.tsx";
import { useWallStore } from "../pane/pane.store.ts";

/**
 * M1 shell: renders the root pane only.
 *
 * Tree rendering, splitters and the dock strip arrive with the layout layer;
 * the pane layer they will drive is deliberately not built yet.
 */
export function AppShell() {
  const rootId = useWallStore((state) => state.tree.rootId);
  const root = useWallStore((state) => state.tree.nodes[state.tree.rootId]);

  if (root === undefined || !isPane(root)) {
    return <div className="noc-error">Layout root is not a single pane yet.</div>;
  }

  return (
    <main className="noc-shell">
      <PaneFrame paneId={rootId} />
    </main>
  );
}
