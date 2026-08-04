'use strict';

// SQLite engine for the derived-data store (#833, parent #98): analysis output
// (OCR text, AI tags, color/embedding vectors — #48/#49/#50/#51) lives here, in
// its OWN file, never mixed into hologram.db's `posts` tables. Reconstructable
// data and the truth source get different failure/recovery rules (ADR 0010's
// "two truth sources" concern, applied here to something that is deliberately
// NOT a truth source), so this Issue keeps them in separate files rather than
// invent a "this table doesn't count as truth" convention inside one database.
//
// Machine-local, like the ML model cache (#831's modelsRoot()) — configDir(),
// never inside the save folder. That single choice is what satisfies three of
// #833's acceptance criteria at once: the backup mirror (#233) and an export
// ZIP (#57) both walk the save folder only, so derived.db never reaches
// either, and lib-backup.ts separately refuses any destination overlapping
// configDir() outright.
//
// Disposable by construction: every row here is a projection of something the
// app can still see (a model's output on a capture that still exists), so a
// missing or corrupt derived.db is never a data-loss event the way a corrupt
// hologram.db is. openDerivedDatabase reflects that — a failed quick_check
// discards the file and starts over instead of throwing DatabaseCorruptError.
//
// Electron-free (better-sqlite3 + node builtins only), mirroring lib-db.ts, so
// this unit-tests in plain node.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { Kysely, SqliteDialect } from 'kysely';

/** derived.db's path inside a config directory (native-host.ts's configDir()). */
export function derivedDbFile(dir: string): string {
  return path.join(dir, 'derived.db');
}

// One entry per schema change, same append-only convention as lib-db.ts's
// MIGRATIONS array. Feature tables (#48/#49/#50/#51) append their own
// migration here when each lands, following the shared key convention #833's
// design settled on: captureId + assetRef ('image' | 'video' | 'file' |
// 'media[seq]') + segment (a PDF's page number, 0 for anything single-part),
// with modelId/modelRev columns stamped on every row a model produced (both
// null for a job that uses no model, e.g. PDF text-layer extraction — #98's
// 2026-08-02 comment §1-2).
//
// This Issue ships only the one table every job kind shares regardless of
// what it produces: how far it has gotten through an asset's segments.
const MIGRATIONS: Migration[] = [
  {
    name: 'schema-v1',
    up: (db) =>
      db.exec(`
        -- One row per (captureId, assetRef, jobKind): a job's progress through
        -- an asset's segments, shared across every job kind (visual jobs and
        -- the text extractor alike) rather than duplicated per feature table,
        -- because "how much of this is indexed" is the same question
        -- regardless of what the job produces. indexedSegments < totalSegments
        -- is a partial index left for a resumable backfill to pick up (#98
        -- 2026-08-02 comment §3) — not an error state.
        CREATE TABLE derived_progress (
          captureId TEXT NOT NULL,
          assetRef TEXT NOT NULL,
          jobKind TEXT NOT NULL,
          modelId TEXT,
          modelRev TEXT,
          indexedSegments INTEGER NOT NULL DEFAULT 0,
          totalSegments INTEGER NOT NULL DEFAULT 0,
          updatedAt TEXT NOT NULL,
          PRIMARY KEY (captureId, assetRef, jobKind)
        );
        CREATE INDEX idx_derived_progress_captureId ON derived_progress(captureId);
      `),
  },
];

interface Migration {
  name: string;
  up: (db: MigrationDb) => void;
}

// Same narrow slice lib-db.ts's MigrationDb uses — raw DDL only, no query
// builder, so a migration cannot depend on the CURRENT typed schema (only the
// historical shape it's writing).
interface MigrationDb {
  exec: (sql: string) => unknown;
  pragma: (source: string, options?: { simple?: boolean }) => unknown;
}

function runMigrations(db: MigrationDb, migrations = MIGRATIONS) {
  const applied = Number(db.pragma('user_version', { simple: true })) || 0;
  if (applied > migrations.length) {
    throw new Error(`derived.db schema is newer than this build (user_version=${applied}, known=${migrations.length})`);
  }
  for (let i = applied; i < migrations.length; i++) {
    db.exec('BEGIN');
    try {
      migrations[i].up(db);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`derived-db migration ${i + 1} (${migrations[i].name}) failed: ${(err as Error).message}`);
    }
  }
  return { from: applied, to: migrations.length };
}

// Opens `file`, discarding it (and any -wal/-shm sidecar) and starting fresh
// the moment quick_check disagrees, rather than surfacing the failure to the
// caller — see the module comment: nothing here is a truth source, so a
// corrupt derived.db is worth exactly as much as a missing one.
function openWithRecovery(file: string): Database.Database {
  const sqlite = new Database(file);
  let check: unknown;
  try {
    check = sqlite.pragma('quick_check', { simple: true });
  } catch {
    check = null;
  }
  if (check === 'ok') return sqlite;
  sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(file + suffix, { force: true });
    } catch {
      /* best-effort */
    }
  }
  return new Database(file);
}

export interface DerivedDbHandle {
  db: Kysely<DerivedSchema>;
  sqlite: Database.Database;
}

/** Opens (creating if absent) derived.db at `file`, applying pending migrations. */
export function openDerivedDatabase(file: string): DerivedDbHandle {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = openWithRecovery(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  runMigrations(sqlite);
  const db = new Kysely<DerivedSchema>({ dialect: new SqliteDialect({ database: sqlite }) });
  return { db, sqlite };
}

// Deletes every row across every derived table that references captureId —
// the derived-side half of hologram.db's ON DELETE CASCADE (#833's design:
// "ゴミ箱にある間は残し、完全削除で消える"). Cross-database foreign keys don't
// exist in SQLite, so this substitutes for one; call it once a capture is
// GONE FOR GOOD (permanent delete from trash, empty-trash) — never on the
// soft-delete-into-trash move, which must leave derived rows alone.
//
// Table discovery is dynamic (sqlite_master + PRAGMA table_info) rather than a
// hardcoded list, so a feature table added later needs no change here — it
// only has to name its key column `captureId`, the one convention every
// derived table shares.
export function purgeDerivedForCapture(sqlite: Database.Database, captureId: string): void {
  const tables = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>;
  for (const { name } of tables) {
    const hasCaptureId = (sqlite.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>).some((c) => c.name === 'captureId');
    if (hasCaptureId) sqlite.prepare(`DELETE FROM "${name}" WHERE captureId = ?`).run(captureId);
  }
}

/**
 * How far one job kind has gotten through one asset, or undefined if it has
 * never run. #834's queue asks this per (record, asset, kind) while planning —
 * it is the ONLY thing that makes the backfill resumable, which is why no
 * separate cursor exists to disagree with it.
 */
export function readDerivedProgress(sqlite: Database.Database, captureId: string, assetRef: string, jobKind: string): { indexedSegments: number; totalSegments: number } | undefined {
  const row = sqlite.prepare('SELECT indexedSegments, totalSegments FROM derived_progress WHERE captureId = ? AND assetRef = ? AND jobKind = ?').get(captureId, assetRef, jobKind) as { indexedSegments: number; totalSegments: number } | undefined;
  return row;
}

/** Upserts the shared progress row a finished job reports (#834 writes it, not the job kind). */
export function writeDerivedProgress(sqlite: Database.Database, row: { captureId: string; assetRef: string; jobKind: string; modelId: string | null; modelRev: string | null; indexedSegments: number; totalSegments: number; updatedAt?: string }): void {
  sqlite
    .prepare(
      `INSERT INTO derived_progress (captureId, assetRef, jobKind, modelId, modelRev, indexedSegments, totalSegments, updatedAt)
       VALUES (@captureId, @assetRef, @jobKind, @modelId, @modelRev, @indexedSegments, @totalSegments, @updatedAt)
       ON CONFLICT(captureId, assetRef, jobKind) DO UPDATE SET
         modelId = excluded.modelId,
         modelRev = excluded.modelRev,
         indexedSegments = excluded.indexedSegments,
         totalSegments = excluded.totalSegments,
         updatedAt = excluded.updatedAt`,
    )
    .run({ ...row, updatedAt: row.updatedAt ?? new Date().toISOString() });
}

interface DerivedProgressTable {
  captureId: string;
  assetRef: string;
  jobKind: string;
  modelId: string | null;
  modelRev: string | null;
  indexedSegments: number;
  totalSegments: number;
  updatedAt: string;
}

interface DerivedSchema {
  derived_progress: DerivedProgressTable;
}

let handle: DerivedDbHandle | null = null;

/**
 * The process-wide derived.db handle, opened lazily on first use (mirroring
 * lib-ml-runtime.ts's own module-level singleton — this store is machine-local
 * and does not change with #176's library switch, so it does not belong to
 * index.ts's per-library dbHandle lifecycle).
 */
export function ensureDerivedDb(dir: string): DerivedDbHandle {
  if (!handle) handle = openDerivedDatabase(derivedDbFile(dir));
  return handle;
}

/** Test-only: forces the next ensureDerivedDb() call to reopen. */
export function resetDerivedDbForTest(): void {
  try {
    handle?.sqlite.close();
  } catch {
    /* already closed */
  }
  handle = null;
}

export { runMigrations, MIGRATIONS };
export type { Migration, MigrationDb, DerivedSchema };
