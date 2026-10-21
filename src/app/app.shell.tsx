import { useEffect, useLayoutEffect, useRef } from "react";

import { geometryRegistry } from "../geometry/geometry.store.ts";
import { domRectReader, syncPaneGeometry } from "../geometry/geometry.sync.ts";
import { LayoutRenderer } from "../layout/layout.renderer.tsx";
import { PaneLayer } from "../pane/pane.layer.tsx";
import { useWallStore } from "../pane/pane.store.ts";

/**
 * Holds the two layers over one shared coordinate space.
 *
 * The layout layer draws the tree as empty slots; the pane layer sits above it
 * and never changes order. Geometry is copied from slots to panes imperatively
 * after every commit, so moving a pane never involves React.
 *
 * The shell is the whole wall. It used to be wrapped in a column that reserved
 * room under it for the dock strip; with minimise gone there is nothing left to
 * reserve room for, and a wrapper that holds one child is a box to look past.
 */
export function AppShell() {
  const tree = useWallStore((state) => state.tree);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // After layout, before paint: panes must not be seen at a stale rect.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    syncPaneGeometry(container, geometryRegistry, domRectReader);
  }, [tree]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      syncPaneGeometry(container, geometryRegistry, domRectReader);
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
