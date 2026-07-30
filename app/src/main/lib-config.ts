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

export { readConfig, writeConfig, getSaveFolder, readSavePointer, initSaveFolderRedundancy, isConfigCorrupt, invalidateConfigCache };
