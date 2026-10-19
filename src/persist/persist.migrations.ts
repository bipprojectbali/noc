/**
 * Numbered schema steps, applied in order and recorded in `schema_version`.
 *
 * Every statement carries its own `IF NOT EXISTS` guard, so a step is safe to
 * replay even if the version row is lost or a previous run died halfway. The
 * version row is what stops the *data* parts of a future step from running
 * twice; the guards are what stop the structural parts from erroring.
 */

export const MIGRATIONS: readonly { version: number; statements: readonly string[] }[] = [
  {
    // The wall is described one row per thing the user can see and change, not
    // as a single JSON blob: sizes are rewritten on every splitter drag, and a
    // blob would have to be reparsed and rewritten whole for each of them.
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS settings (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL,
         updated_at INTEGER NOT NULL
       )`,

      // One row marks one restorable wall and names its root node. The live
      // wall and every saved view are rows here, which is why restoring a view
      // is a read of this table rather than a separate code path.
      `CREATE TABLE IF NOT EXISTS layouts (
         id TEXT PRIMARY KEY,
         root_id TEXT NOT NULL,
         layout_version INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`,

      // `home_url` is what the user typed and is the pane's identity to them;
      // `current_url` is where it actually ended up and may be null because a
      // pane can exist before it has ever loaded anything.
      `CREATE TABLE IF NOT EXISTS panes (
         id TEXT NOT NULL,
         layout_id TEXT NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
         parent_id TEXT,
         home_url TEXT,
         current_url TEXT,
         url_bar_visible INTEGER NOT NULL CHECK (url_bar_visible IN (0, 1)),
         strategy TEXT NOT NULL CHECK (strategy IN ('auto', 'iframe', 'webview')),
         created_at INTEGER NOT NULL,
         PRIMARY KEY (layout_id, id)
       )`,
      `CREATE INDEX IF NOT EXISTS panes_layout_created_idx
         ON panes (layout_id, created_at)`,

      // `size_a`/`size_b` are the fractions of the parent along `direction`:
      // this is where a pane's width survives a restart. They are stored as the
      // pair the tree uses rather than one fraction, so a stored row needs no
      // arithmetic to become a `SplitNode`.
      `CREATE TABLE IF NOT EXISTS splits (
         id TEXT NOT NULL,
         layout_id TEXT NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
         parent_id TEXT,
         direction TEXT NOT NULL CHECK (direction IN ('row', 'column')),
         child_a TEXT NOT NULL,
         child_b TEXT NOT NULL,
         size_a REAL NOT NULL,
         size_b REAL NOT NULL,
         PRIMARY KEY (layout_id, id)
       )`,
      `CREATE INDEX IF NOT EXISTS splits_layout_idx ON splits (layout_id)`,

      // Dock order is explicit rather than implied by `docked_at`, because two
      // panes docked in the same millisecond must still come back in one order.
      `CREATE TABLE IF NOT EXISTS dock (
         layout_id TEXT NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
         pane_id TEXT NOT NULL,
         position INTEGER NOT NULL,
         docked_at INTEGER NOT NULL,
         PRIMARY KEY (layout_id, pane_id)
       )`,
      `CREATE INDEX IF NOT EXISTS dock_layout_position_idx
         ON dock (layout_id, position)`,

      // Named arrangements. The name is the key because the user recalls a view
      // by what they called it, and saving the same name twice must overwrite
      // rather than accumulate.
      `CREATE TABLE IF NOT EXISTS saved_views (
         name TEXT PRIMARY KEY,
         layout_id TEXT NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS saved_views_layout_idx
         ON saved_views (layout_id)`,
    ],
  },
];

/** Highest schema version this build knows how to produce. */
export const CURRENT_SCHEMA_VERSION = MIGRATIONS.reduce(
  (highest, step) => Math.max(highest, step.version),
  0,
);

/** Holds the applied schema version. Pinned to one row so it cannot disagree with itself. */
export const SCHEMA_VERSION_DDL = `CREATE TABLE IF NOT EXISTS schema_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  applied_at INTEGER NOT NULL
)`;
