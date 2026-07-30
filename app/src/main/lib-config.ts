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

// True iff the LAST readConfig() found config.json present-but-unparseable. Lets
// destructive ops (clear-all) refuse to run on top of a degraded config.
let configLastCorrupt = false;

/** True iff the LAST readConfig() found config.json present-but-unparseable. */
function isConfigCorrupt() {
  return configLastCorrupt;
}

function readConfig() {
  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch {
    configLastCorrupt = false;
    return {}; // no config yet (fresh install) — absence is not corruption
  }
  try {
    const cfg = parseJsonLoose(raw);
    configLastCorrupt = false;
    return cfg;
  } catch {
    // Corrupt config (e.g. a truncation from a pre-atomic-write forced kill).
    // PRESERVE it instead of letting the caller silently overwrite it with {} —
    // a truncated config that reads as {} and is then re-written loses
    // saveFolder/extensionId/backup at once. Keep a copy for recovery/forensics.
    configLastCorrupt = true;
    try {
      if (raw && raw.length) fs.copyFileSync(CONFIG_PATH, `${CONFIG_PATH}.corrupt-${Date.now()}`);
    } catch {
      /* best-effort */
    }
    return {};
  }
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
  writeFileAtomicSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { fsync: true });
  // Keep the redundant pointer in lockstep with whatever save folder we just wrote.
  if (cfg && typeof cfg.saveFolder === 'string' && cfg.saveFolder.trim()) writeSavePointer(cfg.saveFolder);
}

// Explicit config wins; otherwise recover from the redundant pointer before falling
// back to the shared default library dir (same resolution as the bridge's
// readSaveFolder). Never returns null — a fresh install uses defaultLibraryDir().
// The pointer is only consulted when config has no saveFolder (degraded/fresh), so
// the common path stays a single config read with no extra file I/O.
function getSaveFolder() {
  const folder = readConfig().saveFolder;
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

export { readConfig, writeConfig, getSaveFolder, readSavePointer, initSaveFolderRedundancy, isConfigCorrupt };
