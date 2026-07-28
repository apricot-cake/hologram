'use strict';

// DB snapshot via SQLite's Online Backup API (#5 St8 / #301): produces a
// single consistent file safe to copy even while the live DB is under WAL
// writes, unlike a raw fs.copyFile of hologram.db (+ -wal/-shm) which can
// capture a torn mid-write state. better-sqlite3's Database#backup() wraps
// sqlite3_backup_init/step/finish directly (confirmed on 13.0.1: it is the
// SQLite C API, not an app-level copy loop), so this is the ONLY sanctioned
// way to mirror the live database — see #97's "生きた.dbの生ファイルコピー
// は禁止" and index.ts's runBackup, the sole caller.
//
// Electron-free (better-sqlite3 + node builtins only), mirroring lib-db.ts.

import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

// Writes a complete, consistent copy of `sqlite`'s database to `destFile`,
// creating its parent directory if needed. Overwrites any prior snapshot —
// callers that want thinning (single latest generation, matching the file
// mirror's own model) just call this repeatedly at their own cadence.
async function snapshotDatabase(sqlite: Database.Database, destFile: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(destFile), { recursive: true });
  await sqlite.backup(destFile);
}

export { snapshotDatabase };
