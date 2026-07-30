'use strict';

// The containment rule for every library filename: what a name coming from a
// record, an `asset://` URL or an IPC argument is allowed to resolve to inside
// the save folder.
//
// Three shapes are accepted, and they are ENUMERATED rather than generalized to
// "any subdirectory" — a subfolder joins this list by being written into it:
//
//   <file>          captures and downloaded media, which live flat in the folder
//   avatars/<file>  the shared avatar store (one file per avatar URL)
//   .trash/<file>   the soft-delete holding area (#267 — the trash view draws the
//                   library's own cards, so its files have to be servable too)
//
// Anything else — a deeper path, an unknown subfolder, an absolute path — is
// squashed to its basename, so it can still only name something in the folder's
// own root. Note what that means for an attempt to climb out: `.trash/../..` is
// not "a trash file called ..", it is squashed to `..`, and the containment check
// below then rejects it. The check runs on the RESOLVED path rather than on the
// input, so it does not depend on having anticipated the spelling.
//
// Electron-free so the rule unit-tests in plain node (scripts/save-folder-path.test.ts)
// and so every caller shares ONE copy: main's asset:// handler, the inbox drain,
// the integrity scan and the trash sweep used to hold two hand-kept-identical
// ones, which is exactly the shape a widened allow-list splits apart (#267).

import path from 'node:path';

/** Shared avatar store — one file per avatar URL, referenced by every capture of that author. */
export const AVATAR_SUBDIR = 'avatars';
/** Soft-delete holding area. `getTrashDir()` must name this one — hence the shared constant. */
export const TRASH_SUBDIR = '.trash';

const ALLOWED_SUBDIRS: readonly string[] = [AVATAR_SUBDIR, TRASH_SUBDIR];

/**
 * Resolve `name` to an absolute path strictly inside `saveFolder`, or null if it
 * would land anywhere else. See the module comment for the three accepted shapes.
 */
export function resolveInSaveFolder(saveFolder: string | null | undefined, name: string | null | undefined): string | null {
  if (!saveFolder || !name) return null;
  const root = path.resolve(saveFolder);
  const rel = String(name).replace(/\\/g, '/');
  // A two-segment name is taken at face value only for a sanctioned subfolder
  // whose child is a real basename: '.' and '..' are names path.join walks, so
  // they never count as one.
  const m = /^([^/]+)\/([^/]+)$/.exec(rel);
  const sub = m && ALLOWED_SUBDIRS.includes(m[1]) && m[2] !== '.' && m[2] !== '..' ? { dir: m[1], child: m[2] } : null;
  const parent = sub ? path.resolve(root, sub.dir) : root;
  const resolved = sub ? path.resolve(parent, sub.child) : path.resolve(root, path.basename(rel));
  if (!resolved.startsWith(root + path.sep)) return null;
  // Directly under the directory the name asked for — not merely somewhere below
  // the save folder. Without this a future edit to the branches above could hand
  // back a nested path and still pass the containment check.
  return path.dirname(resolved) === parent ? resolved : null;
}
