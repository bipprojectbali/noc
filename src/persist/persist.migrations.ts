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

      // `home_url` was what the user typed; `current_url` was meant to hold
      // where the pane actually ended up. Both are legacy and neither is
      // written any more: version 2 moved addresses into `pane_sites`, and a
      // pane's "current" url turned out never to differ from its site's own,
      // because a cross-origin page never tells us where it navigated. Both
      // columns stay in the schema — dropping one in SQLite means rebuilding
      // the table — and this statement stays verbatim so that the 1 → 2 step
      // below still has the shape it migrates from. See `persist.rows.ts`.
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
  {
    // A pane holds a list of addresses, not one. A table of its own rather than
    // `ALTER TABLE panes ADD COLUMN`: SQLite has no `ADD COLUMN IF NOT EXISTS`,
    // so an added column cannot carry its own replay guard, and a list does not
    // fit in a column anyway.
    version: 2,
    statements: [
      // `position` is the site's place in the pane's list and is creation order.
      // It is never re-sorted — a renderer keeps one frame per site alive, and
      // moving a frame reloads the page in it (`layout.sites.ts` spells this
      // out). Reads order by it so the list comes back exactly as written.
      `CREATE TABLE IF NOT EXISTS pane_sites (
         layout_id TEXT NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
         pane_id TEXT NOT NULL,
         site_id TEXT NOT NULL,
         position INTEGER NOT NULL,
         url TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
         PRIMARY KEY (layout_id, pane_id, site_id)
       )`,
      `CREATE INDEX IF NOT EXISTS pane_sites_pane_idx
         ON pane_sites (layout_id, pane_id, position)`,
      // A pane shows one site at a time, so "two active sites" is a state no
      // read should ever have to pick a winner for. A partial unique index says
      // that to SQLite instead of to a comment.
      `CREATE UNIQUE INDEX IF NOT EXISTS pane_sites_active_idx
         ON pane_sites (layout_id, pane_id) WHERE is_active = 1`,

      // Backfill: every stored pane that had an address becomes one site at
      // position 0, active. The site id matches what `layout.serializer`'s
      // 1 → 2 migration derives for the same pane, so a wall that came in
      // through either path names its site the same and per-site state keyed on
      // that id survives. `OR IGNORE` makes the replay a no-op.
      `INSERT OR IGNORE INTO pane_sites
         (layout_id, pane_id, site_id, position, url, created_at, is_active)
       SELECT layout_id, id, id || '-s1', 0, home_url, created_at, 1
       FROM panes WHERE home_url IS NOT NULL`,
      // The rows now express a version 2 tree, so the stamp has to say so or
      // the next read would run the 1 → 2 tree migration over an already
      // migrated pane and drop the sites it just restored. The literal is
      // deliberate: a migration records history and must not drift with
      // `ROW_TREE_VERSION`.
      `UPDATE layouts SET layout_version = 2 WHERE layout_version = 1`,
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
