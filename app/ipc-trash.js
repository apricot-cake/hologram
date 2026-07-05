'use strict';

// Trash (soft-delete) + tag-mutation IPC handlers, extracted from main.js (mechanical
// move — logic unchanged). delete-post moves a capture's files into .trash/; list/
// restore/empty/delete-from-trash manage that folder; update-tags rewrites a sidecar's
// tags. restore-post/update-tags use writeSidecarAtomic (tmp+rename) so the watcher
// never sees a half-written sidecar — the crash-safety primitive stays in main.js and
// arrives via ctx along with the other core helpers.
const { ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { parseJsonLoose } = require('./lib-json.js');

function register(ctx) {
  const { getSaveFolder, getTrashDir, baseOf, VIEWABLE_EXTS, resolveInFolder, writeSidecarAtomic } = ctx;

  ipcMain.handle('delete-post', async (_e, image) => {
    const folder = getSaveFolder();
    if (!folder || !image) return { ok: false };
    // Soft-delete: move all files for this captureId into .trash/ (instead of unlinking).
    const base = baseOf(image);
    const targets = new Set([`${base}.json`]);
    for (const e of VIEWABLE_EXTS) targets.add(`${base}.${e}`);
    const jsonPath = resolveInFolder(`${base}.json`);
    let rec = null;
    if (jsonPath) {
      try {
        rec = parseJsonLoose(await fs.promises.readFile(jsonPath, 'utf8'));
        if (rec.image) targets.add(path.basename(rec.image));
        if (rec.video) targets.add(path.basename(rec.video));
        // Shared-store avatars (avatars/<urlhash>.<ext>) are referenced by every
        // capture of that author — deleting one post must not trash the icon.
        // Only legacy per-capture files (<captureId>-avatar.<ext>) are swept.
        if (rec.avatarFile && !/^avatars[\\/]/.test(rec.avatarFile)) targets.add(path.basename(rec.avatarFile));
        for (const m of rec.media || []) {
          if (m && m.file) targets.add(path.basename(m.file));
        }
      } catch {
        /* sidecar missing/corrupt — fall back to the disk sweep */
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
    // Stamp trashedAt in the trash sidecar so auto-purge knows when to expire it.
    const trashJson = path.join(trashDir, `${base}.json`);
    try {
      const r = parseJsonLoose(await fs.promises.readFile(trashJson, 'utf8'));
      r.trashedAt = new Date().toISOString();
      await fs.promises.writeFile(trashJson, JSON.stringify(r, null, 2), 'utf8');
    } catch {
      /* sidecar may not exist — trash still works but won't auto-purge */
    }
    return { ok: true };
  });

  ipcMain.handle('list-trash', async () => {
    const trashDir = getTrashDir();
    if (!trashDir) return [];
    let names;
    try {
      names = await fs.promises.readdir(trashDir);
    } catch {
      return [];
    }
    const records = [];
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
    let names;
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
    // could be caught mid-write by the watcher and cost this post its collection/
    // clip membership (see writeSidecarAtomic).
    const jsonPath = path.join(folder, `${base}.json`);
    try {
      const r = parseJsonLoose(await fs.promises.readFile(jsonPath, 'utf8'));
      delete r.trashedAt;
      await writeSidecarAtomic(jsonPath, r);
    } catch {}
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
    let names;
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

  ipcMain.handle('update-tags', async (_e, image, tags, patch) => {
    const base = baseOf(image);
    const jsonPath = resolveInFolder(`${base}.json`);
    if (!jsonPath) return { ok: false };
    try {
      const rec = parseJsonLoose(await fs.promises.readFile(jsonPath, 'utf8'));
      rec.tags = Array.isArray(tags) ? tags.map(String) : [];
      // Optional extra fields (e.g. the tagging wizard's plain/media flag). Only
      // an allow-listed set is honored so the renderer can't write arbitrary keys.
      if (patch && typeof patch === 'object') {
        if ('userKind' in patch) {
          rec.userKind = patch.userKind === 'plain' || patch.userKind === 'media' ? patch.userKind : null;
        }
        // Tagging "session" marks a post reviewed even when it gets no tags, so
        // it leaves the untagged queue instead of resurfacing every session.
        if ('tagReviewed' in patch) rec.tagReviewed = !!patch.tagReviewed;
      }
      rec.updatedAt = new Date().toISOString(); // record was modified in Corpus
      await writeSidecarAtomic(jsonPath, rec); // tmp+rename: never expose a half-written sidecar to the watcher
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
}

module.exports = { register };
