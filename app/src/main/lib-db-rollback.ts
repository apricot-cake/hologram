'use strict';

// Rolling the library's organization back to an earlier DB generation (#233).
//
// #233 draws the line sharply: a generation is a snapshot of the DATABASE, and
// media is write-once, so a rollback is "put the organization back to how it was
// on that date" — never "un-save the posts I have kept since". Two mechanisms
// hold that line, and both run here:
//
//   the stash    the live database is snapshotted into the generation store
//                first, so the state being left behind is itself a restore
//                point (an undo for the undo). It is also the MATERIAL for the
//                step below — reading records back out of a real database
//                beats re-deriving them from files, which would lose every
//                field the library holds and no file carries.
//   the sweep    posts that exist in the stash but not in the generation are
//                re-registered into the restored database, so the library still
//                holds everything it held a moment ago. Their memberships come
//                along only where the container survived the rollback (#233:
//                "所属だけ外れ、投稿自体は残る") — restoreMemberships already
//                drops a membership whose folder is gone rather than failing.
//
// Everything the caller must own is passed in: this module never reaches for the
// live handle (index.ts holds it) and never talks to a window.

import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';
import type Database from 'better-sqlite3';

import { commitFileAtomic } from './lib-atomic.ts';
import { createGeneration, generationsDir, listGenerations, parseGenerationName, pruneGenerations } from './lib-db-generations.ts';
import { postsByIds } from './lib-db-query.ts';
import { makeTagResolver, preparePostStmts, writePost } from './lib-db-record-writer.ts';
import { createDbWriter, ensureLibraryId } from './lib-db-write.ts';
import { openDatabase } from './lib-db.ts';

export interface RollbackDeps {
  /** The library folder the generation store lives in; null when unset. */
  saveFolder(): string | null;
  /** Absolute path of the live database file. */
  dbFile(): string;
  /** Opens the DB and drains the intake queue (index.ts's ensurePostsSynced). */
  ensurePostsSynced(): { sqlite: Database.Database } | null;
  /** Closes the live handle and forgets it, so the next ensure* reopens. */
  closeDb(): void;
}

export interface RollbackResult {
  ok: boolean;
  error?: string;
  /** File name of the generation rolled back to. */
  generation?: string;
  /** File name of the automatic pre-rollback snapshot. */
  stash?: string;
  /** Posts carried forward because the generation predates them. */
  reregistered?: number;
}

/**
 * Everything the restore UI lists: the local generation store, annotated with
 * whether the destination holds a copy of each one.
 */
export interface GenerationListing {
  name: string;
  /** ISO instant decoded from the file name (local wall clock, see the store). */
  at: string;
  size: number;
  /** #233: "この PC のみ／バックアップ先にもあり" — false when only local. */
  atDestination: boolean;
}

function listWithDestination(saveFolder: string | null, destinationRoot: string | null): GenerationListing[] {
  if (!saveFolder) return [];
  const atDestination = new Set(destinationRoot ? listGenerations(destinationRoot).map((g) => g.name) : []);
  return listGenerations(saveFolder).map((g) => ({ name: g.name, at: g.at, size: g.size, atDestination: atDestination.has(g.name) }));
}

/** The one place a caller-supplied generation name becomes a path. */
function resolveGeneration(saveFolder: string, name: unknown): string | null {
  if (typeof name !== 'string' || !parseGenerationName(name)) return null;
  const file = path.join(generationsDir(saveFolder), name);
  return fs.existsSync(file) ? file : null;
}

/**
 * Copies records the generation never knew about out of `stashFile` and into the
 * freshly restored database. Returns how many were re-registered.
 *
 * Reads through the same assembled-record shape the rest of the app uses, so
 * every column a post owns travels — the alternative (re-reading sidecars or
 * re-analyzing files) is exactly the metadata decay #233 rules out.
 */
async function reregisterNewerPosts(sqlite: Database.Database, stashFile: string): Promise<number> {
  const stash = openDatabase(stashFile, { readonly: true });
  try {
    const restored = new Set((sqlite.prepare('SELECT captureId FROM posts').all() as Array<{ captureId: string }>).map((r) => r.captureId));
    const ids = (stash.sqlite.prepare('SELECT captureId FROM posts').all() as Array<{ captureId: string }>).map((r) => r.captureId).filter((id) => !restored.has(id));
    if (!ids.length) return 0;

    const stmts = preparePostStmts(sqlite);
    const resolveTagId = makeTagResolver(sqlite);
    const writer = createDbWriter(sqlite);
    const stashWriter = createDbWriter(stash.sqlite);
    let done = 0;
    // Chunked so the IN(...) list stays well under SQLite's variable limit on a
    // library that gained thousands of posts since the generation, and so the
    // read (async) never sits inside the write transaction (sync).
    for (let i = 0; i < ids.length; i += 200) {
      const records = await postsByIds(stash.sqlite, ids.slice(i, i + 200));
      sqlite.transaction(() => {
        for (const rec of records) {
          writePost(stmts, resolveTagId, rec);
          const flags = stashWriter.getPostFlags(rec.captureId);
          if (flags) writer.restorePostFlags(rec.captureId, { userKind: flags.userKind, tagReviewed: flags.tagReviewed, folders: flags.folders, manualGroups: flags.manualGroups });
        }
      })();
      done += records.length;
    }
    return done;
  } finally {
    stash.sqlite.close();
  }
}

/**
 * Puts the library's organization back to `name`.
 *
 * Order matters and is the whole safety story: stash BEFORE closing (a snapshot
 * needs a live handle), replace atomically (a half-copied database is worse than
 * either version), and re-open before sweeping (the sweep writes through the
 * normal record writer, not through raw SQL against a file).
 */
async function rollbackToGeneration(name: unknown, deps: RollbackDeps): Promise<RollbackResult> {
  const folder = deps.saveFolder();
  if (!folder) return { ok: false, error: 'not-configured' };
  const target = resolveGeneration(folder, name);
  if (!target) return { ok: false, error: 'no-such-generation' };

  const handle = deps.ensurePostsSynced();
  if (!handle) return { ok: false, error: 'not-configured' };

  // The identity survives a rollback: this is the same library either way, and
  // a generation predating the id would otherwise come back with a new one and
  // make every configured backup destination read as "belongs to someone else".
  const libraryId = ensureLibraryId(handle.sqlite);

  let stashFile: string;
  try {
    stashFile = await createGeneration(handle.sqlite, folder);
  } catch (err: any) {
    log.error('rollback: could not stash the current database:', err);
    return { ok: false, error: 'stash-failed' };
  }

  const live = deps.dbFile();
  deps.closeDb();
  try {
    await commitFileAtomic(live, (tmp) => fs.promises.copyFile(target, tmp), { tmpSuffix: `.tmp-${Date.now()}` });
    // A WAL left over from the connection just closed belongs to the file that
    // was there a moment ago; applied on top of the restored one it would
    // reintroduce exactly the writes the rollback undoes.
    for (const suffix of ['-wal', '-shm']) {
      try {
        await fs.promises.rm(live + suffix, { force: true });
      } catch {
        /* best-effort */
      }
    }
  } catch (err: any) {
    log.error('rollback: could not replace the live database:', err);
    // commitFileAtomic leaves the original in place on failure, so re-opening
    // lands back on the pre-rollback library rather than on nothing.
    deps.ensurePostsSynced();
    return { ok: false, error: 'replace-failed' };
  }

  const restored = deps.ensurePostsSynced();
  if (!restored) return { ok: false, error: 'reopen-failed' };
  createDbWriter(restored.sqlite).stateSet('libraryId', libraryId);

  let reregistered = 0;
  try {
    reregistered = await reregisterNewerPosts(restored.sqlite, stashFile);
  } catch (err: any) {
    // The rollback itself stands; what failed is carrying the newer posts over.
    // Reported rather than swallowed — "N re-registered" would be a lie.
    log.error('rollback: re-registration sweep failed:', err);
    return { ok: false, error: 'sweep-failed', generation: path.basename(target), stash: path.basename(stashFile) };
  }

  // The stash is a generation like any other, so the store's retention applies
  // to it too — otherwise a run of rollbacks would grow the store unbounded.
  await pruneGenerations(folder);
  log.info(`rolled back to ${path.basename(target)} (stash ${path.basename(stashFile)}, ${reregistered} post(s) re-registered)`);
  return { ok: true, generation: path.basename(target), stash: path.basename(stashFile), reregistered };
}

export { listWithDestination, resolveGeneration, reregisterNewerPosts, rollbackToGeneration };
