import { useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { isPane, type PaneId } from "../layout/layout.types.ts";
import { DEFAULT_ZOOM } from "../layout/layout.zoom.ts";
import { PaneCookieNotice } from "./pane.cookie-notice.tsx";
import { PaneIframe } from "./pane.iframe-renderer.tsx";
import { INITIAL_PANE_LOAD_STATE, type PaneLoadState } from "./pane.load-state.ts";
import { PaneMenu } from "./pane.menu.tsx";
import { useWallStore } from "./pane.store.ts";
import { urlHostLabel } from "./pane.url.ts";

export type PaneFrameProps = { paneId: PaneId };

/** Stable identity, so the shallow compare below is not defeated by it. */
const NO_SITES: readonly PaneLoadState[] = [];

/**
 * One pane: its chrome and its content.
 *
 * A pane holds a list of sites and mounts every one of them at once, stacked in
 * the body's single grid cell, with all but the active one hidden. Content is
 * mounted for as long as the pane holds that site and is only ever hidden:
 * unmounting it, or moving it to a different parent in the DOM, reloads the
 * page and discards everything it holds.
 *
 * The chrome floats over that content and no pane spends any height on it: a
 * reserved strip is what made the wall read as a grid of boxes rather than one
 * surface.
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

  if (node === undefined || !isPane(node)) {
    return <div className="noc-error">Pane {paneId} is not in the layout.</div>;
  }

  const activeIndex = node.sites.findIndex((site) => site.id === node.activeSiteId);
  const activeSite = node.sites[activeIndex];
  const url = activeSite?.url ?? null;
  // The chrome asks about the page on screen. The pane's other pages are
  // loaded and hidden, and nothing above here asks about them collectively.
  const load = loads[activeIndex] ?? INITIAL_PANE_LOAD_STATE;

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
          set: (level) => {
            if (activeSite !== undefined) setSiteZoom(paneId, activeSite.id, level);
          },
        }}
        error={error}
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
          <PaneIframe
            paneId={paneId}
            siteId={paneId}
            url={null}
            load={INITIAL_PANE_LOAD_STATE}
            active
            zoom={DEFAULT_ZOOM}
          />
        ) : (
          node.sites.map((site, index) => (
            <PaneIframe
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

        {(load.kind === "loading" || load.kind === "ready") && (
          <PaneCookieNotice paneId={paneId} decision={load.cookies} />
        )}

        {load.kind === "probing" && (
          <p className="noc-pane__status">Checking whether {load.url} can be framed…</p>
        )}

        {load.kind === "refused" && (
          <div
            className="noc-pane__status noc-pane__status--refused"
            role="status"
            data-testid={`pane-refused-${paneId}`}
          >
            <div>
              <strong>{urlHostLabel(load.url)} refuses to be framed.</strong>
              <div className="noc-pane__reason">{load.reason}</div>
              {/* This can only be seen on a wall opened at an address that
                  cannot proxy — `127.0.0.1`. On the wall's own proxy host the
                  site is served from a sibling subdomain, which strips the
                  refusal, and `/api/embeddability` answers "unknown" rather
                  than claiming a refusal that will not happen. */}
              <div className="noc-pane__reason">
                Open this wall at its own hostname, where the site is served
                same-site and framing headers no longer apply, or allow this
                origin in the target's own headers.
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
