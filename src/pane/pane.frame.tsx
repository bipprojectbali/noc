import { isPane, type PaneId } from "../layout/layout.types.ts";
import { paneRendererFor } from "./pane.renderer.ts";
import { paneLoadState, useWallStore } from "./pane.store.ts";
import { PaneUrlBar } from "./pane.urlbar.tsx";

export type PaneFrameProps = { paneId: PaneId };

/**
 * One pane: its chrome and its content.
 *
 * The content is mounted for the pane's whole life and only ever hidden.
 * Unmounting it, or moving it to a different parent in the DOM, reloads the
 * site and discards everything it holds.
 *
 * Chrome is a sibling of the content, never an overlay. Under the webview
 * renderer the pane is a native view that paints above the whole web layer, so
 * anything drawn on top of it would simply not be there.
 */
export function PaneFrame({ paneId }: PaneFrameProps) {
  const node = useWallStore((state) => state.tree.nodes[paneId]);
  const load = useWallStore((state) => paneLoadState(state, paneId));
  const error = useWallStore((state) => state.urlError[paneId] ?? null);
  const submitUrl = useWallStore((state) => state.submitUrl);
  const reloadPane = useWallStore((state) => state.reloadPane);
  const setUrlBarVisible = useWallStore((state) => state.setUrlBarVisible);

  if (node === undefined || !isPane(node)) {
    return <div className="noc-error">Pane {paneId} is not in the layout.</div>;
  }

  const renderer = paneRendererFor(node.strategy);
  // Framing permission is an iframe problem. A native webview is a top-level
  // document, so reporting a refusal there would be reporting a limit that does
  // not exist for this pane.
  const framingApplies = renderer.kind === "iframe";

  return (
    <section className="noc-pane" data-pane-id={paneId}>
      {node.urlBarVisible && (
        <PaneUrlBar
          paneId={paneId}
          url={node.url}
          error={error}
          onSubmit={(raw) => submitUrl(paneId, raw)}
          onReload={() => reloadPane(paneId)}
          onHide={() => setUrlBarVisible(paneId, false)}
        />
      )}

      <div className="noc-pane__body">
        <renderer.Content paneId={paneId} url={node.url} load={load} />

        {load.kind === "empty" && (
          <p className="noc-pane__status">
            {node.urlBarVisible
              ? "Enter a URL to fill this pane."
              : "Empty pane. Show the URL bar to fill it."}
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
                Allow this origin in the target's own headers, or give this pane the
                native webview renderer.
              </div>
            </div>
          </div>
        )}
      </div>

      {!node.urlBarVisible && (
        <button
          className="noc-pane__button"
          type="button"
          onClick={() => setUrlBarVisible(paneId, true)}
        >
          Show URL bar
        </button>
      )}
    </section>
  );
}
