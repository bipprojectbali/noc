/**
 * Which origins this server is willing to proxy, and under which label.
 *
 * It exists to keep the proxy from becoming an open relay. The server already
 * fetches client-supplied URLs for `/api/embeddability`, and that is the only
 * reason it binds to loopback; a proxy that resolved any hostname it was handed
 * would widen that surface from "one HEAD-like probe" to "arbitrary tunnel".
 * So the mapping is deliberately one-way: an origin can only enter here by
 * being probed, which is what happens when the operator puts an address in a
 * pane, and a `Host` the registry does not recognise gets a 404 instead of a
 * fetch. Guessing a label is not enough — the fingerprint in it is derived from
 * the origin, so a caller who can compute a valid label already knew the
 * origin, and still only reaches an origin somebody installed.
 *
 * In memory on purpose. The registry is rebuilt by the probes a page issues on
 * load, so a restarted server simply learns the wall again; persisting it would
 * mean a stored list of internal hostnames outliving the layout that justified
 * it.
 */

import { siteLabel, siteOriginOf } from "./proxy.label.ts";

/**
 * Generous enough that no real wall reaches it, low enough that a script
 * hammering the probe endpoint cannot grow this without bound. Eviction is
 * oldest-first and will break a live pane if it ever triggers, which is the
 * correct trade at that point: nothing legitimate gets there.
 */
const MAX_REGISTERED_SITES = 512;

export interface ProxySiteRegistry {
  /** Records a pane address and returns its label, or null if it cannot be proxied. */
  register(url: string): string | null;
  /** The origin a label stands for, or null when it was never registered. */
  resolve(label: string): string | null;
}

export function createProxySiteRegistry(): ProxySiteRegistry {
  const origins = new Map<string, string>();

  return {
    register(url) {
      const origin = siteOriginOf(url);
      if (origin === null) return null;
      const label = siteLabel(origin);
      if (origins.has(label)) return label;
      if (origins.size >= MAX_REGISTERED_SITES) {
        const oldest = origins.keys().next();
        if (!oldest.done) origins.delete(oldest.value);
      }
      origins.set(label, origin);
      return label;
    },

    resolve(label) {
      return origins.get(label) ?? null;
    },
  };
}

/** The server's one registry; tests build their own. */
export const proxySiteRegistry = createProxySiteRegistry();
