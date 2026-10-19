import { useEffect, useLayoutEffect, useRef } from "react";

import { geometryRegistry } from "../geometry/geometry.store.ts";
import { syncPaneGeometry } from "../geometry/geometry.sync.ts";
import { LayoutRenderer } from "../layout/layout.renderer.tsx";
import { PaneLayer } from "../pane/pane.layer.tsx";
import { useWallStore } from "../pane/pane.store.ts";

/**
 * Holds the two layers over one shared coordinate space.
 *
 * The layout layer draws the tree as empty slots; the pane layer sits above it
 * and never changes order. Geometry is copied from slots to panes imperatively
 * after every commit, so moving a pane never involves React.
 */
export function AppShell() {
  const tree = useWallStore((state) => state.tree);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // After layout, before paint: panes must not be seen at a stale rect.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    syncPaneGeometry(container, geometryRegistry);
  }, [tree]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      syncPaneGeometry(container, geometryRegistry);
    });
    observer.observe(container);
    for (const slot of container.querySelectorAll("[data-pane-slot]")) {
      observer.observe(slot);
    }
    return () => observer.disconnect();
  }, [tree]);

  return (
    <main className="noc-shell" ref={containerRef}>
      <div className="noc-layout">
        <LayoutRenderer tree={tree} />
      </div>
      <PaneLayer />
    </main>
  );
}
