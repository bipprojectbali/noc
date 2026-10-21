/**
 * What a pane's content element is handed, and what it is named for tests.
 *
 * There used to be two ways to put a site in a pane — an iframe and a native
 * child webview — and this file was the interface they both implemented, plus
 * the fan-out that applied placement and teardown to each of them. The webview
 * existed for two reasons, and the same-site reverse proxy answers both: a site
 * that refuses framing is served from a subdomain of the wall's own host, so it
 * is no longer being framed by a stranger, and that is also what lets a pane
 * keep a session (`src/proxy/`). With one renderer left there is nothing to
 * choose between, nothing out-of-DOM to place by hand, and nothing to destroy
 * that React does not take with the element — so all of that is gone and what
 * stays is the shape of the props and one naming rule.
 */

import type { PaneId, SiteId } from "../layout/layout.types.ts";
import type { PaneLoadState } from "./pane.load-state.ts";

export type PaneContentProps = {
  paneId: PaneId;
  /**
   * The document this element serves. One pane holds several, all mounted at
   * once, so everything that identifies a *document* — the DOM node, its React
   * key — hangs off this rather than the pane id.
   */
  siteId: SiteId;
  /**
   * This site's address as the tree holds it. Separate from `load` because the
   * frame is pointed at the proxy label for the same address, and only the load
   * state machine's own url may be echoed back to it.
   */
  url: string | null;
  load: PaneLoadState;
  /**
   * Whether this is the site on screen. The others stay mounted and hidden:
   * switching has to be instant and must not cost the page its scroll position
   * or its session, which unmounting would.
   */
  active: boolean;
  /** How much to magnify this page, 1 being 100%. */
  zoom: number;
};

/**
 * The element the renderer tags for tests.
 *
 * A pane mounts one element per site, so the pane-scoped name cannot sit on all
 * of them. It stays on the one that is actually on screen — "the frame of pane
 * p1" is what a reader means — and the sites kept warm behind it are named with
 * their own id. Nothing in the running app reads either; `data-pane-slot` and
 * `data-pane-host` are the only DOM hooks that logic uses.
 */
export function paneContentTestId(
  prefix: string,
  paneId: PaneId,
  siteId: SiteId,
  active: boolean,
): string {
  return active ? `${prefix}-${paneId}` : `${prefix}-${paneId}-${siteId}`;
}
