'use strict';

// Save-folder recovery + destructive-op gating (added after the 2026-06-23
// library-loss incident). config.json holding the only copy of saveFolder meant a
// single truncation could silently drop the library to the empty default. We keep a
// REDUNDANT pointer file next to config and resolve through it before defaulting.
// The decisions are pure functions so they can be unit-tested without Electron.

// Resolve which save folder to use.
//   configSaveFolder — saveFolder read from config.json (may be missing/empty)
//   pointer          — path read from the redundant saveFolder.path file (or null)
//   pointerExists     — whether `pointer` resolves to a real directory on disk
//   defaultDir        — the shared default library dir (last resort)
// Returns { folder, source } where source is 'config' | 'pointer' | 'default'.
function resolveSaveFolder({ configSaveFolder, pointer, pointerExists, defaultDir }) {
  if (typeof configSaveFolder === 'string' && configSaveFolder.trim()) {
    return { folder: configSaveFolder, source: 'config' };
  }
  if (pointer && typeof pointer === 'string' && pointer.trim() && pointerExists) {
    return { folder: pointer, source: 'pointer' }; // config lost it → recover
  }
  return { folder: defaultDir, source: 'default' };
}

// Whether a destructive "delete everything" must be refused because we may be
// pointed at a recovered/default folder rather than the one the user chose.
//   configCorrupt          — config.json existed but failed to parse this read
//   hasExplicitSaveFolder  — config currently carries a non-empty saveFolder
//   hasPointer             — the redundant pointer file exists (a folder was chosen before)
// Returns 'corrupt' | 'lost' | null (null = allowed).
function clearAllBlockReason({ configCorrupt, hasExplicitSaveFolder, hasPointer }) {
  if (configCorrupt) return 'corrupt';
  // No explicit folder but a pointer proves one existed → config dropped it.
  if (!hasExplicitSaveFolder && hasPointer) return 'lost';
  return null; // fresh install (no folder, no pointer) or a healthy explicit folder
}

module.exports = { resolveSaveFolder, clearAllBlockReason };
