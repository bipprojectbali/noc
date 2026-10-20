import { useEffect, useLayoutEffect, useRef } from "react";

import { geometryRegistry } from "../geometry/geometry.store.ts";
import { domRectReader, syncPaneGeometry } from "../geometry/geometry.sync.ts";
import { LayoutRenderer } from "../layout/layout.renderer.tsx";
import { PaneDock } from "../pane/pane.dock.tsx";
import { PaneLayer } from "../pane/pane.layer.tsx";
import { placePane } from "../pane/pane.renderer.ts";
import { useWallStore } from "../pane/pane.store.ts";

/**
 * Holds the two layers over one shared coordinate space.
 *
 * The layout layer draws the tree as empty slots; the pane layer sits above it
 * and never changes order. Geometry is copied from slots to panes imperatively
 * after every commit, so moving a pane never involves React.
 *
 * The dock strip is a sibling below the shell, not inside it: the shell is the
 * box panes are placed into, and a native webview paints over everything in it.
 */
export function AppShell() {
  const tree = useWallStore((state) => state.tree);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // After layout, before paint: panes must not be seen at a stale rect.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    syncPaneGeometry(container, geometryRegistry, domRectReader, placePane);
  }, [tree]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      syncPaneGeometry(container, geometryRegistry, domRectReader, placePane);
    });
    observer.observe(container);
    for (const slot of container.querySelectorAll("[data-pane-slot]")) {
      observer.observe(slot);
    }
    return () => observer.disconnect();
  }, [tree]);

  return (
    <div className="noc-wall">
      <main className="noc-shell" ref={containerRef}>
        <div className="noc-layout">
          <LayoutRenderer tree={tree} />
        </div>
        <PaneLayer />
      </main>
      <PaneDock />
    </div>
  );
}
