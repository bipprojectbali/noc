/**
 * Numbered schema steps, applied in order and recorded in `schema_version`.
 *
 * Every statement carries its own `IF NOT EXISTS` guard, so a step is safe to
 * replay even if the version row is lost or a previous run died halfway. The
 * version row is what stops the *data* parts of a future step from running
 * twice; the guards are what stop the structural parts from erroring.
 *
 * One statement cannot do that, and `addsColumn` is the answer to it: SQLite
 * has no `ADD COLUMN IF NOT EXISTS`, so a step that adds a column says which
 * one, and `persist.database` skips the whole step when the column is already
 * there. Whole, not statement by statement, because a step is one transaction:
 * its data statements committed together with its DDL or not at all, so the
 * column's presence is proof the rest landed too.
 *
 * `dropsColumn` is the same guard read the other way, for a step that takes a
 * column away. SQLite will not `DROP COLUMN` one carrying a `CHECK`, so such a
 * step rebuilds the table from a column list frozen at the day it was written.
 * Replayed, that list is the damage: anything a later step added to the table
 * is not in it and does not survive the copy. The column's *absence* is the
 * proof the step already ran, so it is skipped when the column is gone.
 */

export type MigrationStep = {
  version: number;
  statements: readonly string[];
  /** The one column this step adds, when it adds one. See above. */
  addsColumn?: { table: string; column: string };
  /** The one column this step removes, when it removes one. See above. */
  dropsColumn?: { table: string; column: string };
};

export const MIGRATIONS: readonly MigrationStep[] = [
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
  {
    // How much a page is magnified. A column on `pane_sites` rather than a
    // table of its own: it is one number per site, always present, and the
    // reason version 2 avoided `ALTER TABLE` was that a *list* does not fit in
    // a column. What stays true is the replay problem, and `addsColumn` above
    // is how this step answers it.
    version: 3,
    addsColumn: { table: "pane_sites", column: "zoom" },
    statements: [
      // `DEFAULT 1` is what makes this safe on a table that already has rows:
      // every site stored before zoom existed comes back at 100%, which is
      // exactly how it was last seen. The default is also what a future
      // `INSERT` without the column would get, and `persist.rows` always
      // writes it, so nothing depends on that.
      `ALTER TABLE pane_sites ADD COLUMN zoom REAL NOT NULL DEFAULT 1`,
      // The rows now express a version 3 tree. Same reason as the stamp in
      // step 2: without it the next read runs the 2 → 3 tree migration over
      // rows that already carry a zoom. That migration keeps a usable zoom
      // rather than overwriting it, so this is belt and braces — but the
      // stamp is the contract, and the migration being forgiving is not.
      `UPDATE layouts SET layout_version = 3 WHERE layout_version = 2`,
    ],
  },
  {
    // A pane no longer chooses a renderer. The native webview existed to show
    // sites that refuse framing and to let a pane hold a session; the same-site
    // proxy answers both, so there is one renderer and nothing left to store.
    //
    // A rebuild rather than `ALTER TABLE panes DROP COLUMN strategy`: SQLite
    // refuses to drop a column named in a `CHECK`, and this one is. The other
    // two legacy columns ride across unchanged — `home_url` still feeds step
    // 2's backfill on a database that has never been opened since.
    version: 4,
    dropsColumn: { table: "panes", column: "strategy" },
    statements: [
      `CREATE TABLE IF NOT EXISTS panes_without_strategy (
         id TEXT NOT NULL,
         layout_id TEXT NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
         parent_id TEXT,
         home_url TEXT,
         current_url TEXT,
         url_bar_visible INTEGER NOT NULL CHECK (url_bar_visible IN (0, 1)),
         created_at INTEGER NOT NULL,
         PRIMARY KEY (layout_id, id)
       )`,
      // Column names on both sides, so the copy cannot silently shift if the
      // old table's order ever differed from what step 1 wrote.
      `INSERT OR IGNORE INTO panes_without_strategy
         (id, layout_id, parent_id, home_url, current_url,
          url_bar_visible, created_at)
       SELECT id, layout_id, parent_id, home_url, current_url,
              url_bar_visible, created_at
       FROM panes`,
      // The old table's index goes with it; the rename does not bring one.
      `DROP TABLE panes`,
      `ALTER TABLE panes_without_strategy RENAME TO panes`,
      `CREATE INDEX IF NOT EXISTS panes_layout_created_idx
         ON panes (layout_id, created_at)`,
      // The rows now express a version 4 tree. Same reason as the stamps in
      // steps 2 and 3: the 3 → 4 tree migration only drops a property these
      // rows can no longer produce, so running it again would be harmless —
      // but the stamp is the contract and the migration's forgiveness is not.
      `UPDATE layouts SET layout_version = 4 WHERE layout_version = 3`,
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
