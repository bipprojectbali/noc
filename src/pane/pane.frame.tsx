import { useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { isNativeHost } from "../native/native.bridge.ts";
import { isPane, type PaneId, type PaneSite } from "../layout/layout.types.ts";
import { DEFAULT_ZOOM } from "../layout/layout.zoom.ts";
import { usePaneChrome } from "./pane.chrome-channel.ts";
import { PaneCookieNotice } from "./pane.cookie-notice.tsx";
import { INITIAL_PANE_LOAD_STATE, type PaneLoadState } from "./pane.load-state.ts";
import { PaneMenu } from "./pane.menu.tsx";
import { paneRendererFor } from "./pane.renderer.ts";
import { useWallStore } from "./pane.store.ts";
import { urlHostLabel } from "./pane.url.ts";

export type PaneFrameProps = { paneId: PaneId };

/** Stable identity, so the shallow compare below is not defeated by it. */
const NO_SITES: readonly PaneLoadState[] = [];
/** Same, for a pane the tree no longer holds. */
const NO_PANE_SITES: readonly PaneSite[] = [];

/**
 * One pane: its chrome and its content.
 *
 * A pane holds a list of sites and mounts every one of them at once, stacked in
 * the body's single grid cell, with all but the active one hidden. Content is
 * mounted for as long as the pane holds that site and is only ever hidden:
 * unmounting it, or moving it to a different parent in the DOM, reloads the
 * page and discards everything it holds.
 *
 * The chrome floats over that content in both renderers, and no pane spends any
 * height on it. Over an iframe the floating chrome is simply visible. Over a
 * native webview it is not — the webview is an OS-level view that paints above
 * the entire web layer — so the shell parks an 88x40 chrome webview in the same
 * corner, carrying the same ⋮ and the same pips, and its clicks arrive here over
 * `pane.chrome-channel`. That is what let the 20px seam a webview pane used to
 * reserve go away. Both ⋮ open this one `menuOpen`, and the moment it is open
 * every webview hides, so the DOM chrome the native one stands in for is back
 * in its place.
 *
 * Whether the menu is open lives here rather than in `pane.menu`, because the
 * empty-pane message opens it too: right-click reaches only the surfaces this
 * app owns, and an empty pane is one of them.
 */
export function PaneFrame({ paneId }: PaneFrameProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const node = useWallStore((state) => state.tree.nodes[paneId]);
  // One entry per site, in the pane's own order. The stored state objects are
  // compared by identity, so a probe settling in another pane is not a render
  // here — and an array of them is what keeps this to one subscription.
  const loads = useWallStore(
    useShallow((state): readonly PaneLoadState[] => {
      const pane = state.tree.nodes[paneId];
      if (pane === undefined || !isPane(pane)) return NO_SITES;
      return pane.sites.map(
        (site) => state.load[site.id] ?? INITIAL_PANE_LOAD_STATE,
      );
    }),
  );
  const error = useWallStore((state) => state.urlError[paneId] ?? null);
  const submitUrl = useWallStore((state) => state.submitUrl);
  const addSite = useWallStore((state) => state.addSite);
  const activateSite = useWallStore((state) => state.activateSite);
  const toggleSite = useWallStore((state) => state.toggleSite);
  const removeSite = useWallStore((state) => state.removeSite);
  const setSiteZoom = useWallStore((state) => state.setSiteZoom);
  const reloadPane = useWallStore((state) => state.reloadPane);
  const splitPane = useWallStore((state) => state.splitPane);
  const deletePane = useWallStore((state) => state.deletePane);
  const setPaneStrategy = useWallStore((state) => state.setPaneStrategy);

  // The chrome the shell draws over this pane's webview, in both directions:
  // its clicks come back here, and it is told which pages the pane holds so its
  // pips can say which one is showing. It only ever names sites, never panes —
  // the shell has no idea a pane holds several — so the list below is both the
  // message and the filter. Before the early return, because a hook cannot be
  // conditional, which is why the pane is read defensively here.
  const pane = node !== undefined && isPane(node) ? node : null;
  usePaneChrome({
    sites: pane?.sites ?? NO_PANE_SITES,
    activeId: pane?.activeSiteId ?? null,
    onOpenMenu: () => setMenuOpen(true),
    onActivate: (siteId) => activateSite(paneId, siteId),
  });

  if (node === undefined || !isPane(node)) {
    return <div className="noc-error">Pane {paneId} is not in the layout.</div>;
  }

  const activeIndex = node.sites.findIndex((site) => site.id === node.activeSiteId);
  const activeSite = node.sites[activeIndex];
  const url = activeSite?.url ?? null;
  // The chrome asks about the page on screen. The pane's other pages are
  // loaded and hidden, and nothing above here asks about them collectively.
  const load = loads[activeIndex] ?? INITIAL_PANE_LOAD_STATE;
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
        sites={{
          list: node.sites,
          activeId: node.activeSiteId,
          activate: (siteId) => activateSite(paneId, siteId),
          next: () => toggleSite(paneId),
          add: (raw) => addSite(paneId, raw),
          remove: (siteId) => removeSite(paneId, siteId),
        }}
        zoom={{
          // The page on screen, and only that one: the pane's other pages keep
          // whatever they were set to, which is the point of storing this per
          // site. An empty pane has nothing to magnify and says so with null.
          level: activeSite?.zoom ?? null,
          applies: renderer.kind === "iframe",
          set: (level) => {
            if (activeSite !== undefined) setSiteZoom(paneId, activeSite.id, level);
          },
        }}
        error={error}
        strategy={node.strategy}
        nativeHost={nativeHost}
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
        {/* One element per site, all of them in the body's single grid cell and
            all mounted for as long as the pane holds the site. Only the active
            one is shown: unmounting a page, or moving it in the DOM, reloads it
            and costs it its scroll position and its session. A pane with no
            sites still mounts one, keyed by the pane, so the renderer has
            somewhere to put the empty-pane case. */}
        {node.sites.length === 0 ? (
          <renderer.Content
            paneId={paneId}
            siteId={paneId}
            url={null}
            load={INITIAL_PANE_LOAD_STATE}
            active
            zoom={DEFAULT_ZOOM}
          />
        ) : (
          node.sites.map((site, index) => (
            <renderer.Content
              key={site.id}
              paneId={paneId}
              siteId={site.id}
              url={site.url}
              load={loads[index] ?? INITIAL_PANE_LOAD_STATE}
              active={site.id === node.activeSiteId}
              zoom={site.zoom}
            />
          ))
        )}

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

        {/* Same boundary as the refusal below: a native webview is a top-level
            document, so neither framing headers nor `SameSite` reach it. */}
        {framingApplies && (load.kind === "loading" || load.kind === "ready") && (
          <PaneCookieNotice
            paneId={paneId}
            decision={load.cookies}
            nativeHost={nativeHost}
          />
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
              <strong>{urlHostLabel(load.url)} refuses to be framed.</strong>
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
