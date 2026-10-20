import { isNativeHost } from "../native/native.bridge.ts";
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
  const setPaneStrategy = useWallStore((state) => state.setPaneStrategy);

  if (node === undefined || !isPane(node)) {
    return <div className="noc-error">Pane {paneId} is not in the layout.</div>;
  }

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
      {node.urlBarVisible && (
        <PaneUrlBar
          paneId={paneId}
          url={node.url}
          error={error}
          strategy={node.strategy}
          nativeHost={nativeHost}
          onSubmit={(raw) => submitUrl(paneId, raw)}
          onReload={() => reloadPane(paneId)}
          onStrategyChange={(strategy) => setPaneStrategy(paneId, strategy)}
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
                {nativeHost
                  ? "Allow this origin in the target's own headers, or set this pane's renderer to Webview in the URL bar — a native webview is a top-level document, and the switch reloads the page."
                  : "Allow this origin in the target's own headers. The renderer this cannot refuse is a native webview, and that exists only in the desktop app."}
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
