/** Versioned serialization for persisted layouts and saved views. */

import { assertWellFormed } from "./layout.invariants.ts";
import type { LayoutTree } from "./layout.types.ts";

/**
 * Bump whenever the tree shape changes. The planned flattening of same-direction
 * siblings will change it, so stored layouts must always carry a version.
 *
 * 1 → 2: a pane's single `url` became a list of sites with one of them active.
 */
export const CURRENT_LAYOUT_VERSION = 2;

export type SerializedLayout = {
  version: number;
  tree: LayoutTree;
};

/**
 * Turns every v1 pane into a v2 pane holding at most one site. The site id is
 * derived from the pane id rather than minted at random, so a layout reloaded
 * twice names the same site both times — per-site state is keyed on that id,
 * and a fresh id each boot would silently orphan it. Pane ids are unique, so
 * the derived ids are too.
 */
function migratePaneUrlToSites(tree: unknown): unknown {
  const candidate = tree as { nodes?: Record<string, Record<string, unknown>> };
  const nodes: Record<string, unknown> = {};
  for (const [id, node] of Object.entries(candidate.nodes ?? {})) {
    if (node.kind !== "pane") {
      nodes[id] = node;
      continue;
    }
    const { url, ...rest } = node;
    const site =
      typeof url === "string"
        ? { id: `${id}-s1`, url, createdAt: rest.createdAt }
        : null;
    nodes[id] = {
      ...rest,
      sites: site === null ? [] : [site],
      activeSiteId: site?.id ?? null,
    };
  }
  return { ...candidate, nodes };
}

/** One entry per upgrade step, keyed by the version it reads. */
const MIGRATIONS: Record<number, (tree: unknown) => unknown> = {
  1: migratePaneUrlToSites,
};

export function serializeLayout(tree: LayoutTree): SerializedLayout {
  return { version: CURRENT_LAYOUT_VERSION, tree };
}

function isSerializedLayout(value: unknown): value is SerializedLayout {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SerializedLayout>;
  return (
    typeof candidate.version === "number" &&
    typeof candidate.tree === "object" &&
    candidate.tree !== null
  );
}

/**
 * Reads a persisted layout, migrating it forward and rejecting anything that
 * would put a malformed tree into the store.
 */
export function parseLayout(value: unknown): LayoutTree {
  if (!isSerializedLayout(value)) {
    throw new Error("Stored layout is not a versioned layout payload");
  }
  if (value.version > CURRENT_LAYOUT_VERSION) {
    throw new Error(
      `Stored layout version ${value.version} is newer than supported version ${CURRENT_LAYOUT_VERSION}`,
    );
  }

  let version = value.version;
  let tree: unknown = value.tree;
  while (version < CURRENT_LAYOUT_VERSION) {
    const migrate = MIGRATIONS[version];
    if (migrate === undefined) {
      throw new Error(`No migration registered from layout version ${version}`);
    }
    tree = migrate(tree);
    version += 1;
  }

  const candidate = tree as LayoutTree;
  assertWellFormed(candidate);
  return candidate;
}
