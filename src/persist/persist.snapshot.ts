/**
 * Translation between wall state and a `WallSnapshot`.
 *
 * Pure on purpose, and deliberately ignorant of both Zustand and the storage
 * backend: the store hands it plain values, which is what lets persistence be
 * tested without a browser and swapped without touching the store.
 *
 * It used to also seed per-pane load state for a restore from a stored
 * `current_url`. That is gone: a pane's addresses live in its `sites` list, and
 * a "current" url could never differ from the site's own. Load state only ever
 * carries a url we set ourselves — `frame-loaded` reports back the `src` the
 * renderer was given (`pane.iframe-renderer.tsx`), and a cross-origin frame
 * never tells us where it navigated — so there was nothing extra to restore.
 */

import { serializeLayout } from "../layout/layout.serializer.ts";
import type { LayoutTree } from "../layout/layout.types.ts";
import type { WallSettings, WallSnapshot } from "./persist.types.ts";

export type WallPersistInput = {
  tree: LayoutTree;
  settings: WallSettings;
};

export function toSnapshot(input: WallPersistInput): WallSnapshot {
  return { layout: serializeLayout(input.tree), settings: input.settings };
}
