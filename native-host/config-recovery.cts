'use strict';

// Save-folder recovery + destructive-op gating (added after the 2026-06-23
// library-loss incident). config.json holding the only copy of saveFolder meant a
// single truncation could silently drop the library to the empty default. We keep a
// REDUNDANT pointer file next to config and resolve through it before defaulting.
// The decisions are pure functions so they can be unit-tested without Electron.

interface ResolveSaveFolderArgs {
  configSaveFolder: string | null | undefined;
  pointer: string | null | undefined;
  pointerExists: boolean;
  defaultDir: string;
}
interface ResolveSaveFolderResult {
  folder: string;
  source: 'config' | 'pointer' | 'default';
}

// Resolve which save folder to use.
//   configSaveFolder — saveFolder read from config.json (may be missing/empty)
//   pointer          — path read from the redundant saveFolder.path file (or null)
//   pointerExists     — whether `pointer` resolves to a real directory on disk
//   defaultDir        — the shared default library dir (last resort)
function resolveSaveFolder({ configSaveFolder, pointer, pointerExists, defaultDir }: ResolveSaveFolderArgs): ResolveSaveFolderResult {
  if (typeof configSaveFolder === 'string' && configSaveFolder.trim()) {
    return { folder: configSaveFolder, source: 'config' };
  }
  if (pointer && typeof pointer === 'string' && pointer.trim() && pointerExists) {
    return { folder: pointer, source: 'pointer' }; // config lost it → recover
  }
  return { folder: defaultDir, source: 'default' };
}

interface ClearAllBlockReasonArgs {
  configCorrupt: boolean;
  hasExplicitSaveFolder: boolean;
  hasPointer: boolean;
  // #37: an explicit saveFolder that does not resolve to a real directory right
  // now (moved/renamed/unmounted from OUTSIDE the app). Distinct from `lost`:
  // config still HAS the value, it just does not exist on disk — see libraryIsMissing.
  libraryMissing: boolean;
}

// Whether a destructive "delete everything" must be refused because we may be
// pointed at a recovered/default folder rather than the one the user chose.
//   configCorrupt          — config.json existed but failed to parse this read
//   hasExplicitSaveFolder  — config currently carries a non-empty saveFolder
//   hasPointer             — the redundant pointer file exists (a folder was chosen before)
//   libraryMissing         — see libraryIsMissing below
function clearAllBlockReason({ configCorrupt, hasExplicitSaveFolder, hasPointer, libraryMissing }: ClearAllBlockReasonArgs): 'corrupt' | 'missing' | 'lost' | null {
  if (configCorrupt) return 'corrupt';
  // The configured folder itself is gone: never wipe (and never lazily
  // recreate it) while we cannot see what is actually there (#37).
  if (libraryMissing) return 'missing';
  // No explicit folder but a pointer proves one existed → config dropped it.
  if (!hasExplicitSaveFolder && hasPointer) return 'lost';
  return null; // fresh install (no folder, no pointer) or a healthy explicit folder
}

interface LibraryIsMissingArgs {
  hasExplicitSaveFolder: boolean;
  folderExists: boolean;
}

// #37: the save folder went away from OUTSIDE the app (moved, renamed, drive
// unplugged) while config.json still names it explicitly. Deliberately narrow —
// only fires for an EXPLICIT saveFolder: a fresh install (no explicit folder,
// resolving through the default dir) is never "missing", it just has not
// captured anything yet, and the default dir is created on demand.
function libraryIsMissing({ hasExplicitSaveFolder, folderExists }: LibraryIsMissingArgs): boolean {
  return hasExplicitSaveFolder && !folderExists;
}

module.exports = { resolveSaveFolder, clearAllBlockReason, libraryIsMissing };
