import { useState } from "react";

import { isNativeHost } from "../native/native.bridge.ts";
import { activePaneUrl } from "../layout/layout.sites.ts";
import { isPane, type PaneId } from "../layout/layout.types.ts";
import { PaneMenu } from "./pane.menu.tsx";
import { paneRendererFor } from "./pane.renderer.ts";
import { paneLoadState, useWallStore } from "./pane.store.ts";

export type PaneFrameProps = { paneId: PaneId };

/**
 * One pane: its chrome and its content.
 *
 * The content is mounted for the pane's whole life and only ever hidden.
 * Unmounting it, or moving it to a different parent in the DOM, reloads the
 * site and discards everything it holds.
 *
 * Whether the chrome may float over that content is decided here, per pane,
 * from the renderer actually serving it — not from the host, and not once for
 * the wall. An iframe is in the DOM and can be drawn over, so its pane spends
 * no height on chrome at all. A native webview paints above the entire web
 * layer and ignores CSS clipping, so a button floating over one would not be
 * there; that pane keeps a seam instead. A wall can hold both at once.
 *
 * Whether the menu is open lives here rather than in `pane.menu`, because the
 * empty-pane message opens it too: right-click reaches only the surfaces this
 * app owns, and an empty pane is one of them.
 */
export function PaneFrame({ paneId }: PaneFrameProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const node = useWallStore((state) => state.tree.nodes[paneId]);
  const load = useWallStore((state) => paneLoadState(state, paneId));
  const error = useWallStore((state) => state.urlError[paneId] ?? null);
  const submitUrl = useWallStore((state) => state.submitUrl);
  const reloadPane = useWallStore((state) => state.reloadPane);
  const splitPane = useWallStore((state) => state.splitPane);
  const deletePane = useWallStore((state) => state.deletePane);
  const setPaneStrategy = useWallStore((state) => state.setPaneStrategy);

  if (node === undefined || !isPane(node)) {
    return <div className="noc-error">Pane {paneId} is not in the layout.</div>;
  }

  const url = activePaneUrl(node);
  const renderer = paneRendererFor(node.strategy);
  // Framing permission is an iframe problem. A native webview is a top-level
  // document, so reporting a refusal there would be reporting a limit that does
  // not exist for this pane.
  const framingApplies = renderer.kind === "iframe";
  // The renderer that escapes framing is a native view: in a browser there is
  // nothing to switch to, and saying so beats offering a way out that is not one.
  const nativeHost = isNativeHost();

  return (
    <section className="noc-pane" data-pane-id={paneId}>
      <PaneMenu
        paneId={paneId}
        url={url}
        error={error}
        strategy={node.strategy}
        nativeHost={nativeHost}
        floating={renderer.kind === "iframe"}
        open={menuOpen}
        onOpenChange={setMenuOpen}
        onSubmit={(raw) => {
          submitUrl(paneId, raw);
          // The store writes synchronously, so this is the verdict on what was
          // just typed. A rejected address keeps the panel up, because the
          // message explaining the rejection is inside it.
          if (useWallStore.getState().urlError[paneId] == null) setMenuOpen(false);
        }}
        onReload={() => {
          reloadPane(paneId);
          setMenuOpen(false);
        }}
        onStrategyChange={(strategy) => setPaneStrategy(paneId, strategy)}
        onSplit={(direction) => {
          splitPane(paneId, direction);
          setMenuOpen(false);
        }}
        onClose={() => deletePane(paneId)}
      />

      <div className="noc-pane__body">
        <renderer.Content paneId={paneId} url={url} load={load} />

        {load.kind === "empty" && (
          <p
            className="noc-pane__status"
            data-testid={`pane-empty-${paneId}`}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenuOpen(true);
            }}
          >
            Empty pane. Right-click here, or use ⋮, to give it a URL.
          </p>
        )}

        {load.kind === "probing" && framingApplies && (
          <p className="noc-pane__status">Checking whether {load.url} can be framed…</p>
        )}

        {load.kind === "refused" && framingApplies && (
          <div
            className="noc-pane__status noc-pane__status--refused"
            role="status"
            data-testid={`pane-refused-${paneId}`}
          >
            <div>
              <strong>{new URL(load.url).host} refuses to be framed.</strong>
              <div className="noc-pane__reason">{load.reason}</div>
              <div className="noc-pane__reason">
                {nativeHost
                  ? "Allow this origin in the target's own headers, or set this pane's renderer to Webview in its ⋮ menu — a native webview is a top-level document, and the switch reloads the page."
                  : "Allow this origin in the target's own headers. The renderer this cannot refuse is a native webview, and that exists only in the desktop app."}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
