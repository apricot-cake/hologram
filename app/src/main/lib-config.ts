'use strict';

// config.json and the save folder it points at (#227) — index.ts's `// --- Config ---`
// block, moved out whole. Everything that reads or writes the ONE file whose loss
// loses the library lives here, so the atomic-write discipline and the redundant
// save-folder pointer are one unit rather than a convention spread across callers.
//
// Deliberately NOT the home of the organization state: that is the DB (#5). This
// is machine-local settings (save folder, extension id, backup/integrity status,
// window bounds, prefs) plus the recovery path for when the file is truncated.

import fs from 'node:fs';
import path from 'node:path';

import { parseJsonLoose } from './lib-json.ts';
import { writeFileAtomicSync } from './lib-atomic.ts';
import { configDir, defaultLibraryDir, resolveSaveFolder } from './native-host.ts';

const CONFIG_PATH = path.join(configDir(), 'config.json');

// --- In-memory cache (#61) ---
//
// getSaveFolder() sits on the asset:// path, so before this every image the grid
// asked for re-opened and re-parsed config.json. Opening the file is what costs:
// measured on this machine, readFileSync+parse of a ~900B config.json is ~230µs,
// a statSync of the same file ~6µs.
//
// The cache is CHECKED AGAINST THE FILE on every read rather than only being
// dropped by our own writes. That is deliberate, and it is the safety property
// of this module rather than a nicety:
//   - config.json is documented as hand-editable (native-host/README.md) and the
//     installer CLI (native-host/install.cts persistExtensionId) writes into it
//     from a SEPARATE process, so "every writer is in this process" is false.
//   - every writer here is read-modify-write, so a stale read does not just
//     return an old value — the next writeConfig persists it back and silently
//     ERASES the outside edit. Losing saveFolder that way is the 2026-06-23
//     incident's failure mode, which is why a hook-only invalidation scheme
//     (one missed hook = a wiped setting) is not good enough here.
//
// The check is one statSync fingerprinted on (size, mtime, ino). Known limit:
// NTFS stamps mtime at the ~15ms system-clock tick, so an out-of-process,
// in-place rewrite of EXACTLY the same byte length landing inside the same tick
// as our own write is indistinguishable from it. Anything that renames into
// place — our writeFileAtomicSync, and every editor that saves atomically —
// lands a new ino and is always caught.
interface ConfigCacheEntry {
  /** Identity of the bytes `data` was parsed from; null = file absent. */
  fp: string | null;
  data: Record<string, any>;
  corrupt: boolean;
}
let cached: ConfigCacheEntry | null = null;

// null = no such file (a fresh install — absence is a valid state to cache).
// undefined = the stat itself failed, so nothing about the file is known and the
// cache must not be trusted or refreshed from this pass.
function statFingerprint(): string | null | undefined {
  try {
    const st = fs.statSync(CONFIG_PATH, { bigint: true, throwIfNoEntry: false });
    return st ? `${st.size}:${st.mtimeNs}:${st.ino}` : null;
  } catch {
    return undefined;
  }
}

function readConfigFromDisk(): Omit<ConfigCacheEntry, 'fp'> {
  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch {
    return { data: {}, corrupt: false }; // no config yet (fresh install) — absence is not corruption
  }
  try {
    return { data: parseJsonLoose(raw), corrupt: false };
  } catch {
    // Corrupt config (e.g. a truncation from a pre-atomic-write forced kill).
    // PRESERVE it instead of letting the caller silently overwrite it with {} —
    // a truncated config that reads as {} and is then re-written loses
    // saveFolder/extensionId/backup at once. Keep a copy for recovery/forensics.
    // Caching the outcome also means ONE copy per corruption rather than one per
    // read, which used to litter the config dir while the app stayed open.
    try {
      if (raw && raw.length) fs.copyFileSync(CONFIG_PATH, `${CONFIG_PATH}.corrupt-${Date.now()}`);
    } catch {
      /* best-effort */
    }
    return { data: {}, corrupt: true };
  }
}

// The SHARED entry — never handed to a caller (readConfig clones). Internal
// readers that only take an immutable scalar out of it use this directly.
function loadConfig(): ConfigCacheEntry {
  const before = statFingerprint();
  if (cached && before !== undefined && cached.fp === before) return cached;
  const fresh = readConfigFromDisk();
  const after = statFingerprint();
  // Store the fingerprint only when the file held still ACROSS the read: if it
  // changed under us, `after` describes bytes we did not parse, and pinning them
  // to this parse would serve the stale copy until the file changed AGAIN.
  cached = before !== undefined && after === before ? { ...fresh, fp: after } : null;
  return cached ?? { ...fresh, fp: null };
}

/** True iff config.json is present but unparseable, as of right now. */
function isConfigCorrupt() {
  return loadConfig().corrupt;
}

/**
 * config.json, as a private copy: callers read-modify-write it, and a mutation
 * they never hand back to writeConfig (or one whose write throws) must not be
 * visible to the next reader.
 */
function readConfig() {
  return structuredClone(loadConfig().data);
}

/**
 * Force the next read to go back to the file. For the one in-process writer that
 * does NOT come through writeConfig: native-host's installer persists
 * extensionId into config.json itself (install.cts persistExtensionId).
 */
function invalidateConfigCache() {
  cached = null;
}

// Redundant save-folder pointer: a tiny file written ALONGSIDE config.json holding
// just the save-folder path. config.json carrying the only copy of saveFolder is
// what let one truncation drop the library to the empty default; this independent
// file survives that and lets getSaveFolder() recover instead of silently switching.
const SAVE_POINTER_PATH = () => path.join(configDir(), 'saveFolder.path');
function writeSavePointer(folder) {
  if (typeof folder !== 'string' || !folder.trim()) return;
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    writeFileAtomicSync(SAVE_POINTER_PATH(), folder); // atomic, independent of config.json
  } catch {
    /* best-effort redundancy */
  }
}
function readSavePointer() {
  try {
    const p = fs.readFileSync(SAVE_POINTER_PATH(), 'utf8').trim();
    return p || null;
  } catch {
    return null;
  }
}
function dirExists(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// --- Per-library settings (#176) ---
//
// config.libraries[] is the "recent libraries" list AND the home for settings
// that belong to one library rather than to this machine as a whole (backup
// destination, integrity status). Keyed primarily by path (normalized —
// case-insensitive on Windows) because that is what callers have in hand
// BEFORE a database is open (a backup destination must be readable without
// opening the DB it might be restoring); `libraryId` (the DB's own identity,
// lib-db-write.ts's ensureLibraryId) is a secondary key that repairs an entry
// when the folder itself moved or was repointed — see recordLibraryOpened.
const MAX_LIBRARIES = 5;
const BACKUP_DEFAULTS = {
  dir: null, // Output destination (must not overlap with the save folder, inside or out)
  interval: false, // fixed interval
  intervalValue: 1, // interval count
  intervalUnit: 'day', // 'day' | 'week' | 'month'
  lastRunAt: null,
  lastResult: null,
};
const INTEGRITY_DEFAULTS = {
  lastCheckAt: null,
  dbOk: null, // null = never checked yet
  orphanCount: 0,
  missingCount: 0,
};

function normLibPath(p: unknown): string {
  if (typeof p !== 'string' || !p) return '';
  const r = path.resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

// One-time, pre-release migration: an install that predates #176 has a flat
// `backup`/`integrity` on config and no `libraries` array. Fold both into ONE
// libraries[] entry for the current save folder so every reader below can
// assume the array shape unconditionally — no read site keeps a fallback for
// the old flat keys. Delete this once no installed copy predates #176 (project
// convention: a one-time migration is a work step, not part of the design).
function migrateToLibraries() {
  const cfg = readConfig();
  if (Array.isArray(cfg.libraries)) return;
  const folder = typeof cfg.saveFolder === 'string' && cfg.saveFolder.trim() ? cfg.saveFolder : null;
  const next = Object.assign({}, cfg);
  next.libraries = folder ? [{ path: folder, libraryId: null, lastOpenedAt: new Date().toISOString(), backup: cfg.backup || null, integrity: cfg.integrity || null }] : [];
  delete next.backup;
  delete next.integrity;
  writeConfig(next);
}

function librariesOf(cfg: Record<string, any>): any[] {
  return Array.isArray(cfg.libraries) ? cfg.libraries : [];
}
function findLibraryIndex(libraries: any[], folder: string): number {
  const key = normLibPath(folder);
  if (!key) return -1;
  return libraries.findIndex((e) => e && normLibPath(e.path) === key);
}

/**
 * Records that `folder` (with `libraryId` from its just-opened DB, or null
 * before one has been read) was opened just now: moves/creates its entry at
 * the front of the list, caps at MAX_LIBRARIES (oldest dropped). A path miss
 * that still matches an existing `libraryId` means the folder moved or was
 * repointed onto the same library — that entry is repaired in place (its old
 * path replaced) rather than left behind as a stale duplicate.
 */
function recordLibraryOpened(folder: string, libraryId: string | null) {
  const cfg = readConfig();
  const libraries = librariesOf(cfg).slice();
  let idx = findLibraryIndex(libraries, folder);
  if (idx === -1 && libraryId) idx = libraries.findIndex((e) => e && e.libraryId && e.libraryId === libraryId);
  const prev = idx >= 0 ? libraries[idx] : null;
  const entry = Object.assign({}, prev, { path: folder, libraryId: libraryId || (prev && prev.libraryId) || null, lastOpenedAt: new Date().toISOString() });
  const rest = idx >= 0 ? libraries.filter((_, i) => i !== idx) : libraries;
  cfg.libraries = [entry, ...rest].slice(0, MAX_LIBRARIES);
  writeConfig(cfg);
}

/** The "recent libraries" list for the UI — newest first, with a live exists() check. */
function listRecentLibraries(): Array<{ path: string; lastOpenedAt: string | null; exists: boolean }> {
  return librariesOf(readConfig())
    .slice()
    .sort((a, b) => Date.parse((b && b.lastOpenedAt) || 0) - Date.parse((a && a.lastOpenedAt) || 0))
    .filter((e) => e && typeof e.path === 'string')
    .map((e) => ({ path: e.path, lastOpenedAt: e.lastOpenedAt || null, exists: dirExists(e.path) }));
}

/** Drops one entry from the recent list (a dead path the user asked to forget). */
function removeRecentLibrary(folder: string) {
  const cfg = readConfig();
  const key = normLibPath(folder);
  cfg.libraries = librariesOf(cfg).filter((e) => !e || normLibPath(e.path) !== key);
  writeConfig(cfg);
}

// The current library's backup/integrity settings — same no-argument call
// shape lib-backup.ts already used against a single flat config key, now
// resolved through the libraries[] entry for getSaveFolder() instead. A
// library with no entry yet (never opened through recordLibraryOpened) reads
// as the defaults; a WRITE creates its entry on demand.
function readLibraryBackupConfig() {
  const libraries = librariesOf(readConfig());
  const idx = findLibraryIndex(libraries, getSaveFolder());
  return Object.assign({}, BACKUP_DEFAULTS, (idx >= 0 && libraries[idx].backup) || {});
}
function writeLibraryBackupConfig(patch: Record<string, any> | null | undefined) {
  const cfg = readConfig();
  const libraries = librariesOf(cfg).slice();
  const folder = getSaveFolder();
  let idx = findLibraryIndex(libraries, folder);
  if (idx === -1) {
    libraries.push({ path: folder, libraryId: null, lastOpenedAt: new Date().toISOString() });
    idx = libraries.length - 1;
  }
  const merged = Object.assign({}, BACKUP_DEFAULTS, libraries[idx].backup || {}, patch || {});
  libraries[idx] = Object.assign({}, libraries[idx], { backup: merged });
  cfg.libraries = libraries;
  writeConfig(cfg);
  return merged;
}
function readLibraryIntegrityStatus() {
  const libraries = librariesOf(readConfig());
  const idx = findLibraryIndex(libraries, getSaveFolder());
  return Object.assign({}, INTEGRITY_DEFAULTS, (idx >= 0 && libraries[idx].integrity) || {});
}
function writeLibraryIntegrityStatus(patch: Record<string, any> | null | undefined) {
  const cfg = readConfig();
  const libraries = librariesOf(cfg).slice();
  const folder = getSaveFolder();
  let idx = findLibraryIndex(libraries, folder);
  if (idx === -1) {
    libraries.push({ path: folder, libraryId: null, lastOpenedAt: new Date().toISOString() });
    idx = libraries.length - 1;
  }
  const merged = Object.assign({}, INTEGRITY_DEFAULTS, libraries[idx].integrity || {}, patch || {});
  libraries[idx] = Object.assign({}, libraries[idx], { integrity: merged });
  cfg.libraries = libraries;
  writeConfig(cfg);
  return merged;
}

// Atomic write: a forced kill or crash mid-write must NEVER leave a truncated
// config.json. Write to a tmp file, fsync, then rename over the target — readers
// only ever see the complete old or complete new file. (Non-atomic writeFileSync
// truncated config.json on a forced kill → readConfig() returned {} → the next
// write persisted {} → saveFolder/extensionId/backup were lost at once. That
// cascade is what made a library "disappear".) The one caller that asks
// lib-atomic.ts for the fsync, because this is the file whose loss loses the
// save folder itself.
function writeConfig(cfg) {
  fs.mkdirSync(configDir(), { recursive: true });
  const json = JSON.stringify(cfg, null, 2);
  writeFileAtomicSync(CONFIG_PATH, json, { fsync: true });
  // Prime the cache from the bytes that just landed — JSON.parse(json) rather
  // than `cfg` itself, so the cache holds what the FILE holds (the round trip
  // drops undefined members) and the caller may keep mutating its own object.
  // A throw above skips this: a write that failed must leave readConfig()
  // agreeing with the disk, not reporting a value that never got there.
  const fp = statFingerprint();
  cached = typeof fp === 'string' ? { fp, data: JSON.parse(json), corrupt: false } : null;
  // Keep the redundant pointer in lockstep with whatever save folder we just wrote.
  if (cfg && typeof cfg.saveFolder === 'string' && cfg.saveFolder.trim()) writeSavePointer(cfg.saveFolder);
}

// Explicit config wins; otherwise recover from the redundant pointer before falling
// back to the shared default library dir (same resolution as the bridge's
// readSaveFolder). Never returns null — a fresh install uses defaultLibraryDir().
// The pointer is only consulted when config has no saveFolder (degraded/fresh), so
// the common path stays a single config read with no extra file I/O.
function getSaveFolder() {
  // The shared entry, not readConfig(): this is the hottest config read in the
  // app (one per asset:// request) and it only takes a string out.
  const folder = loadConfig().data.saveFolder;
  if (typeof folder === 'string' && folder.trim()) return folder;
  const ptr = readSavePointer();
  return resolveSaveFolder({
    configSaveFolder: folder,
    pointer: ptr,
    pointerExists: ptr ? dirExists(ptr) : false,
    defaultDir: defaultLibraryDir(),
  }).folder;
}

// #37: whether the CURRENT save folder is missing on disk right now — i.e. an
// explicit config.saveFolder that no longer resolves to a real directory
// (moved/renamed/unmounted from outside the app). Never true for a fresh
// install (no explicit folder): that case resolves through the pointer/default
// and the default dir is created on demand, not "missing".
//
// Deliberately a fresh stat on every call rather than a cached flag: the check
// is one statSync (dirExists), cheap enough to run wherever a write handler or
// the renderer's status IPC needs the CURRENT answer, and a cached flag would
// need its own invalidation story (repoint, retry, drive remount) for no real
// savings.
function saveFolderStatus() {
  const explicit = loadConfig().data.saveFolder;
  const hasExplicit = typeof explicit === 'string' && !!explicit.trim();
  const folder = getSaveFolder();
  return { folder, missing: hasExplicit && !dirExists(folder) };
}

// Once at startup: keep the redundant pointer fresh for an existing install, and —
// if config LOST its saveFolder (corruption) but the pointer still resolves to a
// real library — write it back into config so the value is durable and the native
// host (which reads config independently) stays in sync rather than diverging.
function initSaveFolderRedundancy() {
  const cfg = readConfig();
  if (typeof cfg.saveFolder === 'string' && cfg.saveFolder.trim()) {
    writeSavePointer(cfg.saveFolder);
    return;
  }
  const ptr = readSavePointer();
  if (ptr && dirExists(ptr)) {
    try {
      writeConfig(Object.assign({}, cfg, { saveFolder: ptr }));
    } catch {
      /* best-effort recovery */
    }
  }
}

export {
  readConfig,
  writeConfig,
  getSaveFolder,
  readSavePointer,
  initSaveFolderRedundancy,
  isConfigCorrupt,
  invalidateConfigCache,
  saveFolderStatus,
  migrateToLibraries,
  recordLibraryOpened,
  listRecentLibraries,
  removeRecentLibrary,
  readLibraryBackupConfig,
  writeLibraryBackupConfig,
  readLibraryIntegrityStatus,
  writeLibraryIntegrityStatus,
};
