/** Versioned serialization for persisted layouts and saved views. */

import { assertWellFormed } from "./layout.invariants.ts";
import type { LayoutTree } from "./layout.types.ts";

/**
 * Bump whenever the tree shape changes. The planned flattening of same-direction
 * siblings will change it, so stored layouts must always carry a version.
 */
export const CURRENT_LAYOUT_VERSION = 1;

export type SerializedLayout = {
  version: number;
  tree: LayoutTree;
};

/** One entry per upgrade step, keyed by the version it reads. */
const MIGRATIONS: Record<number, (tree: unknown) => unknown> = {};

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
