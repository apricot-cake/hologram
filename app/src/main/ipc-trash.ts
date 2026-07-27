'use strict';

// Trash (soft-delete) + tag-mutation IPC handlers, extracted from main.js (mechanical
// move — logic unchanged). delete-post moves a capture's files into .trash/; list/
// restore/empty/delete-from-trash manage that folder; update-tags rewrites a sidecar's
// tags. restore-post/update-tags use writeSidecarAtomic (tmp+rename) so the watcher
// never sees a half-written sidecar — the crash-safety primitive stays in main.js and
// arrives via ctx along with the other core helpers.
import { ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { parseJsonLoose } from './lib-json.ts';
import { postsByIds } from './lib-db-query.ts';

function register(ctx) {
  const { getSaveFolder, getTrashDir, baseOf, VIEWABLE_EXTS, resolveInFolder, writeSidecarAtomic, getDbWriter, ensurePostsSynced } = ctx;

  ipcMain.handle('delete-post', async (_e, image) => {
    const folder = getSaveFolder();
    if (!folder || !image) return { ok: false };
    // Soft-delete: move all files for this captureId into .trash/ (instead of unlinking).
    const base = baseOf(image);
    // Read the DB-only state (#298/St5's tags/userKind/tagReviewed) before the
    // row disappears, so it can be stamped into the trashed sidecar copy below
    // — restore-post already re-derives from that copy, this just gives it
    // accurate values to re-derive FROM instead of whatever the sidecar last
    // had pre-flip.
    const handle = await ensurePostsSynced();
    const flags = getDbWriter().getPostFlags(base);
    // #299: some captures have NO sidecar at all (inbox/import-posts/import-images
    // producers write straight into the DB) — read the full row before it's gone
    // so a trash-side record can still be reconstructed below for restore-post
    // AND for import-posts' dedup scan (ipc-transfer.ts reads .trash/*.json to
    // stop a deliberately-deleted post from resurrecting on re-import).
    const dbRecord = handle ? (await postsByIds(handle.sqlite, [base]))[0] || null : null;
    // Explicit DB delete — do not rely on the next importAll noticing the
    // sidecar's absence (it may never notice: #299 stopped treating "missing
    // from the watched folder" as a delete signal once the DB is authoritative).
    getDbWriter().deletePost(base);
    const targets = new Set([`${base}.json`]);
    for (const e of VIEWABLE_EXTS) targets.add(`${base}.${e}`);
    const jsonPath = resolveInFolder(`${base}.json`);
    let rec: any = null;
    if (jsonPath) {
      try {
        rec = parseJsonLoose(await fs.promises.readFile(jsonPath, 'utf8'));
      } catch {
        /* sidecar missing/corrupt — fall back to the DB record below */
      }
    }
    if (!rec && dbRecord) rec = dbRecord; // no sidecar ever existed for this capture (#299)
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
    // Stamp trashedAt in the trash sidecar so auto-purge knows when to expire it,
    // and carry the DB-only state (flags, read above) into it too.
    const trashJson = path.join(trashDir, `${base}.json`);
    try {
      const r = parseJsonLoose(await fs.promises.readFile(trashJson, 'utf8'));
      r.trashedAt = new Date().toISOString();
      if (flags) {
        r.tags = flags.tags;
        if (flags.userKind != null) r.userKind = flags.userKind;
        if (flags.tagReviewed != null) r.tagReviewed = flags.tagReviewed;
      }
      await fs.promises.writeFile(trashJson, JSON.stringify(r, null, 2), 'utf8');
    } catch {
      // No sidecar moved into .trash — this capture never had one (#299:
      // inbox/import-posts/import-images write straight into the DB). Write a
      // fresh record from the DB row read above, so restore-post and
      // import-posts' dedup scan still work for a sidecar-less capture.
      if (dbRecord) {
        const r = { ...dbRecord, trashedAt: new Date().toISOString() };
        if (flags) {
          r.tags = flags.tags;
          if (flags.userKind != null) r.userKind = flags.userKind;
          if (flags.tagReviewed != null) r.tagReviewed = flags.tagReviewed;
        }
        try {
          await fs.promises.writeFile(trashJson, JSON.stringify(r, null, 2), 'utf8');
        } catch {
          /* best-effort — trash still works but won't auto-purge/dedup */
        }
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
        /* skip corrupt sidecar */
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
    for (const f of names) {
      if (f.startsWith(base + '.') || f.startsWith(base + '-')) {
        try {
          await fs.promises.rename(path.join(trashDir, f), path.join(folder, f));
        } catch {}
      }
    }
    // Remove trashedAt from the restored sidecar. The file is already back in the
    // watched folder, so rewrite it atomically (tmp+rename) — an in-place write
    // could be caught mid-write by the watcher and cost this post its collection
    // membership (see writeSidecarAtomic).
    const jsonPath = path.join(folder, `${base}.json`);
    let restored: any = null;
    try {
      const r = parseJsonLoose(await fs.promises.readFile(jsonPath, 'utf8'));
      delete r.trashedAt;
      restored = r;
      await writeSidecarAtomic(jsonPath, r);
    } catch {}
    if (restored) {
      // The reimport below recreates the posts row with tags intact (tags DO
      // round-trip through the sidecar), but userKind/tagReviewed never do
      // (#298/St5's applyPostFlagsFromRecord doc comment) — re-apply them
      // from the restored sidecar, which delete-post stamped with the
      // pre-trash DB values.
      await ensurePostsSynced();
      getDbWriter().restorePostFlags(base, restored);
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
  // (post_tags + posts.userKind/tagReviewed) instead of the sidecar — see
  // lib-db-write.ts's replacePostTags. The sidecar is left untouched, which
  // is what protects this edit from the next importAll: its mtime doesn't
  // move, so lib-db-import.ts's unchanged-since-last-import guard (#297)
  // skips re-deriving this post from disk and the DB edit sticks.
  ipcMain.handle('update-tags', async (_e, image, tags, patch) => {
    const captureId = baseOf(image);
    if (!captureId) return { ok: false };
    try {
      await ensurePostsSynced(); // the captureId needs a posts row before this edit can attach to it
      const ok = getDbWriter().setPostTags(captureId, tags, patch && typeof patch === 'object' ? patch : null);
      return { ok };
    } catch {
      return { ok: false };
    }
  });
}

export { register };
