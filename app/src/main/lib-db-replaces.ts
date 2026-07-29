'use strict';

// The consumer of the `replaces` marker (#34): a record that says "I replace
// capture X" is turned into the replacement actually happening — X's tags,
// folder and manual-group memberships and preserved originals move to the new
// record, X's files go to .trash/, X's row is dropped, and the marker is
// cleared.
//
// Why the marker exists at all: the extension saves through the native host,
// which is write-once — it never modifies or deletes a file, so that a capture
// made while the desktop app is closed can never damage the library. Deleting
// is therefore the app's privilege alone, and "replace" has to cross the gap as
// data rather than as an action. Between the save and the next time the app
// runs, the two records simply coexist, which is exactly the state the library
// would be in if the user had answered "copy".
//
// Idempotent by construction, which is what makes it safe to run on every
// posts-changed: the marker is cleared in the same transaction that drops the
// old row, and a marker naming a captureId this database does not have (already
// swept, or an inbox replay carrying a marker from another machine) clears
// without touching anything.
//
// NOT re-pointed, deliberately: ungrouped_keys is keyed by postKey — the
// url-derived grouping key — and a replacement keeps the post's URL, so the key
// is already the same one. Re-pointing it would mean rewriting a row to itself.
//
// Electron-free (better-sqlite3 + node builtins only) so it unit-tests in plain
// node, mirroring lib-db-inbox.ts.

import type Database from 'better-sqlite3';
import { postsByIds } from './lib-db-query.ts';
import { trashCapture } from './lib-trash-capture.ts';

export interface ReplacementReport {
  // Replacements carried out this pass: the old capture is in the trash.
  applied: Array<{ newId: string; oldId: string }>;
  // Markers that named nothing this database holds — cleared, nothing moved.
  cleared: string[];
  failed: Array<{ newId: string; oldId: string; error: string }>;
}

// Moves everything the OLD record carried that the new one should inherit, then
// drops the old row and clears the marker — one transaction, so a crash leaves
// the marker set and the next pass redoes the whole thing rather than half of
// it.
//
// Union, never overwrite: tags are added to whatever the new record already
// has, and userKind/tagReviewed only fill a value the new record does not carry
// (COALESCE). The new record is the user's most recent statement about the
// post; the old one is what they had curated around it.
function carryOverAndDrop(sqlite: Database.Database, newId: string, oldId: string): void {
  sqlite.exec('BEGIN');
  try {
    sqlite.prepare('INSERT OR IGNORE INTO post_tags (postId, tagId) SELECT ?, tagId FROM post_tags WHERE postId = ?').run(newId, oldId);
    // posts_fts is standalone (no content= link — lib-db-schema.ts), so its
    // tag column is refreshed by a plain UPDATE from the junction it mirrors.
    const tagsText = (sqlite.prepare('SELECT t.name AS name FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = ? ORDER BY pt.rowid').all(newId) as Array<{ name: string }>).map((r) => r.name).join(' ');
    sqlite.prepare('UPDATE posts_fts SET tagsText = ? WHERE postId = ?').run(tagsText, newId);

    const flags = sqlite.prepare('SELECT userKind, tagReviewed FROM posts WHERE captureId = ?').get(oldId) as { userKind: string | null; tagReviewed: number | null } | undefined;
    if (flags) sqlite.prepare('UPDATE posts SET userKind = COALESCE(userKind, ?), tagReviewed = COALESCE(tagReviewed, ?) WHERE captureId = ?').run(flags.userKind, flags.tagReviewed, newId);

    // The captureId references #34's design comment warns about: a replacement
    // that missed one would read as "I replaced it and it vanished from my
    // folder". manual_group_items keeps the old member's seq so the group's
    // order survives.
    sqlite.prepare('INSERT OR IGNORE INTO folder_items (folderId, postId) SELECT folderId, ? FROM folder_items WHERE postId = ?').run(newId, oldId);
    sqlite.prepare('INSERT OR IGNORE INTO manual_group_items (groupId, postId, seq) SELECT groupId, ?, seq FROM manual_group_items WHERE postId = ?').run(newId, oldId);
    // The acquisition originals (#292) outlive the capture that fetched them:
    // the layer is append-only, and a replacement is not the user asking for
    // an original to be forgotten. The unique identity index makes a payload
    // both records already share a no-op rather than a duplicate row.
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO raw_payloads (postId, sourceKind, acquiredAt, contentType, encoding, sha256, byteLength, payload)
         SELECT ?, sourceKind, acquiredAt, contentType, encoding, sha256, byteLength, payload FROM raw_payloads WHERE postId = ?`,
      )
      .run(newId, oldId);

    // FK ON DELETE CASCADE takes media/post_tags/folder_items/
    // manual_group_items/raw_payloads with the row; posts_fts is standalone
    // and has to be removed explicitly (same as lib-db-write.ts's deletePost).
    sqlite.prepare('DELETE FROM posts_fts WHERE postId = ?').run(oldId);
    sqlite.prepare('DELETE FROM posts WHERE captureId = ?').run(oldId);
    sqlite.prepare('UPDATE posts SET replaces = NULL WHERE captureId = ?').run(newId);
    sqlite.exec('COMMIT');
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }
}

function clearMarker(sqlite: Database.Database, newId: string): void {
  sqlite.prepare('UPDATE posts SET replaces = NULL WHERE captureId = ?').run(newId);
}

// Every pending marker, oldest capture first. Safe to call repeatedly — with no
// markers pending (the overwhelmingly common case) it is one indexed scan and
// nothing else.
//
// Files move BEFORE the transaction on purpose. Dying in between leaves the old
// row pointing at files that are already in the trash — visibly broken, but the
// marker is still set, so the next pass finishes the job. The other order would
// leave the old capture's files loose in the library with no row naming them,
// where orphan recovery (#301) would synthesize a record and undo the
// replacement.
export async function applyPendingReplacements(opts: { sqlite: Database.Database; folder: string; trashDir: string; mediaExts: readonly string[] }): Promise<ReplacementReport> {
  const { sqlite, folder, trashDir, mediaExts } = opts;
  const report: ReplacementReport = { applied: [], cleared: [], failed: [] };
  const pending = sqlite.prepare('SELECT captureId, replaces FROM posts WHERE replaces IS NOT NULL ORDER BY captureId').all() as Array<{ captureId: string; replaces: string }>;
  if (!pending.length) return report;

  for (const { captureId: newId, replaces: oldId } of pending) {
    try {
      if (!oldId || oldId === newId || !sqlite.prepare('SELECT 1 FROM posts WHERE captureId = ?').get(oldId)) {
        clearMarker(sqlite, newId);
        report.cleared.push(newId);
        continue;
      }
      // Read before anything moves: this record IS the trash-side JSON, and
      // the tags come from the junction that is about to cascade away.
      const record = (await postsByIds(sqlite, [oldId]))[0] || null;
      const tags = (sqlite.prepare('SELECT t.name AS name FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = ? ORDER BY pt.rowid').all(oldId) as Array<{ name: string }>).map((r) => r.name);
      await trashCapture({ folder, trashDir, mediaExts, captureId: oldId, record, flags: record ? { tags, userKind: record.userKind, tagReviewed: record.tagReviewed } : null });
      carryOverAndDrop(sqlite, newId, oldId);
      report.applied.push({ newId, oldId });
    } catch (err: any) {
      report.failed.push({ newId, oldId, error: err?.message || String(err) });
    }
  }
  return report;
}
