/**
 * Pure operations on the list of addresses one pane holds. No DOM, no React,
 * no store.
 *
 * A pane carries several sites so one tile can cycle between dashboards
 * without a second tile. The list is in creation order and is **never
 * reordered**, for exactly the reason the flat pane layer never is
 * (invariant 1): a renderer that serves several sites keeps one frame per site
 * alive, and moving a frame to a different place in the DOM reloads the page
 * inside it. Sorting this list would look like tidying and would silently
 * reload the wall. `addSite` appends, `removeSite` closes the gap, and nothing
 * here may do anything else to the order.
 *
 * Site ids are unique across the whole wall rather than per pane, so per-site
 * state — load state, a native webview label — can be keyed on the site id
 * alone. That is also what keeps `pane.load-state` keyed as it is today.
 *
 * Unknown pane or site ids throw. A caller holding a stale id is a bug, not a
 * gesture a user can make; refusals are for things a drag or a click can
 * legitimately ask for.
 */

import { requirePane } from "./layout.node.ts";
import type { MakeId } from "./layout.tree.ts";
import type {
  LayoutTree,
  PaneId,
  PaneNode,
  PaneSite,
  SiteId,
} from "./layout.types.ts";
import { clampZoom, DEFAULT_ZOOM } from "./layout.zoom.ts";

/** The address the pane is showing, or `null` while it holds none. */
export function activePaneUrl(pane: PaneNode): string | null {
  return pane.sites.find((site) => site.id === pane.activeSiteId)?.url ?? null;
}

/**
 * The site a "next site" control should land on: the one after the active
 * site, wrapping at the end. `null` only for a pane holding nothing — a pane
 * with one site answers with that site, so callers need no special case.
 */
export function nextSiteId(pane: PaneNode): SiteId | null {
  if (pane.sites.length === 0) return null;
  // -1 when the active id is missing, which puts the answer at the first site.
  const index = pane.sites.findIndex((site) => site.id === pane.activeSiteId);
  return pane.sites[(index + 1) % pane.sites.length]?.id ?? null;
}

function requireSite(pane: PaneNode, siteId: SiteId): PaneSite {
  const site = pane.sites.find((candidate) => candidate.id === siteId);
  if (site === undefined) {
    throw new Error(`Pane "${pane.id}" has no site "${siteId}"`);
  }
  return site;
}

function writePane(
  tree: LayoutTree,
  pane: PaneNode,
  patch: Partial<PaneNode>,
): LayoutTree {
  return { ...tree, nodes: { ...tree.nodes, [pane.id]: { ...pane, ...patch } } };
}

/**
 * Appends an address and puts it on screen — adding a site is how someone asks
 * to see it. Callers that need the new id read `activeSiteId` back off the pane.
 *
 * Duplicate urls are allowed on purpose: the same dashboard twice, at different
 * scroll positions or logged in as different users, is a real thing to want,
 * and refusing the second would read as a broken button.
 */
export function addSite(
  tree: LayoutTree,
  paneId: PaneId,
  url: string,
  makeId: MakeId,
  now: number,
): LayoutTree {
  const pane = requirePane(tree, paneId);
  const site: PaneSite = { id: makeId(), url, createdAt: now, zoom: DEFAULT_ZOOM };
  return writePane(tree, pane, {
    sites: [...pane.sites, site],
    activeSiteId: site.id,
  });
}

/**
 * Closes one address. When it was the active one the pane falls to whichever
 * site took its place in the list, or to the new last one if it was at the end
 * — the neighbour, the way closing a browser tab behaves.
 *
 * Removing the only site leaves the pane empty rather than deleting the pane:
 * an empty pane is a valid pane, and the tree must always hold at least one.
 */
export function removeSite(
  tree: LayoutTree,
  paneId: PaneId,
  siteId: SiteId,
): LayoutTree {
  const pane = requirePane(tree, paneId);
  requireSite(pane, siteId);

  const index = pane.sites.findIndex((site) => site.id === siteId);
  const sites = pane.sites.filter((site) => site.id !== siteId);
  if (pane.activeSiteId !== siteId) return writePane(tree, pane, { sites });

  const fallback = sites[index] ?? sites[sites.length - 1];
  return writePane(tree, pane, {
    sites,
    activeSiteId: fallback === undefined ? null : fallback.id,
  });
}

/** Switches which of the pane's sites is on screen. */
export function setActiveSite(
  tree: LayoutTree,
  paneId: PaneId,
  siteId: SiteId,
): LayoutTree {
  const pane = requirePane(tree, paneId);
  requireSite(pane, siteId);
  return writePane(tree, pane, { activeSiteId: siteId });
}

/**
 * Magnifies one page, keeping its id and its place.
 *
 * Clamped here rather than trusted from the caller: this is the one door into
 * the field, and what comes through it is also what gets written to disk. The
 * site's own `zoom` survives a new address — repointing a pane is a change of
 * page, not a change of how big the operator needs it.
 */
export function setSiteZoom(
  tree: LayoutTree,
  paneId: PaneId,
  siteId: SiteId,
  zoom: number,
): LayoutTree {
  const pane = requirePane(tree, paneId);
  requireSite(pane, siteId);
  const level = clampZoom(zoom);
  return writePane(tree, pane, {
    sites: pane.sites.map((site) =>
      site.id === siteId ? { ...site, zoom: level } : site,
    ),
  });
}

/** Points one site at a different address, keeping its id and its place. */
export function setSiteUrl(
  tree: LayoutTree,
  paneId: PaneId,
  siteId: SiteId,
  url: string,
): LayoutTree {
  const pane = requirePane(tree, paneId);
  requireSite(pane, siteId);
  return writePane(tree, pane, {
    sites: pane.sites.map((site) =>
      site.id === siteId ? { ...site, url } : site,
    ),
  });
}
