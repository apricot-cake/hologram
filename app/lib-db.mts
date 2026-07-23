'use strict';

// SQLite engine layer for the metadata store (#5 / #294 St1): opens the database,
// applies pending migrations, and hands back a typed Kysely instance. The schema
// itself lands in St2 — MIGRATIONS is empty here on purpose.
//
// Kept Electron-free (better-sqlite3 and node builtins only) so the migration
// runner unit-tests in plain node, mirroring lib-index/lib-archive.
//
// Single writer: only the Electron MAIN process opens this database for writing.
// Other processes (the Chrome-spawned native host) never touch the .db — they
// append to the intake queue and the app ingests it (#299). WAL still lets
// readers in (a read-only snapshot open for the perf harness, #293).
//
// The prebuilt native binary is N-API, so the SAME better-sqlite3 .node loads
// under both plain node and Electron without a rebuild step (verified 2026-07-24
// on node 24 / Electron 43 — NODE_MODULE_VERSION 137 vs 148). Do not add
// electron-rebuild wiring for it; see docs/build.md.

import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';

// One entry per schema change, applied in array order and never reordered or
// edited once shipped — `user_version` records how many have run, so rewriting
// an applied entry leaves existing databases silently inconsistent. Append only.
const MIGRATIONS: Migration[] = [];

interface Migration {
  name: string;
  up: (db: MigrationDb) => void;
}

// The slice of better-sqlite3 a migration needs. Narrow on purpose: tests pass a
// plain fake, and migrations get no access to the query builder (raw DDL only —
// Kysely's typed schema describes the CURRENT shape, not historical ones).
interface MigrationDb {
  exec: (sql: string) => unknown;
  pragma: (source: string, options?: { simple?: boolean }) => unknown;
}

class DatabaseCorruptError extends Error {}

// Runs every migration past `user_version`, each in its own transaction, and
// bumps `user_version` in that same transaction so an interrupted run replays
// cleanly. `user_version` is a 4-byte int in the SQLite header itself — no
// bookkeeping table to create before the first migration can run.
//
// Exported for the unit test: takes any MigrationDb, so the ordering and
// resume-from-partial guarantees are checkable without a real database.
function runMigrations(db: MigrationDb, migrations = MIGRATIONS) {
  const applied = Number(db.pragma('user_version', { simple: true })) || 0;
  if (applied > migrations.length) {
    throw new Error(`database schema is newer than this build (user_version=${applied}, known=${migrations.length})`);
  }
  for (let i = applied; i < migrations.length; i++) {
    db.exec('BEGIN');
    try {
      migrations[i].up(db);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${i + 1} (${migrations[i].name}) failed: ${err.message}`);
    }
  }
  return { from: applied, to: migrations.length };
}

// Opens (creating if absent) the database at `file` and returns { db, sqlite }:
// `db` is the Kysely query builder, `sqlite` the raw handle for the operations
// Kysely does not cover (backup snapshots #301, pragma checks).
//
// quick_check runs before any migration: it is the cheap structural scan
// (page/index integrity, no cross-table verification) that integrity_check does
// in full. Opening a corrupt file and writing to it makes recovery harder, so a
// failure throws DatabaseCorruptError here rather than surfacing as a confusing
// query error later. The full integrity_check belongs to the periodic sweep (#301).
function openDatabase(file: string, opts: { readonly?: boolean } = {}) {
  const sqlite = new Database(file, { readonly: !!opts.readonly });

  // A file that is not SQLite at all throws SQLITE_NOTADB here rather than
  // returning a verdict, so both shapes have to funnel into the same error —
  // and the handle has to be closed either way or the file stays locked.
  let check: unknown;
  try {
    check = sqlite.pragma('quick_check', { simple: true });
  } catch (err) {
    sqlite.close();
    throw new DatabaseCorruptError(`cannot read ${file} as a database: ${err.message}`);
  }
  if (check !== 'ok') {
    sqlite.close();
    throw new DatabaseCorruptError(`quick_check failed for ${file}: ${check}`);
  }

  // WAL survives across connections (it is stored in the file header), but set it
  // every open so a database restored from a non-WAL backup gets it back.
  if (!opts.readonly) sqlite.pragma('journal_mode = WAL');
  // Wait rather than throw when another connection holds the write lock — the
  // read-only perf harness and the backup snapshot both overlap normal use.
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');

  if (!opts.readonly) runMigrations(sqlite);

  const db = new Kysely<Schema>({ dialect: new SqliteDialect({ database: sqlite }) });
  return { db, sqlite };
}

// St2 fills this in. Empty until then: an interface with no tables makes every
// query a type error, which is the correct state while no schema exists.
type Schema = Record<never, never>;

export { openDatabase, runMigrations, DatabaseCorruptError, MIGRATIONS };
export type { Migration, MigrationDb, Schema };
