/**
 * The pages a pane holds, as rows in the ⋮ panel: pick one, drop one, add one.
 *
 * The switcher on the pane is for the gesture — next, next, back — and stops
 * naming the pages once there are more than a handful of them. This is where
 * they are named, chosen by name, and removed. It is also the only place that
 * can add one, since the panel is the only part of the chrome with a text
 * field, and a wall is configured here and watched out there.
 *
 * Adding reuses the panel's one input rather than growing a second: `mode` says
 * whether Enter repoints the page on screen or appends a new one. Two fields
 * 224px wide, one of them almost always wrong for what the user meant, was the
 * version this replaced.
 *
 * Split from `pane.menu-panel` to keep that file about the shape of a menu.
 */

import type { PaneId } from "../layout/layout.types.ts";
import type { PaneSitesControl } from "./pane.site-switcher.tsx";
import { urlHostLabel } from "./pane.url.ts";

export function PaneMenuSites({
  paneId,
  sites,
  adding,
  onAddMode,
}: {
  paneId: PaneId;
  sites: PaneSitesControl;
  adding: boolean;
  /** Puts the panel's input into "new site" mode; the panel owns the field. */
  onAddMode: () => void;
}) {
  // An empty pane has nothing to list, and the address field above already
  // gives it its first page.
  if (sites.list.length === 0) return null;

  return (
    <>
      <div className="noc-pane__menu-rule" />

      {sites.list.map((site, index) => (
        <div className="noc-pane__menu-site" key={site.id}>
          <button
            className="noc-pane__menu-item noc-pane__menu-site-pick"
            type="button"
            role="menuitemradio"
            aria-checked={site.id === sites.activeId}
            data-active={site.id === sites.activeId}
            data-testid={`pane-site-row-${site.id}`}
            title={site.url}
            onClick={() => sites.activate(site.id)}
          >
            {index + 1}. {urlHostLabel(site.url)}
          </button>
          <button
            className="noc-pane__menu-site-remove"
            type="button"
            role="menuitem"
            aria-label={`Remove ${urlHostLabel(site.url)} from pane ${paneId}`}
            title="Remove this site"
            data-testid={`pane-site-remove-${site.id}`}
            onClick={() => sites.remove(site.id)}
          >
            ×
          </button>
        </div>
      ))}

      <button
        className="noc-pane__menu-item"
        type="button"
        role="menuitem"
        aria-pressed={adding}
        data-active={adding}
        data-testid={`pane-site-add-${paneId}`}
        onClick={onAddMode}
      >
        {adding ? "Type the new site's URL above" : "Add site…"}
      </button>
    </>
  );
}
