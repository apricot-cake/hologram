'use strict';

// Trash (soft-delete) + tag-mutation IPC handlers. delete-post moves a capture's
// files into .trash/ and drops its DB row; list/restore/empty/delete-from-trash
// manage that folder; update-tags writes straight to the DB.
//
// Why the trash keeps a per-item JSON while the library itself does not: a trashed
// post has no posts row at all, so its record has to live somewhere, and next to
// the files it describes is where the platform conventions put it — the
// freedesktop.org trash spec pairs every trashed file with a `.trashinfo`, and
// digiKam's collection trash pairs one with a `.dtrashinfo`. That also makes the
// trash self-describing: it survives DB loss and travels with a copied library,
// which is what #5's scope means by keeping `.trash/` on the filesystem. The
// record is regenerated FROM the DB when a capture never had a sidecar (#299),
// the same direction as #300's export.
import { ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fillCardDims } from './lib-card-dims.ts';
import { parseJsonLoose } from './lib-json.ts';
import { postsByIds } from './lib-db-query.ts';
import { makeTagResolver, preparePostStmts, writePost } from './lib-db-record-writer.ts';
import { listTrashRecords, trashCapture } from './lib-trash-capture.ts';

function register(ctx) {
  const { getSaveFolder, getTrashDir, baseOf, LIBRARY_MEDIA_EXTS, getDbWriter, ensurePostsSynced, send } = ctx;

  ipcMain.handle('delete-post', async (_e, image) => {
    const folder = getSaveFolder();
    if (!folder || !image) return { ok: false };
    // Soft-delete: move all files for this captureId into .trash/ (instead of unlinking).
    const base = baseOf(image);
    // Read the record and its DB-only state (tags/userKind/tagReviewed) BEFORE the
    // row disappears: it is the whole content of the trash-side record, which
    // restore-post reads back and the legacy import's dedup scan consults to stop a
    // deliberately-deleted post from resurrecting on re-import.
    const handle = ensurePostsSynced();
    const flags = getDbWriter().getPostFlags(base);
    const rec: any = handle ? (await postsByIds(handle.sqlite, [base]))[0] || null : null;
    getDbWriter().deletePost(base);
    // The file half — shared with #34's replacement sweep so both retire a
    // capture the same way (lib-trash-capture.ts).
    await trashCapture({ folder, trashDir: getTrashDir(), mediaExts: LIBRARY_MEDIA_EXTS, captureId: base, record: rec, flags });
    return { ok: true };
  });

  // Reading and normalizing the .trash/ JSON lives in lib-trash-capture.ts
  // (listTrashRecords) — Electron-free, so the trust boundary it enforces is
  // unit-testable (#324). This handler is only the wiring.
  ipcMain.handle('list-trash', async () => {
    const trashDir = getTrashDir();
    if (!trashDir) return [];
    return await listTrashRecords(trashDir);
  });

  ipcMain.handle('restore-post', async (_e, image) => {
    const trashDir = getTrashDir();
    const folder = getSaveFolder();
    if (!trashDir || !folder) return { ok: false };
    const base = baseOf(image);
    let names: string[];
    try {
      names = await fs.promises.readdir(trashDir);
    } catch {
      return { ok: false };
    }
    // Read the record BEFORE moving anything: it is what recreates the posts row.
    const trashJson = path.join(trashDir, `${base}.json`);
    let restored: any = null;
    try {
      const parsed = parseJsonLoose(await fs.promises.readFile(trashJson, 'utf8'));
      // Objects only: the file is external input (a planted `.trash/x.json` can
      // hold any JSON value, #324), and a bare number/string/array reaching
      // writePost below would fail the write with a NOT NULL captureId instead.
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        restored = parsed;
        delete restored.trashedAt;
      }
    } catch {
      /* no record in the trash — the media still moves back, as an orphan (#301) */
    }
    // Media files go back to the library; the record does NOT. Since #302 the
    // library folder holds media only, and a post exists by having a posts row.
    for (const f of names) {
      if (f === `${base}.json`) continue;
      if (f.startsWith(base + '.') || f.startsWith(base + '-')) {
        try {
          await fs.promises.rename(path.join(trashDir, f), path.join(folder, f));
        } catch {}
      }
    }
    if (restored) {
      const handle = ensurePostsSynced();
      if (handle) {
        const sqlite = handle.sqlite;
        const stmts = preparePostStmts(sqlite);
        const resolveTagId = makeTagResolver(sqlite);
        sqlite.exec('BEGIN');
        try {
          writePost(stmts, resolveTagId, fillCardDims(folder, restored));
          sqlite.exec('COMMIT');
        } catch (err) {
          sqlite.exec('ROLLBACK');
          throw err;
        }
        // userKind/tagReviewed are not part of PostRecordShape, so writePost does
        // not carry them — re-apply from the record delete-post stamped with the
        // pre-trash DB values.
        getDbWriter().restorePostFlags(base, restored);
      }
      try {
        await fs.promises.unlink(trashJson);
      } catch {
        /* best-effort: a leftover record would make list-trash show a ghost */
      }
      // The grid only refetches on this event (see index.ts's inbox watcher) —
      // without it a restored post stays missing until the next app launch.
      send('posts-changed', null);
    }
    return { ok: true };
  });

  ipcMain.handle('empty-trash', async () => {
    const trashDir = getTrashDir();
    if (!trashDir) return { ok: true };
    try {
      await fs.promises.rm(trashDir, { recursive: true, force: true });
    } catch {}
    return { ok: true };
  });

  ipcMain.handle('delete-from-trash', async (_e, image) => {
    const trashDir = getTrashDir();
    if (!trashDir) return { ok: false };
    const base = baseOf(image);
    let names: string[];
    try {
      names = await fs.promises.readdir(trashDir);
    } catch {
      return { ok: false };
    }
    for (const f of names) {
      if (f.startsWith(base + '.') || f.startsWith(base + '-')) {
        try {
          await fs.promises.unlink(path.join(trashDir, f));
        } catch {}
      }
    }
    return { ok: true };
  });

  // #298/St5: tag edits are an in-app write, so they go straight to the DB
  // (post_tags + posts.userKind/tagReviewed) — see lib-db-write.ts's
  // replacePostTags.
  ipcMain.handle('update-tags', async (_e, image, tags, patch) => {
    const captureId = baseOf(image);
    if (!captureId) return { ok: false };
    try {
      ensurePostsSynced(); // the captureId needs a posts row before this edit can attach to it
      const ok = getDbWriter().setPostTags(captureId, tags, patch && typeof patch === 'object' ? patch : null);
      return { ok };
    } catch {
      return { ok: false };
    }
  });
}

export { register };
