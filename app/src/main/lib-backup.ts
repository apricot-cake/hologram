'use strict';

// Backup / incremental mirror (#227) — index.ts's `// --- Backup / incremental mirror ---`
// section, moved out whole: the mirror engine, its schedule, the config it reads,
// the two destination validators that sit in the same block, and the DB<->media
// integrity pass that piggybacks the same run.
//
// The integrity pass is here because it LIVED here, not because it is a backup:
// #301 put it in this block on purpose ("share the detection mechanism with
// #100's item 1, don't duplicate the implementation"), so runBackup's already-scanned file set can be reused and the daily
// reconciliation costs no extra readdir. Splitting the two apart would either
// duplicate that scan or reintroduce the coupling as an import.
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
import { readConfig, writeConfig, getSaveFolder } from './lib-config.ts';
import { commitFileAtomic } from './lib-atomic.ts';
import { pruneDecision, nextBaseline } from './backup-guard.ts';
import { snapshotDatabase } from './lib-db-snapshot.ts';
import { checkOrphans, recoverOrphanRecords } from './lib-db-integrity.ts';
import type { DbHandle } from './ipc-context.ts';

/** What the mirror engine needs from the record pipeline index.ts owns. */
export interface BackupEngineDeps {
  /** Opens the DB and drains the intake queue; null when no save folder is set. */
  ensurePostsSynced(): DbHandle | null;
  scheduleSavedIndexWrite(handle: { sqlite: Database.Database }): void;
  /** Pushes to the main window's renderer; a no-op when the window is gone. */
  send(channel: string, ...args: unknown[]): void;
}

// The library's trash bucket, skipped when collecting source files. Named again
// here rather than shared: lib-db-integrity.ts already keeps its own copy for the
// same reason (a one-token layout constant is cheaper to restate than to route
// through an import that would tie two otherwise-independent sweeps together).
const TRASH_SUBDIR = '.trash';

// Placing the save folder itself inside a cloud-sync folder makes it fragile to
// sync happening mid live-write.
// Here we keep a "copy (remote)" inside the chosen "destination folder".
// Assets are immutable (never change once written) → copy only files missing at
// the destination (O(new)).
// Deletion propagates to the destination too (latest mirror). ZIP stays reserved
// for manual export only.
// As a safeguard against dumping straight into the destination root, write to a
// dedicated subfolder (BACKUP_SUBDIR below).
const BACKUP_SUBDIR = 'Hologram-mirror';
function backupDest(dir) {
  return path.join(dir, BACKUP_SUBDIR);
}
// (LIBRARY_SUBDIR — the named subfolder for a relocated library — lives in
// ./ipc-transfer.ts with the pick-save-folder handler that owns it.)

// Where runBackup's DB snapshot lands (#301) — a dedicated subfolder under the
// mirror root, same "don't dump into dest's top level" convention INBOX_DIRNAME
// already follows there. Read by index.ts (restore) and written in runBackup
// (snapshot); kept as one function so the two never drift apart.
function dbSnapshotPath(backupDir: string) {
  return path.join(backupDest(backupDir), 'hologram-db', 'hologram.db');
}

const BACKUP_DEFAULTS = {
  dir: null, // Output destination (must not overlap with the save folder, inside or out)
  interval: false, // fixed interval
  intervalValue: 1, // interval count
  intervalUnit: 'day', // 'day' | 'week' | 'month'
  lastRunAt: null,
  lastResult: null,
};
function readBackupConfig() {
  const b = readConfig().backup || {};
  return Object.assign({}, BACKUP_DEFAULTS, b);
}
function writeBackupConfig(patch) {
  const cfg = readConfig();
  cfg.backup = Object.assign({}, BACKUP_DEFAULTS, cfg.backup || {}, patch || {});
  writeConfig(cfg);
  return cfg.backup;
}

// Integrity-check status (#301) — kept OUT of BACKUP_DEFAULTS/backup config on
// purpose: the startup orphan/integrity_check pass must run and be visible
// even when no mirror `dir` is configured (that's the whole point of it being
// separate from the "daily reconciliation" pass that piggybacks on runBackup),
// so it cannot live inside a config object whose UI treats `dir` as the
// feature's on/off switch.
const INTEGRITY_DEFAULTS = {
  lastCheckAt: null,
  dbOk: null, // null = never checked yet
  orphanCount: 0,
  missingCount: 0,
};
function readIntegrityStatus() {
  return Object.assign({}, INTEGRITY_DEFAULTS, readConfig().integrity || {});
}
function writeIntegrityStatus(patch) {
  const cfg = readConfig();
  cfg.integrity = Object.assign({}, INTEGRITY_DEFAULTS, cfg.integrity || {}, patch || {});
  writeConfig(cfg);
  return cfg.integrity;
}

function pathIsInside(child, parent) {
  const c = path.resolve(child),
    p = path.resolve(parent);
  return c === p || c.startsWith(p + path.sep);
}
// If the output destination is nested inside/identical to the save folder, an
// output -> watch -> re-export loop or corruption occurs.
function validateBackupDir(dir) {
  if (!dir) return { ok: true };
  const src = getSaveFolder();
  if (src && (pathIsInside(dir, src) || pathIsInside(src, dir))) return { ok: false, error: 'overlap' };
  return { ok: true };
}

// --- Save-folder relocation ---
// Reject a destination that would corrupt the library or loop: the current
// folder itself, anything nested with it (can't move a folder into its own
// child), the config dir, or the backup mirror. Last, prove it's writable.
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

/**
 * The mirror engine and the integrity pass it shares a run with. Called once,
 * from index.ts's ctx assembly — `backupRunning` and the heartbeat timer are
 * this closure's state rather than module-level, so a second engine cannot
 * silently share the "a run is in flight" flag with the first.
 */
function createBackupEngine({ ensurePostsSynced, scheduleSavedIndexWrite, send }: BackupEngineDeps) {
  // The one shared DB<->media reconciliation pass (#301 design: "share the
  // detection mechanism with #100's item 1, don't duplicate the implementation")
  // — called both at startup (independent
  // of any backup config) and from runBackup (piggybacking the interval run as
  // the "daily reconciliation"). `knownFiles`, when passed, is runBackup's already-scanned
  // srcSet — skips a second readdir of the save folder.
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
  // backup mirror configured, so it opens the DB itself rather than piggybacking
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

  let backupRunning = false;
  async function runBackup(reason) {
    const b = readBackupConfig();
    const src = getSaveFolder();
    if (!src || !b.dir) return { ok: false, error: 'not-configured' };
    if (!validateBackupDir(b.dir).ok) return { ok: false, error: 'overlap' };
    // #37: never let a missing library read as "an empty library backed up
    // successfully" — refuse instead of collecting 0 files and writing that
    // as this run's lastResult (backup-guard's prune-skip only protects the
    // MIRROR's existing files; it does not stop this misleading "ok" outcome).
    if (!fs.existsSync(src)) return { ok: false, error: 'src-missing' };
    // #37: the destination's PARENT is gone (drive unplugged, folder renamed).
    // mkdir({recursive:true}) below would silently recreate the whole chain —
    // exactly the "looks fine, quietly starts over" failure this Issue closes.
    if (!fs.existsSync(b.dir)) return { ok: false, error: 'dest-missing' };
    if (backupRunning) return { ok: false, error: 'busy' };
    backupRunning = true;
    send('backup-start'); // sidebar sync icon → syncing
    // written = new files copied; pruned = files deleted (propagated deletions)
    const result: any = { ok: true, reason: reason || 'manual', fileCount: 0, written: 0, pruned: 0 };
    try {
      const dest = backupDest(b.dir);
      await fs.promises.mkdir(dest, { recursive: true });

      // Collect source files, skipping the trash bucket and transient write artifacts.
      // Keep each file's mtime so the mirror copy can carry it over.
      let srcFiles: string[];
      try {
        srcFiles = await fs.promises.readdir(src);
      } catch {
        srcFiles = [];
      }
      const srcSet = new Set<string>();
      const srcStat = new Map<string, any>(); // name -> { size, mtimeMs }
      for (const f of srcFiles) {
        if (f === TRASH_SUBDIR) continue;
        if (/\.tmp(-\d+)?$/i.test(f)) continue;
        try {
          const st = await fs.promises.stat(path.join(src, f));
          if (st.isFile()) {
            srcSet.add(f);
            srcStat.set(f, { size: st.size, mtimeMs: st.mtimeMs });
          }
        } catch {
          /* skip inaccessible entries */
        }
      }
      // Shared avatar store (avatars/<urlhash>.<ext> — write-once, single level):
      // mirror it under the same relative names so a restore keeps author icons.
      // Collected as 'avatars/<f>' entries; path.join resolves the '/' on Windows.
      const collectSubdir = async (root, sub, into, stats) => {
        let names: string[] = [];
        try {
          names = await fs.promises.readdir(path.join(root, sub));
        } catch {
          return; // subfolder absent (pre-avatars library)
        }
        for (const f of names) {
          if (/\.tmp(-\d+)?$/i.test(f)) continue;
          try {
            const st = await fs.promises.stat(path.join(root, sub, f));
            if (st.isFile()) {
              into.add(`${sub}/${f}`);
              if (stats) stats.set(`${sub}/${f}`, { size: st.size, mtimeMs: st.mtimeMs });
            }
          } catch {
            /* skip inaccessible entries */
          }
        }
      };
      await collectSubdir(src, 'avatars', srcSet, srcStat);
      // #290: the shared custom-emoji store, same write-once/single-level shape as avatars/.
      await collectSubdir(src, 'emoji', srcSet, srcStat);
      result.fileCount = srcSet.size;

      // Collect destination files
      // (.hologram-inbox mirroring happens further below, deliberately OUTSIDE
      // srcSet/destSet — see the comment there for why.)
      let destFiles: string[];
      try {
        destFiles = await fs.promises.readdir(dest);
      } catch {
        destFiles = [];
      }
      const destSet = new Set<string>(destFiles.filter((f) => !/\.tmp(-\d+)?$/i.test(f)));
      await collectSubdir(dest, 'avatars', destSet, null);
      await collectSubdir(dest, 'emoji', destSet, null);

      // .hologram-inbox/{new,segments} (#5 St6 / #299): mirrored separately from
      // srcSet/destSet, NOT folded into the general file-count pruneDecision()
      // guard above — compaction can legitimately shrink the loose event count
      // by >50% in one run (1,000 loose -> 1 segment), which must never look
      // like the "src collapsed" signal that guard exists to catch
      // (backup-guard.ts's module comment, the 2026-06-23 library-loss
      // incident). tmp/ is excluded; both new/ and segments/ entries are
      // immutable (write-once, like avatars/) so "present at dest" is proof
      // enough — no drift-refresh needed.
      const srcInboxNew = new Set<string>();
      const destInboxNew = new Set<string>();
      const srcInboxSegments = new Set<string>();
      const destInboxSegments = new Set<string>();
      const collectInboxSubdir = async (root: string, sub: string, into: Set<string>) => {
        let names: string[] = [];
        try {
          names = await fs.promises.readdir(path.join(root, INBOX_DIRNAME, sub));
        } catch {
          return; // no inbox (or that subdir) yet
        }
        for (const f of names) {
          if (/\.tmp(-\d+)?$/i.test(f)) continue;
          try {
            const st = await fs.promises.stat(path.join(root, INBOX_DIRNAME, sub, f));
            if (st.isFile()) into.add(f);
          } catch {
            /* skip inaccessible entries */
          }
        }
      };
      await collectInboxSubdir(src, 'new', srcInboxNew);
      await collectInboxSubdir(src, 'segments', srcInboxSegments);
      await collectInboxSubdir(dest, 'new', destInboxNew);
      await collectInboxSubdir(dest, 'segments', destInboxSegments);

      const copyInboxMissing = async (sub: string, srcNames: Set<string>, destNames: Set<string>) => {
        if (!srcNames.size) return;
        await fs.promises.mkdir(path.join(dest, INBOX_DIRNAME, sub), { recursive: true });
        for (const f of srcNames) {
          if (destNames.has(f)) continue;
          const destFile = path.join(dest, INBOX_DIRNAME, sub, f);
          try {
            await commitFileAtomic(destFile, (tmp) => fs.promises.copyFile(path.join(src, INBOX_DIRNAME, sub, f), tmp), { tmpSuffix: `.tmp-${Date.now()}` });
            destNames.add(f);
            result.written++;
          } catch (e: any) {
            if (!result.firstError) result.firstError = e.message;
          }
        }
      };
      // segments first: the loose prune below depends on knowing which segments
      // already landed at dest THIS run.
      await copyInboxMissing('segments', srcInboxSegments, destInboxSegments);
      await copyInboxMissing('new', srcInboxNew, destInboxNew);

      // Copy files missing at dest; presence is proof enough. Everything the mirror
      // carries from the library is write-once — media, screenshots, avatars, inbox
      // segments — so a file that exists at dest can never have a newer version at
      // src. Until #302 this also had to re-copy the organization JSON on size/mtime
      // drift, because that layer was rewritten in place on every edit; it lives in
      // the DB now and reaches the mirror as the snapshot runBackup takes below.
      // The copy is atomic (tmp + rename) so a reader never sees a half-written file.
      if ([...srcSet].some((f) => f.startsWith('avatars/'))) {
        await fs.promises.mkdir(path.join(dest, 'avatars'), { recursive: true });
      }
      // #290: same on-demand mkdir for the shared emoji/ store.
      if ([...srcSet].some((f) => f.startsWith('emoji/'))) {
        await fs.promises.mkdir(path.join(dest, 'emoji'), { recursive: true });
      }
      for (const f of srcSet) {
        if (destSet.has(f)) continue;
        try {
          await commitFileAtomic(
            path.join(dest, f),
            async (tmp) => {
              await fs.promises.copyFile(path.join(src, f), tmp);
              // Preserve mtime (floored to ms, the granularity utimes can set) so a
              // mirror restored back into place keeps the library's own timestamps.
              try {
                const s = srcStat.get(f);
                if (s) {
                  const t = new Date(Math.floor(s.mtimeMs));
                  await fs.promises.utimes(tmp, t, t);
                }
              } catch {
                /* best-effort */
              }
            },
            { tmpSuffix: `.tmp-${Date.now()}` },
          );
          result.written++;
        } catch (e) {
          // Surface the first copy error but keep going for the rest
          if (!result.firstError) result.firstError = e.message;
        }
      }

      // Prune files present in dest but gone from src (deleted posts propagate) —
      // but refuse to mirror a suspicious collapse of src (backup-guard.js).
      // Baseline = the src count from the last run we TRUSTED (carried forward when
      // a run skipped, so one empty/partial blip can't poison the threshold).
      const prevSummary = b.lastResult || {};
      const baseline = Number(prevSummary.lastGoodCount) || Number(prevSummary.fileCount) || 0;
      const decision = pruneDecision({ srcCount: srcSet.size, destCount: destSet.size, baseline });
      if (decision.skip) {
        result.pruneSkipped = decision.reason;
        result.baselineCount = baseline;
      } else {
        for (const f of destSet) {
          if (!srcSet.has(f)) {
            try {
              await fs.promises.unlink(path.join(dest, f));
              result.pruned++;
            } catch {}
          }
        }
      }
      result.lastGoodCount = nextBaseline(decision.skip, srcSet.size, baseline);

      // Inbox loose prune: only once every currently-known src segment is ALSO
      // at dest this run — independent of the general pruneDecision() guard
      // above (which is scoped to srcSet/destSet and never sees inbox entries).
      // Local compaction only deletes a loose file after its segment is
      // verified + renamed + receipted (lib-db-inbox-compact.ts); mirroring
      // that same ordering here means a loose file's mirror copy is never
      // pruned before the segment that supersedes it is safely at dest too —
      // design comment: "only allowed once the verified segment containing the
      // corresponding event has already been copied to the same mirror".
      if ([...srcInboxSegments].every((f) => destInboxSegments.has(f))) {
        for (const f of destInboxNew) {
          if (!srcInboxNew.has(f)) {
            try {
              await fs.promises.unlink(path.join(dest, INBOX_DIRNAME, 'new', f));
              result.pruned++;
            } catch {}
          }
        }
      }

      // DB snapshot (#301): the ONLY sanctioned way to mirror the live
      // hologram.db — #97 forbids a raw file copy of a live .db (see
      // lib-db-snapshot.ts's module comment). Piggybacks the daily
      // reconciliation onto this same run (#301 design: "piggyback
      // integrity_check onto the daily reconciliation"), reusing srcSet this run already
      // enumerated so the orphan/missing scan costs no extra readdir.
      try {
        // ensurePostsSynced (not raw ensureDb) so the DB reflects whatever is
        // actually on disk right now before orphans are computed against it —
        // otherwise a backup firing before the renderer's first listPosts() ever
        // ran could see an empty posts table and flag every file as orphaned.
        const handle = await ensurePostsSynced();
        if (!handle) throw new Error('save folder unavailable');
        await snapshotDatabase(handle.sqlite, dbSnapshotPath(b.dir));
        const pass = runIntegrityPass(src, handle.sqlite, srcSet);
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
    send('backup-done', Object.assign({}, result, { at: at }));
    return result;
  }

  let backupIntervalTimer: any = null;
  function armBackupSchedule() {
    if (backupIntervalTimer) {
      clearInterval(backupIntervalTimer);
      backupIntervalTimer = null;
    }
    const b = readBackupConfig();
    if (!b.dir || !b.interval) return;
    backupIntervalTimer = setInterval(() => {
      const cur = readBackupConfig();
      if (!cur.dir || !cur.interval) return;
      const last = cur.lastRunAt ? Date.parse(cur.lastRunAt) : 0;
      if (Date.now() - last >= backupIntervalMs(cur)) runBackup('interval');
    }, BACKUP_HEARTBEAT_MS);
  }

  return { runBackup, armBackupSchedule, runStartupIntegrityCheck, runOrphanRecovery };
}

export { backupDest, dbSnapshotPath, readBackupConfig, writeBackupConfig, readIntegrityStatus, validateBackupDir, validateSaveFolder, backupIntervalMs, createBackupEngine };
