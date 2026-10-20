/**
 * Connects the wall store to a persistence port: restore once at start, then
 * save every layout change.
 *
 * Nothing here knows about HTTP or SQLite; it only sees `WallPersistPort`. The
 * store is passed in so a test can run its own copy.
 */

import type { StoreApi } from "zustand";

import type { WallState } from "../pane/pane.store.ts";
import { mayWrite } from "./persist.status.ts";
import { toSnapshot } from "./persist.snapshot.ts";
import {
  DEFAULT_WALL_SETTINGS,
  type WallPersistPort,
} from "./persist.types.ts";

export type WallPersistence = {
  /** Settles once the stored layout is loaded, or has failed to load. */
  ready: Promise<void>;
  /** Stops saving. Used on teardown and by tests. */
  stop: () => void;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A failed load leaves the wall on its fresh layout, and saving stays off. That
 * is the point: the empty wall must never be written over a layout that exists.
 */
export function startWallPersistence(
  port: WallPersistPort,
  store: StoreApi<WallState>,
): WallPersistence {
  let unsubscribe: (() => void) | null = null;
  let stopped = false;

  const saveChanges = (): void => {
    // The tree is the whole of what gets stored, so load-state churn — a probe
    // settling, a frame reporting itself ready — is not a reason to write.
    unsubscribe = store.subscribe((state, previous) => {
      if (state.tree === previous.tree) return;
      if (!mayWrite(state.persistence)) return;
      port.saveWall(
        toSnapshot({ tree: state.tree, settings: DEFAULT_WALL_SETTINGS }),
      );
    });
  };

  const ready = port.loadWall().then(
    (snapshot) => {
      if (snapshot !== null) {
        store.getState().restoreLayout(snapshot.layout.tree);
      }
      store.getState().setPersistence({ kind: "ready" });
      // A stop that arrived while the load was in flight must not subscribe.
      if (!stopped) saveChanges();
    },
    (error: unknown) => {
      store.getState().setPersistence({
        kind: "unavailable",
        message:
          `The saved layout could not be loaded (${messageOf(error)}). ` +
          "Nothing will be saved until the page is reloaded and the layout loads.",
      });
    },
  );

  return {
    ready,
    stop: () => {
      stopped = true;
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
