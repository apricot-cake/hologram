'use strict';

// The backup engine (#227 moved it out of index.ts; #233 re-shaped it).
//
// One engine, two lanes, and a destination adapter underneath:
//
//   media lane  every file the library owns — root, avatars/, emoji/ and, since
//               #233, .trash/ as well. Write-once, so an incremental pass only
//               has to carry what is not at the destination yet. It runs right
//               after a save too (noteLibraryMutation), because a post that is
//               gone from the web cannot be fetched again: the loss window for
//               media is meant to be zero, not one interval.
//   DB lane     the live database is never copied as a file (#97). It reaches a
//               backup as a generation written through SQLite's Online Backup
//               API into the LOCAL generation store (lib-db-generations.ts),
//               which is the source of truth; the destination just gets the
//               same store.
//
// Both lanes end in the same place: build the picture of what the destination
// should contain, ask the destination what it does contain, and write the
// difference (lib-backup-plan.ts). #233 splits "what to back up" from "how to
// write it" (lib-backup-destination.ts) so the OAuth cloud destinations are a
// second adapter rather than a second engine.
//
// The integrity pass is here because it LIVED here, not because it is a backup:
// #301 put it in this block on purpose ("share the detection mechanism with
// #100's item 1, don't duplicate the implementation"), so a run's already-scanned
// file set can be reused and the daily reconciliation costs no extra readdir.
//
// What the engine cannot own is the record pipeline: it must sync the DB before
// it snapshots or counts orphans, and that pipeline stays in index.ts. Those
// three calls arrive through createBackupEngine's deps rather than an import, so
// this module has no edge back into the assembly.

import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';
import type Database from 'better-sqlite3';

import { INBOX_DIRNAME } from '../../../native-host/inbox.mts';
import { configDir } from './native-host.ts';
import { getSaveFolder, readLibraryBackupConfig, writeLibraryBackupConfig, readLibraryIntegrityStatus, writeLibraryIntegrityStatus } from './lib-config.ts';
import { BACKUP_SUBDIR, backupRoot, TMP_RE } from './lib-backup-destination.ts';
import type { BackupDestination } from './lib-backup-destination.ts';
import { isDestinationConfigured, overlaps, pathIsInside, resolveBackupDestination } from './lib-backup-destinations.ts';
import { createSafeStorageCipher } from './lib-oauth-safe-storage.ts';
import { ensureLibraryId } from './lib-db-write.ts';
import { groupOf, planBackup } from './lib-backup-plan.ts';
import type { SourceFile } from './lib-backup-plan.ts';
import { GENERATIONS_DIRNAME, createGeneration, latestGeneration, listGenerations, pruneGenerations } from './lib-db-generations.ts';
import { listWithDestination, rollbackToGeneration } from './lib-db-rollback.ts';
import { checkOrphans, recoverOrphanRecords } from './lib-db-integrity.ts';
import type { DbHandle } from './ipc-context.ts';

/** What the engine needs from the record pipeline index.ts owns. */
export interface BackupEngineDeps {
  /** Opens the DB and drains the intake queue; null when no save folder is set. */
  ensurePostsSynced(): DbHandle | null;
  scheduleSavedIndexWrite(handle: { sqlite: Database.Database }): void;
  /** Pushes to the main window's renderer; a no-op when the window is gone. */
  send(channel: string, ...args: unknown[]): void;
  /** Absolute path of the live database — the file a rollback replaces. */
  dbFile(): string;
  /** Drops the live handle so the next ensurePostsSynced reopens from disk. */
  closeDb(): void;
}

// The library's trash bucket. Mirrored since #233 (it used to be skipped), so a
// restore brings back the pending deletions as pending deletions instead of
// resurrecting them as live posts with their trashed-at time lost.
const TRASH_SUBDIR = '.trash';
// The live database and its WAL sidecars, never carried by the media lane: a
// file-level copy of a database being written to is inconsistent by
// construction (#97), and the consistent copy already exists as the generation
// store. Named here rather than found, because #176 put the database INSIDE
// the library folder — without this exclusion the root sweep below would pick
// it up and ship an inconsistent copy alongside the real one.
const LIVE_DB_NAMES = new Set(['hologram.db', 'hologram.db-wal', 'hologram.db-shm']);
// (LIBRARY_SUBDIR — the named subfolder for a relocated library — lives in
// ./ipc-transfer.ts with the pick-save-folder handler that owns it.)

// Backup destination + integrity status used to be ONE flat key each on
// config.json; #176 moved both under the current library's libraries[] entry
// (lib-config.ts) so a switch carries its own destination and status rather
// than sharing the whole app's. The no-argument call shape here is unchanged —
// every caller already meant "the current library".
const readBackupConfig = readLibraryBackupConfig;
const writeBackupConfig = writeLibraryBackupConfig;
const readIntegrityStatus = readLibraryIntegrityStatus;
const writeIntegrityStatus = writeLibraryIntegrityStatus;

// The settings UI validates the folder the user picked before it is written to
// the config; the same rule the resolver applies at run time (a destination
// nested with the library makes the backup feed itself).
function validateBackupDir(dir: string | null | undefined) {
  if (!dir) return { ok: true };
  return overlaps(dir, getSaveFolder()) ? { ok: false, error: 'overlap' } : { ok: true };
}

/** What the destination resolver needs that only the app can supply. */
function destinationDeps() {
  return { saveFolder: getSaveFolder(), vaultDir: configDir(), cipher: createSafeStorageCipher() };
}

// --- Save-folder relocation ---
// Reject a destination that would corrupt the library or loop: the current
// folder itself, anything nested with it (can't move a folder into its own
// child), the config dir, or the backup destination. Last, prove it's writable.
function validateSaveFolder(dir) {
  if (!dir || typeof dir !== 'string' || !dir.trim()) return { ok: false, error: 'invalid' };
  const cur = getSaveFolder();
  if (path.resolve(dir) === path.resolve(cur)) return { ok: false, error: 'same' };
  if (pathIsInside(dir, cur) || pathIsInside(cur, dir)) return { ok: false, error: 'nested' };
  if (pathIsInside(dir, configDir()) || pathIsInside(configDir(), dir)) return { ok: false, error: 'config-overlap' };
  const b = readBackupConfig();
  if (b && b.dir && (pathIsInside(dir, b.dir) || pathIsInside(b.dir, dir))) return { ok: false, error: 'backup-overlap' };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.hologram-write-probe-${Date.now()}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
  } catch {
    return { ok: false, error: 'not-writable' };
  }
  return { ok: true };
}

// Because Node's setInterval clamps a delay over 2^31-1 ms to 1ms, passing a
// large interval directly (week×4 or more, year, etc.) causes it to run out of
// control. Changed to a scheme that judges due-ness with a short heartbeat
// (1 minute) and only runs once the threshold is exceeded.
const BACKUP_HEARTBEAT_MS = 60 * 1000;
function backupIntervalMs(b) {
  // 'year' has been removed from the UI but is kept for backward compatibility with old config values
  const unitMs = { day: 86400000, week: 604800000, month: 2592000000, year: 31536000000 };
  return Math.max(60000, (Number(b.intervalValue) || 1) * (unitMs[b.intervalUnit] || unitMs.day));
}

// A save settles into the media lane this long after the last library change.
// Long enough that a bulk import fires one run instead of hundreds, short
// enough that "backed up right after saving" is true in the way the user means.
const IMMEDIATE_BACKUP_DELAY_MS = 15 * 1000;
// The DB lane's non-time trigger ("変更N件"): how many library changes may
// accumulate before the next generation is written regardless of the clock.
const GENERATION_CHANGE_THRESHOLD = 50;
// …and its time trigger: one generation a day is #233's "日次" boundary.
const GENERATION_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Everything the library offers a backup, keyed by destination-relative path.
 * Directory names are the library's own, so a destination is a readable copy of
 * the library rather than a repacked format.
 */
async function collectLibraryFiles(src: string): Promise<Map<string, SourceFile>> {
  const out = new Map<string, SourceFile>();
  const add = async (rel: string, abs: string, mutable?: boolean) => {
    try {
      const st = await fs.promises.stat(abs);
      if (st.isFile()) out.set(rel, { abs, size: st.size, mtimeMs: st.mtimeMs, mutable });
    } catch {
      /* skip inaccessible entries */
    }
  };
  const collectDir = async (sub: string, mutable?: (name: string) => boolean) => {
    let names: string[];
    try {
      names = await fs.promises.readdir(path.join(src, ...sub.split('/')));
    } catch {
      return; // absent (a library that never grew that folder)
    }
    for (const f of names) {
      if (TMP_RE.test(f)) continue;
      await add(`${sub}/${f}`, path.join(src, ...sub.split('/'), f), mutable ? mutable(f) : undefined);
    }
  };

  let rootNames: string[];
  try {
    rootNames = await fs.promises.readdir(src);
  } catch {
    rootNames = [];
  }
  for (const f of rootNames) {
    if (TMP_RE.test(f) || LIVE_DB_NAMES.has(f)) continue;
    await add(f, path.join(src, f));
  }
  // Shared stores, single level and write-once, mirrored under their own names
  // so a restore keeps author icons (#290 added emoji/ in the same shape).
  await collectDir('avatars');
  await collectDir('emoji');
  // The trash's sidecar JSON gains a `trashedAt` when the post lands there, so
  // it is the one file in the library that is not write-once.
  await collectDir(TRASH_SUBDIR, (f) => /\.json$/i.test(f));
  await collectDir(`${INBOX_DIRNAME}/new`);
  await collectDir(`${INBOX_DIRNAME}/segments`);
  // Quarantined envelopes (#920) are saved content that never reached the DB,
  // so a backup that skipped them would be the one place their bytes are lost.
  await collectDir(`${INBOX_DIRNAME}/failed`);
  await collectDir(GENERATIONS_DIRNAME);
  return out;
}

/**
 * The engine and the integrity pass it shares a run with. Called once, from
 * index.ts's ctx assembly — the in-flight flags and the heartbeat timer are this
 * closure's state rather than module-level, so a second engine cannot silently
 * share them with the first.
 */
function createBackupEngine({ ensurePostsSynced, scheduleSavedIndexWrite, send, dbFile, closeDb }: BackupEngineDeps) {
  // The one shared DB<->media reconciliation pass (#301 design: "share the
  // detection mechanism with #100's item 1, don't duplicate the implementation")
  // — called both at startup (independent of any backup config) and from
  // runBackup (piggybacking the interval run as the "daily reconciliation").
  // `knownFiles`, when passed, is the run's already-collected library listing,
  // which skips a second readdir of the save folder.
  function runIntegrityPass(folder: string, sqlite: any, knownFiles?: Set<string>) {
    let dbOk = true;
    try {
      const check = sqlite.pragma('integrity_check', { simple: true });
      dbOk = check === 'ok';
      if (!dbOk) log.error(`integrity_check failed: ${check}`);
    } catch (err) {
      dbOk = false;
      log.error('integrity_check threw:', err);
    }
    const { orphanMedia, missingMedia } = checkOrphans(folder, sqlite, knownFiles);
    const status = writeIntegrityStatus({ lastCheckAt: new Date().toISOString(), dbOk, orphanCount: orphanMedia.length, missingCount: missingMedia.length });
    send('integrity-check-done', status);
    return { dbOk, orphanMedia, missingMedia };
  }

  // Standalone startup check (armBackupSchedule() call site) — must work with no
  // destination configured, so it opens the DB itself rather than piggybacking
  // on runBackup (which early-returns before opening anything when `!b.dir`).
  async function runStartupIntegrityCheck() {
    const folder = getSaveFolder();
    if (!folder) return;
    // #37: a folder that does not exist on disk would make every post's media
    // read back as "missing" — noise from the folder being unavailable, not a
    // real DB<->media mismatch. Skip the pass entirely rather than let it
    // report thousands of false positives while the library is unreachable.
    if (!fs.existsSync(folder)) return;
    try {
      // ensurePostsSynced (not raw ensureDb) — see runBackup's identical
      // reasoning: the DB must reflect disk state before orphans are computed,
      // and this timer can fire before the renderer's first listPosts() call.
      const handle = await ensurePostsSynced();
      if (!handle) return;
      runIntegrityPass(folder, handle.sqlite);
    } catch (err) {
      log.error('startup integrity check failed:', err);
    }
  }

  // Manual-trigger orphan recovery (#301 design: never automatic — see
  // lib-db-integrity.ts's recoverOrphanRecords comment for why a save still
  // mid-flight must never be misread as a permanent loss). Re-runs the
  // integrity pass afterward so the visible orphanCount drops immediately.
  // `adopted` counts the orphans whose own sidecar was read back rather than
  // summarized into a minimal record (#511) — worth logging, since the two
  // outcomes differ in everything but the count.
  async function runOrphanRecovery() {
    const folder = getSaveFolder();
    if (!folder) return { ok: false, error: 'not-configured' };
    // #37: never synthesize "recovered" records against a folder that is not
    // actually there — every post would look orphaned/missing for the wrong
    // reason, and recovery would have nothing real to read back from.
    if (!fs.existsSync(folder)) return { ok: false, error: 'library-missing' };
    const handle = await ensurePostsSynced();
    if (!handle) return { ok: false, error: 'not-configured' };
    const written = recoverOrphanRecords(folder, handle.sqlite);
    if (written.length) scheduleSavedIndexWrite(handle);
    runIntegrityPass(folder, handle.sqlite);
    const adopted = written.filter((w) => w.via === 'sidecar').length;
    if (written.length) log.info(`orphan recovery: ${written.length} recovered (${adopted} from a sidecar, ${written.length - adopted} synthesized)`);
    return { ok: true, recovered: written.length, adopted };
  }

  // --- DB lane ------------------------------------------------------------
  let generationRunning = false;
  let mutationsSinceGeneration = 0;

  /** Has a boundary passed since the newest generation was written? */
  function generationDue(folder: string): boolean {
    const list = listGenerations(folder);
    if (!list.length) return true;
    if (mutationsSinceGeneration >= GENERATION_CHANGE_THRESHOLD) return true;
    return Date.now() - Date.parse(list[0].at) >= GENERATION_INTERVAL_MS;
  }

  /**
   * Writes one generation into the local store and thins the store afterwards.
   * `force` is the manual "make a restore point now" path; without it the
   * boundaries (a day elapsed, or enough changes piled up) decide.
   */
  async function runDbGeneration(reason: string, force = false) {
    const folder = getSaveFolder();
    if (!folder) return { ok: false, error: 'not-configured' };
    if (!fs.existsSync(folder)) return { ok: false, error: 'src-missing' };
    if (generationRunning) return { ok: false, error: 'busy' };
    if (!force && !generationDue(folder)) return { ok: false, error: 'not-due' };
    generationRunning = true;
    const startedAt = Date.now();
    try {
      const handle = await ensurePostsSynced();
      if (!handle) return { ok: false, error: 'not-configured' };
      const file = await createGeneration(handle.sqlite, folder);
      mutationsSinceGeneration = 0;
      const removed = await pruneGenerations(folder);
      // Timed for the same reason the media run is (see runBackup's closing
      // log): the boundaries are provisional numbers waiting on real use.
      log.info(`db generation written (${reason}) in ${Date.now() - startedAt}ms: ${path.basename(file)}${removed.length ? ` — thinned ${removed.length}` : ''}`);
      return { ok: true, file, thinned: removed.length };
    } catch (err: any) {
      log.error('db generation failed:', err);
      return { ok: false, error: err?.message || 'failed' };
    } finally {
      generationRunning = false;
    }
  }

  /**
   * #176's requirement, enforced here because #233 owns the destinations: a
   * destination records which library it belongs to, and a run against a
   * different library is refused OUTRIGHT rather than left to backup-guard.
   *
   * The guard has to sit in front, not inside: the destination of library A
   * holding library B's much smaller (or merely different) content is not a
   * "source collapsed" shape, so the shrink ratio would let the prune through
   * and A's backup would be pruned down to B. A destination with no id yet is
   * adopted — the mechanism postdates the destinations it protects.
   */
  async function claimDestination(destination: BackupDestination): Promise<{ ok: true; libraryId: string } | { ok: false; error: string }> {
    const handle = await ensurePostsSynced();
    if (!handle) return { ok: false, error: 'not-configured' };
    const libraryId = ensureLibraryId(handle.sqlite);
    const identity = await destination.readIdentity();
    if (identity && identity.libraryId !== libraryId) {
      log.warn(`backup refused: ${destination.location} belongs to another library (${identity.libraryId})`);
      return { ok: false, error: 'library-mismatch' };
    }
    if (!identity) await destination.writeIdentity({ libraryId, lastRunAt: null });
    return { ok: true, libraryId };
  }

  /**
   * The restore UI's list (#233): the local store, plus whether the configured
   * destination holds each generation. The distinction is the point — a
   * generation that exists only here still rolls the library back, but it is
   * not a copy that survives this machine.
   */
  function listDbGenerations() {
    const b = readBackupConfig();
    // Reads the destination as a folder on this machine, so a cloud
    // destination reports "this PC only" for every generation even when copies
    // are up there. Telling the two apart over an API is an async listing, and
    // this handler is synchronous all the way to the renderer — the restore UI
    // is #911's half of the work.
    return listWithDestination(getSaveFolder(), b.dir ? backupRoot(b.dir) : null);
  }

  /**
   * The user-facing rollback. Held against the same two flags the lanes use, so
   * a scheduled run cannot be writing (or snapshotting) the database while it
   * is being replaced underneath.
   */
  async function rollbackDbGeneration(name: unknown) {
    const folder = getSaveFolder();
    if (!folder) return { ok: false, error: 'not-configured' };
    if (backupRunning || generationRunning) return { ok: false, error: 'busy' };
    generationRunning = true;
    try {
      const result = await rollbackToGeneration(name, { saveFolder: getSaveFolder, dbFile, ensurePostsSynced, closeDb });
      // The stash IS this library's newest generation, so the change counter
      // starts over whether or not the sweep behind it succeeded.
      if (result.stash) mutationsSinceGeneration = 0;
      return result;
    } finally {
      generationRunning = false;
    }
  }

  // --- media lane ---------------------------------------------------------
  let backupRunning = false;
  async function runBackup(reason) {
    const b = readBackupConfig();
    const src = getSaveFolder();
    if (!src) return { ok: false, error: 'not-configured' };
    // #37: never let a missing library read as "an empty library backed up
    // successfully" — refuse instead of collecting 0 files and writing that
    // as this run's lastResult (backup-guard's prune-skip only protects the
    // DESTINATION's existing files; it does not stop this misleading "ok"
    // outcome).
    if (!fs.existsSync(src)) return { ok: false, error: 'src-missing' };
    if (backupRunning) return { ok: false, error: 'busy' };
    // Everything that differs between a folder and a cloud account — is it
    // configured, is the drive there, is the account still connected — is
    // decided by the resolver (#909). The engine below drives whatever comes
    // back and has no idea which kind it got.
    const resolved = resolveBackupDestination(b, destinationDeps());
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const destination = resolved.destination;
    // Before the run is even announced: a refusal here must not read as a
    // backup that started, and nothing may be written to a destination that
    // turns out to belong to someone else. A cloud destination reaches the
    // network to answer, so this is also where "the account cannot be talked
    // to at all" lands — still with nothing written.
    let claim: Awaited<ReturnType<typeof claimDestination>>;
    try {
      claim = await claimDestination(destination);
    } catch (err) {
      log.warn(`backup could not reach ${destination.location}:`, err);
      return { ok: false, error: 'dest-unreachable' };
    }
    if (!claim.ok) return { ok: false, error: claim.error };
    backupRunning = true;
    send('backup-start'); // sidebar status → running
    const startedAt = Date.now();
    const result: any = { ok: true, reason: reason || 'manual', fileCount: 0, written: 0, moved: 0, pruned: 0 };
    try {
      // The DB lane runs first when a boundary is due, so the generation it
      // writes is part of what this same pass carries to the destination.
      await runDbGeneration(reason || 'manual');

      const source = await collectLibraryFiles(src);
      const present = await destination.list();
      const prevSummary = b.lastResult || {};
      const baseline = Number(prevSummary.lastGoodCount) || Number(prevSummary.fileCount) || 0;
      const plan = planBackup(source, present, baseline);

      // Moves first: a relocation frees the name a copy would otherwise land
      // on, and it is the operation that must never turn into re-transferring
      // the bytes.
      for (const m of plan.move) {
        try {
          await destination.move(m.from, m.to);
          result.moved++;
        } catch (e: any) {
          // A move that failed is not data loss — the next pass copies the file
          // and prunes the stale name.
          if (!result.firstError) result.firstError = e.message;
        }
      }
      let segmentCopyFailed = false;
      for (const c of plan.copy) {
        try {
          await destination.put(c.rel, c.abs, c.mtimeMs);
          result.written++;
        } catch (e: any) {
          // Surface the first copy error but keep going for the rest
          if (!result.firstError) result.firstError = e.message;
          if (groupOf(c.rel) === 'inbox-segments') segmentCopyFailed = true;
        }
      }
      const toPrune = segmentCopyFailed ? plan.prune : [...plan.prune, ...plan.pruneLoose];
      for (const rel of toPrune) {
        try {
          await destination.remove(rel);
          result.pruned++;
        } catch {
          /* already gone, or held by something else */
        }
      }

      result.fileCount = plan.mediaCount;
      result.pruneSkipped = plan.pruneSkipped;
      result.baselineCount = plan.baselineCount;
      result.lastGoodCount = plan.lastGoodCount;

      // The daily reconciliation piggybacks this run (#301), reusing the
      // listing it already collected so the orphan/missing scan costs no extra
      // readdir. ensurePostsSynced (not raw ensureDb) so the DB reflects what is
      // actually on disk before orphans are computed against it — otherwise a
      // backup firing before the renderer's first listPosts() could see an empty
      // posts table and flag every file as orphaned.
      try {
        const handle = await ensurePostsSynced();
        if (!handle) throw new Error('save folder unavailable');
        // Root-level names only: findOrphanMedia's contract is the library
        // root (a trashed capture still has its posts row, and the shared
        // stores are not per-capture artifacts), so the subfolder entries this
        // run collected are not its business.
        const known = new Set([...source.keys()].filter((rel) => !rel.includes('/')));
        const pass = runIntegrityPass(src, handle.sqlite, known);
        result.orphanCount = pass.orphanMedia.length;
        result.missingCount = pass.missingMedia.length;
      } catch (e: any) {
        if (!result.firstError) result.firstError = e.message;
      }
    } catch (err) {
      result.ok = false;
      result.error = err.message;
    } finally {
      backupRunning = false;
    }
    const at = new Date().toISOString();
    const summary = {
      fileCount: result.fileCount,
      written: result.written,
      moved: result.moved,
      pruned: result.pruned,
      reason: result.reason,
      ok: result.ok,
      error: result.error || result.firstError || null,
      at: at,
      pruneSkipped: result.pruneSkipped || null,
      baselineCount: result.baselineCount || 0,
      lastGoodCount: typeof result.lastGoodCount === 'number' ? result.lastGoodCount : 0,
      orphanCount: result.orphanCount || 0,
      missingCount: result.missingCount || 0,
    };
    try {
      writeBackupConfig({ lastRunAt: at, lastResult: summary });
    } catch {
      /* ignore */
    }
    try {
      await destination.writeIdentity({ libraryId: claim.libraryId, lastRunAt: at });
    } catch {
      /* the claim already stands; only its timestamp is behind */
    }
    // #233 (2026-08-02): the interval and the change threshold ship at their v1
    // numbers and get tuned by how they FEEL, so how long a run took and how
    // long since the last one has to be readable somewhere. The log is that
    // somewhere — without it there is no way to tell which number to move.
    const sinceLast = b.lastRunAt ? Math.round((startedAt - Date.parse(b.lastRunAt)) / 1000) : null;
    log.info(`backup run (${summary.reason}) took ${Date.now() - startedAt}ms${sinceLast === null ? '' : `, ${sinceLast}s since the last run`} — ${summary.fileCount} file(s), +${summary.written} copied, ${summary.moved} moved, ${summary.pruned} pruned${summary.ok ? '' : ` — FAILED: ${summary.error}`}`);
    send('backup-done', Object.assign({}, result, { at: at }));
    return result;
  }

  // Called by the record pipeline whenever the library changed. Two jobs: keep
  // the DB lane's change counter, and start the countdown that gives the media
  // lane its "right after the save" pass. Both are debounced by construction —
  // a bulk import calls this hundreds of times and gets one run.
  let immediateTimer: any = null;
  function noteLibraryMutation(count = 1) {
    mutationsSinceGeneration += Math.max(1, Number(count) || 1);
    // Nothing schedules itself until the engine has been armed — the smoke
    // harnesses boot the app without arming it, and a backup starting on its
    // own behind a test's back is exactly the flake that would follow.
    if (!scheduleArmed) return;
    if (mutationsSinceGeneration >= GENERATION_CHANGE_THRESHOLD) void runDbGeneration('changes');
    if (!isDestinationConfigured(readBackupConfig())) return;
    clearTimeout(immediateTimer);
    immediateTimer = setTimeout(() => {
      void runBackup('changed');
    }, IMMEDIATE_BACKUP_DELAY_MS);
  }

  let backupIntervalTimer: any = null;
  let scheduleArmed = false;
  function armBackupSchedule() {
    scheduleArmed = true;
    if (backupIntervalTimer) {
      clearInterval(backupIntervalTimer);
      backupIntervalTimer = null;
    }
    // The heartbeat is unconditional now: the DB lane's daily boundary has to
    // pass even with no destination configured, because the local generation
    // store is what a rollback reads (#233) and it must exist before the user
    // ever picks a backup folder.
    backupIntervalTimer = setInterval(() => {
      const cur = readBackupConfig();
      if (isDestinationConfigured(cur) && cur.interval) {
        const last = cur.lastRunAt ? Date.parse(cur.lastRunAt) : 0;
        if (Date.now() - last >= backupIntervalMs(cur)) {
          void runBackup('interval');
          return; // the run writes its own generation
        }
      }
      void runDbGeneration('daily');
    }, BACKUP_HEARTBEAT_MS);
  }

  // #176's switchLibrary waits for both lanes to go idle before it closes the
  // live DB out from under them (a close mid-run is what runDbGeneration's own
  // `generationRunning` guard against rollback already protects against —
  // switching reuses the same two flags rather than inventing a third).
  const isBusy = () => backupRunning || generationRunning;

  return { runBackup, runDbGeneration, listDbGenerations, rollbackDbGeneration, armBackupSchedule, runStartupIntegrityCheck, runOrphanRecovery, noteLibraryMutation, isBusy };
}

/**
 * The newest database copy available to restore from, or null. The local
 * generation store wins; a destination's copy of it is the fallback for the
 * case the store is meant for — this machine's library is gone.
 */
function latestRestorableSnapshot(): string | null {
  const folder = getSaveFolder();
  if (folder) {
    const local = latestGeneration(folder);
    if (local) return local;
  }
  const b = readBackupConfig();
  // Only a folder destination can be read straight off disk at startup. Pulling
  // the newest generation down from a cloud account is a download with its own
  // progress and failure modes, which belongs with the restore UI (#911) rather
  // than in the path that has to decide within a second of launch.
  if (!b.dir) return null;
  // listGenerations takes the folder that CONTAINS the store, which at a
  // destination is its root — the destination holds a copy of the store under
  // the same name the library uses.
  const list = listGenerations(backupRoot(b.dir));
  return list.length ? list[0].file : null;
}

export { BACKUP_SUBDIR, backupRoot, collectLibraryFiles, latestRestorableSnapshot, readBackupConfig, writeBackupConfig, readIntegrityStatus, validateBackupDir, validateSaveFolder, backupIntervalMs, createBackupEngine };
