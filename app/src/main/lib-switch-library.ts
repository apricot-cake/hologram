'use strict';

// #176: what a candidate folder looks like BEFORE anything touches it — the
// judge that decides which of switchLibrary's four branches applies. Kept
// Electron-free (same reasoning as lib-migrate.ts) so it is unit-testable
// without spinning up the app.
//
// This generalizes #37's looksLikeLibrary (ipc-transfer.ts), which only ever
// had two answers (evidence found / none) because the database used to live
// outside the folder regardless of what saveFolder pointed at. Since #176 the
// database moved INSIDE the library folder, so "does this folder have a
// database" is now itself a branch, not folded into "evidence".

import fs from 'node:fs';
import path from 'node:path';

import { TRASH_SUBDIR } from './lib-save-folder-path.ts';
import { INBOX_DIRNAME } from '../../../native-host/inbox.mts';
import { IMPORTABLE_MEDIA } from '../../../native-host/importable-media.mts';

/** The live database's filename — #176: the database itself is the library's mark. */
export const DB_FILENAME = 'hologram.db';

export type LibraryClassification = 'has-db' | 'empty' | 'evidence-no-db' | 'reject';

/**
 * Reads `dir` (never writes) and sorts it into one of four buckets:
 *   'has-db'         — hologram.db is right here: open it as-is.
 *   'evidence-no-db' — a .trash/.hologram-inbox subfolder, or a library media
 *                       file directly inside — but no database. Recoverable
 *                       (a mirror snapshot restore + inbox replay, both
 *                       existing paths — see switchLibrary), not a fresh start.
 *   'empty'          — nothing here but dotfiles (or the folder doesn't exist
 *                       yet — it will be created on open). A legitimate new
 *                       library, pending the user's confirmation.
 *   'reject'         — non-empty, no sign of ever being a Hologram library.
 *                       Never opened — the caller must refuse outright rather
 *                       than start writing into someone's unrelated folder.
 */
export function classifyLibraryFolder(dir: string): LibraryClassification {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 'empty'; // does not exist (or is unreadable) — mkdir happens on open
  }
  if (names.includes(DB_FILENAME)) return 'has-db';
  if (names.includes(TRASH_SUBDIR) || names.includes(INBOX_DIRNAME)) return 'evidence-no-db';
  const mediaRe = new RegExp('\\.(' + IMPORTABLE_MEDIA.join('|') + ')$', 'i');
  if (names.some((f) => mediaRe.test(f))) return 'evidence-no-db';
  const nonDot = names.filter((f) => !f.startsWith('.'));
  if (nonDot.length === 0) return 'empty';
  return 'reject';
}

export function dbFileIn(dir: string): string {
  return path.join(dir, DB_FILENAME);
}
