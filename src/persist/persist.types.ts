/**
 * The storage seam.
 *
 * Everything above this file — the wall store, the pane components — talks to
 * `WallPersistPort` and never to SQLite. The browser implementation speaks
 * HTTP, the server implementation speaks `bun:sqlite`, and a test can supply a
 * third without either side noticing.
 */

import type { SerializedLayout } from "../layout/layout.serializer.ts";

/** Wall-wide rules, stored one row per key so a new rule needs no migration. */
export type WallSettings = {
  /** Upper bound on panes kept alive at once; each one is a live browser frame. */
  paneCap: number;
  /** Whether a pane created by a split starts with its URL bar showing. */
  urlBarVisibleByDefault: boolean;
};

export const DEFAULT_WALL_SETTINGS: WallSettings = {
  paneCap: 12,
  urlBarVisibleByDefault: true,
};

/**
 * One restorable wall.
 *
 * `layout` carries its own version stamp from `layout.serializer`, so the tree
 * shape migrates independently of the database schema. It also carries every
 * address: a pane's `sites` list is the only record of what it shows. There was
 * once a `currentUrls` map beside it, meant to hold where a pane had navigated
 * to on its own — it never could, so it is gone; see `persist.snapshot.ts`.
 */
export type WallSnapshot = {
  layout: SerializedLayout;
  settings: WallSettings;
};

export type SavedViewSummary = {
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type WallPersistPort = {
  /** `null` means nothing has been stored yet, which is a clean first start. */
  loadWall: () => Promise<WallSnapshot | null>;
  /** Coalesced: callers may fire this on every drag frame. */
  saveWall: (snapshot: WallSnapshot) => void;
  /** Resolves once every coalesced write has reached storage. */
  flush: () => Promise<void>;
  listViews: () => Promise<SavedViewSummary[]>;
  saveView: (name: string, snapshot: WallSnapshot) => Promise<void>;
  loadView: (name: string) => Promise<WallSnapshot | null>;
  deleteView: (name: string) => Promise<void>;
};

/** Longest a saved view name may be, so one row cannot carry a whole document. */
export const MAX_VIEW_NAME_LENGTH = 80;
