/**
 * Opens the wall database and brings its schema up to date.
 *
 * Uses `bun:sqlite`, which ships with the runtime — the wall needs no driver,
 * ORM or query builder on top of it.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import {
  CURRENT_SCHEMA_VERSION,
  MIGRATIONS,
  SCHEMA_VERSION_DDL,
} from "./persist.migrations.ts";

export type OpenResult =
  | { ok: true; db: Database; version: number }
  | { ok: false; reason: string };

function readVersion(db: Database): number {
  const row = db
    .query<{ version: number }, []>("SELECT version FROM schema_version WHERE id = 1")
    .get();
  return row?.version ?? 0;
}

/**
 * Applies every step the file has not seen yet, inside one transaction per
 * step, and returns the version it ended on. Replaying this is a no-op: the
 * version row gates the steps and every statement is guarded anyway.
 */
export function migrate(db: Database, now: number): number {
  db.run(SCHEMA_VERSION_DDL);

  let version = readVersion(db);
  for (const step of MIGRATIONS) {
    if (step.version <= version) continue;
    db.transaction(() => {
      for (const statement of step.statements) db.run(statement);
      db.run(
        `INSERT INTO schema_version (id, version, applied_at) VALUES (1, ?, ?)
         ON CONFLICT (id) DO UPDATE SET version = excluded.version,
                                        applied_at = excluded.applied_at`,
        [step.version, now],
      );
    })();
    version = step.version;
  }
  return version;
}

/**
 * Opens the database at `path`, creating the data directory if needed.
 *
 * Returns a reason instead of throwing, because an unreadable database must not
 * take the wall down: the server keeps serving and reports the problem on the
 * persistence endpoints. Nothing here ever deletes, truncates or renames a file
 * it failed to read — a damaged database is kept exactly as found so the
 * operator still has something to recover.
 */
export function openWallDatabase(path: string, now: number): OpenResult {
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch (error) {
    return {
      ok: false,
      reason:
        `Cannot create the data directory for ${path} ` +
        `(${messageOf(error)}). Set NOC_DATA_DIR to a writable directory.`,
    };
  }

  let db: Database;
  try {
    db = new Database(path, { create: true });
  } catch (error) {
    return { ok: false, reason: cannotUse(path, messageOf(error)) };
  }

  try {
    // WAL lets the coalesced writer commit while the frontend is reading, and
    // survives an abrupt exit without taking the file with it.
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");
    // Cheap read that fails loudly on a file that is not a database, so the
    // problem is reported here rather than surfacing mid-request later.
    db.query("PRAGMA quick_check(1)").get();
    const version = migrate(db, now);
    if (version > CURRENT_SCHEMA_VERSION) {
      db.close();
      return {
        ok: false,
        reason:
          `${path} was written by a newer version of NOC ` +
          `(schema ${version}, this build understands ${CURRENT_SCHEMA_VERSION}). ` +
          `Upgrade NOC rather than letting it rewrite the file.`,
      };
    }
    return { ok: true, db, version };
  } catch (error) {
    db.close();
    return { ok: false, reason: cannotUse(path, messageOf(error)) };
  }
}

function cannotUse(path: string, detail: string): string {
  return (
    `Cannot use the wall database at ${path} (${detail}). ` +
    `The file was left untouched. Move it aside to start with an empty wall.`
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
