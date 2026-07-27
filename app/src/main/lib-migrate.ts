'use strict';

// Library relocation engine (save-folder move), extracted from main.js/ipc-transfer.js
// so the whole crash-safe sequence is unit-testable without Electron (same pattern as
// lib-archive/lib-index). The invariant everything here protects: at every instant a
// COMPLETE library exists on disk and config points at one of them — the exact
// invariant whose violation caused the 2026-06-23 library-loss incident.
//
// Sequence (relocateLibrary): copy+catch-up → flip config → verify-then-delete each
// src entry → remove the emptied src shell → (if stragglers remain) one delayed sweep.
//
// Why catch-up rounds: the native host is a Chrome-spawned process that re-reads
// config.json per capture — the app has no channel to pause it. A capture that lands
// in src while the initial copy runs (minutes for large libraries) would otherwise be
// stranded invisibly in the old folder. Re-listing src until no new names appear
// shrinks that window from "whole copy duration" to "in-flight at flip instant";
// those last stragglers are handled by the delayed sweep below.

import fs from 'node:fs';
import path from 'node:path';

// Transient write artifacts (writeSidecarAtomic tmp names). Never copied; a COLD one
// in an abandoned src is garbage from an interrupted write and may be swept.
const TMP_RE = /\.tmp(-\d+)?$/i;

// mtime comparison tolerance: preserveTimestamps carries mtime over, but FAT-family
// filesystems round to 2s granularity, so exact equality would false-mismatch.
const MTIME_TOLERANCE_MS = 2000;

// Upper bound on catch-up rounds. Each round only runs when the previous one found
// new names, so hitting the cap means something writes into src continuously.
const MAX_CATCHUP_ROUNDS = 5;

// A src file younger than this may still be mid-write (media downloads write over
// seconds) — the sweep leaves it for a later manual look rather than tearing it.
const SWEEP_MIN_AGE_MS = 15000;

async function listNonTmp(dir) {
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    names = [];
  }
  return names.filter((f) => !TMP_RE.test(f));
}

// Copy the WHOLE library (sidecars, images, media, internal metadata, .trash)
// from src into dest WITHOUT deleting src, then keep re-listing src and copying
// any names that appeared meanwhile (captures landing mid-copy) until a round
// finds nothing new. Aborts before copying anything if a name already exists at
// dest (never clobbers the user's files there); rolls back partial copies on any
// failure (src untouched). Returns { ok, entries } with entries = every name copied.
// The explicit return type makes `ok` a literal discriminant so `if (!cp.ok) return`
// narrows the success branch (entries defined) at the call site. (A JSDoc @returns
// is NOT authoritative under .mts — TS widens `ok` to boolean and narrowing fails.)
async function copyLibraryInto(src, dest, onProgress): Promise<{ ok: false; error: string; name?: string; detail?: string } | { ok: true; entries: string[] }> {
  let entries = await listNonTmp(src);
  await fs.promises.mkdir(dest, { recursive: true });
  for (const f of entries) {
    if (fs.existsSync(path.join(dest, f))) return { ok: false, error: 'collision', name: f };
  }
  let total = entries.length;
  if (onProgress) onProgress(0, total);
  const copied: string[] = [];
  const copiedSet = new Set();
  try {
    let queue = entries;
    for (let round = 0; queue.length > 0 && round < MAX_CATCHUP_ROUNDS; round++) {
      for (const f of queue) {
        // errorOnExist also guards catch-up names: a collision there means someone
        // put an unrelated same-named file into dest mid-move — abort + roll back
        // rather than guess (same UX as the up-front collision abort).
        await fs.promises.cp(path.join(src, f), path.join(dest, f), { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
        copied.push(f);
        copiedSet.add(f);
        if (onProgress) onProgress(copied.length, total);
      }
      queue = (await listNonTmp(src)).filter((f) => !copiedSet.has(f));
      total += queue.length;
    }
    entries = copied.slice();
  } catch (e) {
    for (const c of copied) {
      try {
        await fs.promises.rm(path.join(dest, c), { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
    return { ok: false, error: 'copy-failed', detail: e && e.message };
  }
  return { ok: true, entries };
}

// Walk one copied entry and prove every file under it exists at dest with the same
// size and (±2s) mtime. One-directional (src ⊆ dest): extra files at dest cost
// nothing; the property that matters is "deleting src loses no bytes".
async function verifyEntry(srcPath, destPath) {
  let st: any;
  try {
    st = await fs.promises.lstat(srcPath);
  } catch {
    return true; // vanished from src (e.g. already gone) — nothing left to lose
  }
  let dt: any;
  try {
    dt = await fs.promises.lstat(destPath);
  } catch {
    return false;
  }
  if (st.isDirectory()) {
    if (!dt.isDirectory()) return false;
    const children = await fs.promises.readdir(srcPath);
    for (const c of children) {
      if (!(await verifyEntry(path.join(srcPath, c), path.join(destPath, c)))) return false;
    }
    return true;
  }
  return st.size === dt.size && Math.abs(st.mtimeMs - dt.mtimeMs) <= MTIME_TOLERANCE_MS;
}

// Post-flip cleanup: for each copied entry, verify it at dest and only then delete
// it from src ("整合チェック" — never remove what isn't proven to exist elsewhere).
// A mismatch means src changed after its copy (org-JSON edit mid-move) or the copy
// is bad — re-copy with force (dest content is our own copy, so overwriting it
// converges to the newest src state, never clobbers user data) and re-verify; if it
// still fails, the entry stays in src and is reported. Derived, rebuildable files
// (.index.json) are exempt from verification — a stale copy self-heals at the next
// reconcile and can never represent data loss.
async function verifyAndCleanup(src, dest, entries) {
  let removed = 0;
  for (const f of entries) {
    const s = path.join(src, f);
    const d = path.join(dest, f);
    let ok = f === '.index.json' || (await verifyEntry(s, d));
    if (!ok) {
      try {
        await fs.promises.cp(s, d, { recursive: true, force: true, preserveTimestamps: true });
        ok = await verifyEntry(s, d);
      } catch {
        ok = false;
      }
    }
    if (!ok) continue;
    try {
      await fs.promises.rm(s, { recursive: true, force: true });
      removed++;
    } catch {
      /* locked (AV scan etc.) — stays as a leftover, swept later */
    }
  }
  // Anything still in src: failed verification, failed rm, or landed after the last
  // catch-up round (a capture in flight at the flip instant).
  const leftover = await listNonTmp(src);
  let emptied = false;
  if (leftover.length === 0) {
    try {
      // Non-recursive rmdir IS the safety valve: it only succeeds on a truly empty
      // folder, so a straggler racing in (or a hot tmp) keeps the shell alive.
      await fs.promises.rmdir(src);
      emptied = true;
    } catch {
      /* tmp files or a racing write keep it — the sweep retries */
    }
  }
  return { removed, leftover, emptied };
}

// Delayed straggler sweep: move whatever completed writing into the abandoned src
// after the flip (captures in flight during the move). Only COLD files (mtime older
// than minAgeMs) are touched — a hot file may still be mid-download and copying or
// deleting it would tear it. Cold tmp files are interrupted-write garbage: deleted.
// Returns { moved, left, emptied }.
async function sweepStragglers(src, dest, opts) {
  const minAgeMs = opts && typeof opts.minAgeMs === 'number' ? opts.minAgeMs : SWEEP_MIN_AGE_MS;
  const now = Date.now();
  let names: string[];
  try {
    names = await fs.promises.readdir(src);
  } catch {
    return { moved: 0, left: 0, emptied: true }; // src already gone
  }
  let moved = 0;
  let left = 0;
  for (const f of names) {
    const s = path.join(src, f);
    let st: any;
    try {
      st = await fs.promises.lstat(s);
    } catch {
      continue;
    }
    if (now - st.mtimeMs < minAgeMs) {
      left++;
      continue;
    }
    if (TMP_RE.test(f)) {
      try {
        await fs.promises.rm(s, { recursive: true, force: true });
      } catch {
        left++;
      }
      continue;
    }
    const d = path.join(dest, f);
    try {
      try {
        await fs.promises.cp(s, d, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
      } catch (e) {
        // Already at dest (earlier rm failure): if it verifies, deleting src is safe.
        // A same-named DIFFERENT file is ambiguous — leave it, never clobber.
        if (!(e && e.code === 'ERR_FS_CP_EEXIST') || !(await verifyEntry(s, d))) {
          left++;
          continue;
        }
      }
      if (await verifyEntry(s, d)) {
        await fs.promises.rm(s, { recursive: true, force: true });
        moved++;
      } else {
        left++;
      }
    } catch {
      left++;
    }
  }
  let emptied = false;
  if (left === 0) {
    try {
      await fs.promises.rmdir(src);
      emptied = true;
    } catch {
      /* raced — harmless */
    }
  }
  return { moved, left, emptied };
}

// Full relocation orchestration (everything after the folder dialog + validation).
// deps: readConfig/writeConfig (config flip), emit (save-folder-progress payloads),
// afterFlip (re-point watcher + reset delta), stillCurrent (sweep-time guard: the
// config still points at dest — a second move meanwhile makes the sweep stale),
// sweepDelayMs (test hook; default 60s).
async function relocateLibrary(src, dest, deps) {
  const { readConfig, writeConfig, emit, afterFlip, stillCurrent } = deps;
  const sweepDelayMs = typeof deps.sweepDelayMs === 'number' ? deps.sweepDelayMs : 60000;

  // 1) Copy the whole library into dest (+catch-up rounds). src stays fully intact.
  //    Throttle copy progress to ~100ms so an 18k-file move doesn't flood IPC.
  let lastEmit = 0;
  const cp = await copyLibraryInto(src, dest, (done, total) => {
    const now = Date.now();
    if (done === 0 || done === total || now - lastEmit >= 100) {
      lastEmit = now;
      emit({ phase: 'copy', done, total, percent: total ? Math.floor((done / total) * 100) : 100 });
    }
  });
  if (!cp.ok) {
    emit({ phase: 'error', error: cp.error });
    return { ok: false, error: cp.error, name: cp.name };
  }

  // 2) Flip config to dest — dest is now authoritative AND complete.
  emit({ phase: 'switch' });
  const cfg = readConfig();
  cfg.saveFolder = dest;
  writeConfig(cfg);

  // 3) Verify each copied entry at dest, delete it from src only on proof, then
  //    drop the emptied shell folder. From here on, every app write path reads the
  //    flipped config, so src can only GAIN files (native-host captures in flight).
  emit({ phase: 'cleanup' });
  const cl = await verifyAndCleanup(src, dest, cp.entries);

  afterFlip();

  emit({ phase: 'done', moved: cp.entries.length, leftover: cl.leftover.length });

  // 4) In-flight captures finish writing into src seconds after the flip (the host
  //    read the old config before it). One delayed sweep collects them once cold.
  if (!cl.emptied) {
    setTimeout(() => {
      if (!stillCurrent()) return;
      sweepStragglers(src, dest, {})
        .then((sw) => {
          if (sw.moved > 0) emit({ phase: 'straggler', moved: sw.moved, left: sw.left });
        })
        .catch(() => {});
    }, sweepDelayMs);
  }

  return { ok: true, saveFolder: dest, moved: cp.entries.length, leftover: cl.leftover.length };
}

export { copyLibraryInto, verifyAndCleanup, sweepStragglers, relocateLibrary };
