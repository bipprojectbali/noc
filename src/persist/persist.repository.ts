/**
 * Every read and write the server performs against the wall database.
 *
 * Row mapping lives in `persist.rows`; this file owns the settings table, the
 * saved-view bookkeeping, and the transaction boundaries.
 */

import type { Database } from "bun:sqlite";

import { readLayout, writeLayout } from "./persist.rows.ts";
import {
  DEFAULT_WALL_SETTINGS,
  type SavedViewSummary,
  type WallSettings,
  type WallSnapshot,
} from "./persist.types.ts";

/** Row id of the wall the user is looking at, as opposed to a saved view. */
export const LIVE_LAYOUT_ID = "live";

const VIEW_LAYOUT_PREFIX = "view:";

const PANE_CAP_KEY = "paneCap";
const URL_BAR_DEFAULT_KEY = "urlBarVisibleByDefault";

/** Missing or unusable rows fall back to the defaults instead of refusing to start. */
function readSettings(db: Database): WallSettings {
  const rows = db
    .query<{ key: string; value: string }, []>("SELECT key, value FROM settings")
    .all();
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const cap = Number(stored.get(PANE_CAP_KEY));
  return {
    paneCap: Number.isInteger(cap) && cap > 0 ? cap : DEFAULT_WALL_SETTINGS.paneCap,
    urlBarVisibleByDefault: stored.has(URL_BAR_DEFAULT_KEY)
      ? stored.get(URL_BAR_DEFAULT_KEY) === "true"
      : DEFAULT_WALL_SETTINGS.urlBarVisibleByDefault,
  };
}

function writeSettings(db: Database, settings: WallSettings, now: number): void {
  const upsert = db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value,
                                     updated_at = excluded.updated_at`,
  );
  upsert.run(PANE_CAP_KEY, String(settings.paneCap), now);
  upsert.run(URL_BAR_DEFAULT_KEY, String(settings.urlBarVisibleByDefault), now);
}

export type WallRepository = ReturnType<typeof createWallRepository>;

export function createWallRepository(db: Database, clock: () => number) {
  return {
    loadWall(): WallSnapshot | null {
      const stored = readLayout(db, LIVE_LAYOUT_ID);
      if (stored === null) return null;
      return { ...stored, settings: readSettings(db) };
    },

    /**
     * One transaction for the layout and the settings together, so a wall is
     * never stored half-resized — the state an ill-timed exit during a splitter
     * drag would otherwise leave behind.
     */
    saveWall(snapshot: WallSnapshot): void {
      const now = clock();
      db.transaction(() => {
        writeLayout(db, LIVE_LAYOUT_ID, snapshot, now);
        writeSettings(db, snapshot.settings, now);
      })();
    },

    listViews(): SavedViewSummary[] {
      return db
        .query<SavedViewSummary, []>(
          `SELECT name, created_at AS createdAt, updated_at AS updatedAt
           FROM saved_views ORDER BY name`,
        )
        .all();
    },

    /** Saving under an existing name overwrites it; the name is what the user recalls. */
    saveView(name: string, snapshot: WallSnapshot): void {
      const now = clock();
      const layoutId = `${VIEW_LAYOUT_PREFIX}${name}`;
      db.transaction(() => {
        writeLayout(db, layoutId, snapshot, now);
        db.run(
          `INSERT INTO saved_views (name, layout_id, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (name) DO UPDATE SET layout_id = excluded.layout_id,
                                            updated_at = excluded.updated_at`,
          [name, layoutId, now, now],
        );
      })();
    },

    /** Settings are wall-wide preferences, so a recalled view keeps the live ones. */
    loadView(name: string): WallSnapshot | null {
      const stored = readLayout(db, `${VIEW_LAYOUT_PREFIX}${name}`);
      if (stored === null) return null;
      return { ...stored, settings: readSettings(db) };
    },

    deleteView(name: string): void {
      db.transaction(() => {
        db.run("DELETE FROM saved_views WHERE name = ?", [name]);
        // Cascades to panes, splits and dock through the foreign keys.
        db.run("DELETE FROM layouts WHERE id = ?", [`${VIEW_LAYOUT_PREFIX}${name}`]);
      })();
    },
  };
}
