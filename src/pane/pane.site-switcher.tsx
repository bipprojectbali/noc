/**
 * Switching between the pages one pane holds, without opening a menu.
 *
 * A pane that holds several sites needs its switch on the pane, not two clicks
 * deep: cycling dashboards is the gesture the feature exists for, and the ⋮
 * panel blanks every native webview on the wall while it is open.
 *
 * It takes the **same shape as ⋮ and for the same reason** — it floats over the
 * pane's top-right corner under either renderer — which is why it is rendered by
 * `pane.menu` inside that one chrome container rather than owning a box of its
 * own. Over a native child webview nothing the web layer draws is visible at all
 * (invariant 3), so what the user sees there is the shell's stand-in: the chrome
 * webview in `server.chrome-page.ts` draws these same pips from the list this
 * pane sends it over `pane.chrome-channel`. Two renderings of one control, which
 * is the price of the corner no longer costing the page a 20px row — and the
 * reason the geometry here is a contract, not a preference.
 *
 * Two forms, because a pane can be ~96px wide (`MIN_FRACTION` 0.05 of a 1920
 * wall) and the chrome also has to hold ⋮:
 *
 * - Up to `MAX_INLINE_SITE_PIPS` sites: one pip each, 8px with a 4px gap, so
 *   the row is `12n - 4` px. Clicking a pip shows that page — with two sites
 *   that is the whole "switch between them" gesture, and the pips say which of
 *   them is on screen, which a single toggle cannot.
 * - More: one `3/8` chip that advances on click and wraps. The exact page is
 *   then chosen from the list in the ⋮ panel. Pips past four stop being
 *   targets a pointer can hit on a narrow pane, and a chip costs ~28px however
 *   many pages there are.
 *
 * The numbers above are arithmetic against a CSS file that no test loads, so
 * they are a budget rather than a measurement — see `app.css` and the open
 * items in the README.
 *
 * Opacity is not ⋮'s, and the numbers are measured rather than chosen. ⋮ rests
 * at 0.3 because it is a command nobody needs until they want it; this is
 * *status* — which page of several is showing — and a status that is invisible
 * until hovered is a status nobody reads. The earlier pair, 0.28 inactive and
 * 0.55 active, came to about 1.7:1 and 3.2:1 against a white dashboard, so this
 * docblock used to claim the pips "rest legible" while they did not. They now
 * rest at 0.55 and the active one is opaque.
 */

import type { PaneId, PaneSite, SiteId } from "../layout/layout.types.ts";
import { urlHostLabel } from "./pane.url.ts";

/**
 * Where pips stop fitting next to ⋮ on the narrowest pane the wall will make.
 * `MAX_PIPS` in `server.chrome-page.ts` is the same number, and has to be: the
 * shell's stand-in chrome is sized for exactly this many, and a pane does not
 * change the control it offers because of its renderer.
 */
export const MAX_INLINE_SITE_PIPS = 4;

/**
 * A pane's list of pages and everything that can be done to it, bundled because
 * three controls need the same six values: this switcher, the site list in the
 * ⋮ panel, and the menu that holds both.
 */
export type PaneSitesControl = {
  list: readonly PaneSite[];
  activeId: SiteId | null;
  activate: (siteId: SiteId) => void;
  /** Advance to the next page, wrapping. The store owns the order. */
  next: () => void;
  add: (raw: string) => void;
  remove: (siteId: SiteId) => void;
};

export function PaneSiteSwitcher({
  paneId,
  sites,
}: {
  paneId: PaneId;
  sites: PaneSitesControl;
}) {
  const { list, activeId } = sites;
  // One page is not a choice, and no pages is not a pane anyone is switching.
  if (list.length < 2) return null;

  const activeIndex = list.findIndex((site) => site.id === activeId);

  return (
    <div
      className="noc-pane__sites"
      role="group"
      aria-label={`Sites in pane ${paneId}`}
      data-testid={`pane-site-switcher-${paneId}`}
    >
      {list.length <= MAX_INLINE_SITE_PIPS ? (
        list.map((site, index) => (
          <button
            key={site.id}
            className="noc-pane__site-pip"
            type="button"
            aria-current={site.id === activeId}
            aria-label={`Show site ${index + 1} of ${list.length}: ${urlHostLabel(site.url)}`}
            title={urlHostLabel(site.url)}
            data-active={site.id === activeId}
            data-testid={`pane-site-${site.id}`}
            onClick={() => sites.activate(site.id)}
          />
        ))
      ) : (
        <button
          className="noc-pane__site-chip"
          type="button"
          aria-label={`Site ${activeIndex + 1} of ${list.length}; show the next one`}
          title="Next site"
          data-testid={`pane-site-toggle-${paneId}`}
          onClick={sites.next}
        >
          {activeIndex + 1}/{list.length}
        </button>
      )}
    </div>
  );
}
