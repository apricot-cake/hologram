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

function register(ctx) {
  const { getSaveFolder, getTrashDir, baseOf, LIBRARY_MEDIA_EXTS, resolveInFolder, getDbWriter, ensurePostsSynced, send } = ctx;

  ipcMain.handle('delete-post', async (_e, image) => {
    const folder = getSaveFolder();
    if (!folder || !image) return { ok: false };
    // Soft-delete: move all files for this captureId into .trash/ (instead of unlinking).
    const base = baseOf(image);
    // Read the record and its DB-only state (tags/userKind/tagReviewed) BEFORE the
    // row disappears: it is the whole content of the trash-side record, which
    // restore-post reads back and import-posts' dedup scan consults to stop a
    // deliberately-deleted post from resurrecting on re-import.
    const handle = ensurePostsSynced();
    const flags = getDbWriter().getPostFlags(base);
    const rec: any = handle ? (await postsByIds(handle.sqlite, [base]))[0] || null : null;
    getDbWriter().deletePost(base);
    const targets = new Set<string>();
    for (const e of LIBRARY_MEDIA_EXTS) targets.add(`${base}.${e}`);
    if (rec) {
      if (rec.image) targets.add(path.basename(rec.image));
      if (rec.video) targets.add(path.basename(rec.video));
      // Shared-store avatars (avatars/<urlhash>.<ext>) are referenced by every
      // capture of that author — deleting one post must not trash the icon.
      // Only legacy per-capture files (<captureId>-avatar.<ext>) are swept.
      if (rec.avatarFile && !/^avatars[\\/]/.test(rec.avatarFile)) targets.add(path.basename(rec.avatarFile));
      for (const m of rec.media || []) {
        if (m && m.file) targets.add(path.basename(m.file));
        if (m && m.posterFile) targets.add(path.basename(m.posterFile)); // #119 St1
      }
    }
    try {
      for (const f of await fs.promises.readdir(folder)) {
        if (f.startsWith(`${base}-media-`) || f.startsWith(`${base}-poster.`) || f.startsWith(`${base}-avatar.`)) targets.add(f);
      }
    } catch {
      /* ignore */
    }
    const trashDir = getTrashDir();
    await fs.promises.mkdir(trashDir, { recursive: true });
    for (const name of targets) {
      const src = resolveInFolder(name);
      if (src) {
        try {
          await fs.promises.rename(src, path.join(trashDir, name));
        } catch {
          /* not found */
        }
      }
    }
    // Write the trash-side record from the DB row read above, stamped with
    // trashedAt so auto-purge knows when to expire it and carrying the DB-only
    // state (flags) restore-post cannot get from anywhere else.
    if (rec) {
      const r: any = { ...rec, trashedAt: new Date().toISOString() };
      if (flags) {
        r.tags = flags.tags;
        if (flags.userKind != null) r.userKind = flags.userKind;
        if (flags.tagReviewed != null) r.tagReviewed = flags.tagReviewed;
      }
      try {
        await fs.promises.writeFile(path.join(trashDir, `${base}.json`), JSON.stringify(r, null, 2), 'utf8');
      } catch {
        /* best-effort — trash still works but won't auto-purge/dedup */
      }
    }
    return { ok: true };
  });

  ipcMain.handle('list-trash', async () => {
    const trashDir = getTrashDir();
    if (!trashDir) return [];
    let names: string[];
    try {
      names = await fs.promises.readdir(trashDir);
    } catch {
      return [];
    }
    const records: any[] = [];
    for (const f of names) {
      if (!f.toLowerCase().endsWith('.json')) continue;
      try {
        const rec = parseJsonLoose(await fs.promises.readFile(path.join(trashDir, f), 'utf8'));
        if (rec) records.push(rec);
      } catch {
        /* skip corrupt record */
      }
    }
    records.sort((a, b) => new Date(b.trashedAt || 0).getTime() - new Date(a.trashedAt || 0).getTime());
    return records;
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
      restored = parseJsonLoose(await fs.promises.readFile(trashJson, 'utf8'));
      delete restored.trashedAt;
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
