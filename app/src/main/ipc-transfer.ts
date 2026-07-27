'use strict';

// Transfer IPC handlers, extracted from main.js (mechanical move — logic unchanged).
// The highest-blast-radius group: import-posts (data: URLs + best-effort avatar fetch),
// import-images (local files), clear-all (destructive wipe, gated on config health),
// export-save / export-complete / import-complete (ZIP round-trip), and pick-save-folder
// (crash-safe library relocation: copy → flip config → delete old, then re-point the
// watcher + full-resync the renderer). The heavy engines (validateSaveFolder,
// copyLibraryInto, watchSaveFolder, the config/pointer layer, clearAllBlockReason,
// avatar fetch) stay in main.js and arrive via ctx; mutable state is reached through
// getWin/send/getConfigLastCorrupt/resetDelta accessors. JSZip (npm dep) stays behind
// a dynamic import in getJSZip so a normal launch never pulls it in.
import { ipcMain, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import * as archive from './lib-archive';
import { parseJsonLoose } from './lib-json';
import { cloudSyncProviderOf } from './save-folder-guard';

let _JSZip: any = null;
async function getJSZip() {
  if (_JSZip) return _JSZip;
  const mod: any = await import('jszip');
  return (_JSZip = mod.default ?? mod);
}
function exportStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

// Named subfolder for a relocated library, so picking a folder never dumps
// sidecars/images flat into it (parallel to BACKUP_SUBDIR's Hologram-mirror).
const LIBRARY_SUBDIR = 'Hologram-library';

// Import arbitrary image files as library images (the user's own files are fine).
// Tagged source:'drag' so they appear in the image browse view. Also serves as the
// import path for Hologram' media-only export.
const IMPORTABLE_IMG = ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'avif', 'bmp', 'tiff', 'svg'];
const IMPORTABLE_VID = ['mp4', 'webm', 'mov', 'm4v'];
const IMPORTABLE_MEDIA = IMPORTABLE_IMG.concat(IMPORTABLE_VID);

function register(ctx) {
  const { getSaveFolder, getTrashDir, readConfig, writeConfig, readSavePointer, getConfigLastCorrupt, clearAllBlockReason, VIEWABLE_EXTS, INTERNAL_FILES, pixivRefererFor, downloadAvatar, getWin, send, validateSaveFolder, relocateLibrary, watchSaveFolder, resetDelta } = ctx;

  ipcMain.handle('import-posts', async (_e, posts) => {
    const folder = getSaveFolder();
    if (!folder || !Array.isArray(posts)) return { imported: 0, skipped: 0 };
    fs.mkdirSync(folder, { recursive: true });

    // Duplicate detection. url is the primary identity; URL-less posts (file/
    // Eagle migrations — the dominant legacy case) would otherwise duplicate
    // wholesale on a re-import, so they fall back to a composite of eagleName +
    // capturedAt + image byte size (stat only — no content read/hash). All three
    // must agree: eagleName alone is NOT unique (it's a user-visible title —
    // real Eagle libraries carry many duplicate names), and a converter may
    // stamp one capturedAt across a whole batch, so neither field alone is
    // trustworthy. .trash is scanned too: a deliberately deleted post must not
    // resurrect through a re-import while it still sits in trash.
    const existingUrls = new Set();
    const existingLegacy = new Set();
    const legacyKeyOf = (name, at, bytes) => `${name}\u0000${at}\u0000${bytes}`;
    const scanExisting = (dir) => {
      let names: string[] = [];
      try {
        names = fs.readdirSync(dir);
      } catch {
        return; // absent (e.g. no .trash yet)
      }
      for (const f of names) {
        if (!f.toLowerCase().endsWith('.json') || f === 'config.json' || f === '.index.json') continue;
        try {
          const r = parseJsonLoose(fs.readFileSync(path.join(dir, f), 'utf8'));
          if (r.url) existingUrls.add(r.url);
          else if (r.eagleName && r.capturedAt && typeof r.image === 'string') {
            // statSync throw (image file missing) skips the key via the outer
            // catch — that record just can't dedup, the import stays conservative.
            existingLegacy.add(legacyKeyOf(r.eagleName, r.capturedAt, fs.statSync(path.join(dir, r.image)).size));
          }
        } catch {
          /* skip unreadable */
        }
      }
    };
    scanExisting(folder);
    const trashDir = getTrashDir();
    if (trashDir) scanExisting(trashDir);

    // Avatars land in the shared avatars/ store (one file per avatar URL) — the
    // store itself dedupes successful downloads by existence, so only FAILED URLs
    // need a local cache (a legacy import with dead avatar hosts would otherwise
    // re-pay the fetch timeout once per record of that author).
    const avatarFailed = new Set();
    async function fetchAvatarShared(url) {
      if (avatarFailed.has(url)) return null;
      let file = null;
      try {
        file = await downloadAvatar(url, pixivRefererFor(url), folder);
      } catch {
        file = null;
      }
      if (!file) avatarFailed.add(url);
      return file;
    }

    const stamp = Date.now();
    let imported = 0,
      skipped = 0,
      seq = 0;
    for (const p of posts) {
      if (!p || typeof p.image !== 'string' || !/^data:image\//.test(p.image)) {
        skipped++;
        continue;
      }
      if (p.url && existingUrls.has(p.url)) {
        skipped++;
        continue;
      }
      const imgBuf = Buffer.from(p.image.split(',')[1] || '', 'base64');
      const legacyKey = !p.url && p.eagleName && p.capturedAt ? legacyKeyOf(p.eagleName, p.capturedAt, imgBuf.length) : null;
      if (legacyKey && existingLegacy.has(legacyKey)) {
        skipped++;
        continue;
      }
      const captureId = `import-${stamp}-${String(seq++).padStart(4, '0')}`;
      const rec = {
        captureId,
        image: `${captureId}.jpg`,
        url: p.url || null,
        platform: p.platform || null,
        text: p.text || null,
        title: p.title || null,
        displayName: p.displayName || null,
        screenName: p.screenName || null,
        userId: p.userId || null,
        avatar: p.avatar || null,
        avatarFile: /** @type {string | null} */ (null),
        followers: p.followers ?? null,
        authorCreatedAt: p.authorCreatedAt || null,
        likes: p.likes ?? null,
        reposts: p.reposts ?? null,
        replies: p.replies ?? null,
        bookmarks: p.bookmarks ?? null,
        views: p.views ?? null,
        date: p.date || null,
        capturedAt: p.capturedAt || new Date().toISOString(),
        updatedAt: p.updatedAt || p.capturedAt || new Date().toISOString(),
        capturedVia: p.capturedVia || null,
        eagleName: p.eagleName || null,
        mediaType: p.mediaType || null,
        lang: p.lang || null,
        isReply: p.isReply || null,
        isQuote: p.isQuote || null,
        isThread: p.isThread || null,
        quotedUrl: p.quotedUrl || null,
        hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
        tags: Array.isArray(p.tags) ? p.tags : [],
      };
      try {
        fs.writeFileSync(path.join(folder, `${captureId}.jpg`), imgBuf);
        // Best-effort avatar before the sidecar so avatarFile reflects what landed
        // on disk. Wrapped on its own so an avatar failure leaves avatarFile null
        // (the viewer hides it) and NEVER fails the import.
        if (rec.avatar) {
          try {
            const af = await fetchAvatarShared(rec.avatar);
            if (af) rec.avatarFile = af;
          } catch {
            /* avatar is best-effort */
          }
        }
        fs.writeFileSync(path.join(folder, `${captureId}.json`), JSON.stringify(rec, null, 2), 'utf8');
        if (p.url) existingUrls.add(p.url);
        else if (legacyKey) existingLegacy.add(legacyKey);
        imported++;
      } catch {
        skipped++;
      }
    }
    return { imported, skipped };
  });

  ipcMain.handle('clear-all', async () => {
    const folder = getSaveFolder();
    if (!folder) return { ok: false, count: 0 };
    // Refuse to wipe when config is degraded: a corrupt config, or one that lost its
    // saveFolder while the redundant pointer proves a library was chosen, means we may
    // be aimed at a recovered/default folder. Bail so a wipe can't hit the wrong place
    // (the user should restart to let initSaveFolderRedundancy repair config first).
    const cfg = readConfig();
    const blocked = clearAllBlockReason({
      configCorrupt: getConfigLastCorrupt(),
      hasExplicitSaveFolder: typeof cfg.saveFolder === 'string' && !!cfg.saveFolder.trim(),
      hasPointer: !!readSavePointer(),
    });
    if (blocked) return { ok: false, blocked, count: 0 };
    let count = 0;
    // Keep app metadata (the shared INTERNAL_FILES set — config, index snapshot,
    // organization JSON); wipe sidecars + every viewable media type (incl.
    // jfif/avif/svg/video/-poster), mirroring delete-post. Using the same set as
    // the watcher/index means a newly added internal file is skipped here too,
    // instead of silently falling through to the wipe.
    const CLEAR_RE = new RegExp('\\.(' + VIEWABLE_EXTS.join('|') + '|json)$', 'i');
    try {
      for (const f of fs.readdirSync(folder)) {
        if (INTERNAL_FILES.has(f)) continue;
        if (CLEAR_RE.test(f)) {
          try {
            fs.unlinkSync(path.join(folder, f));
            count++;
          } catch {
            /* skip */
          }
        }
      }
    } catch {
      /* empty */
    }
    return { ok: true, count };
  });

  ipcMain.handle('export-save', async (_e, filename, bytes) => {
    const res = await dialog.showSaveDialog(getWin(), { defaultPath: filename });
    if (res.canceled || !res.filePath) return { saved: false };
    try {
      await fs.promises.writeFile(res.filePath, Buffer.from(bytes));
      return { saved: true, path: res.filePath };
    } catch (err) {
      return { saved: false, error: err.message };
    }
  });

  // --- Complete export (directly re-importable snapshot) ------------------------
  // One ZIP that mirrors the whole library under library/: every capture file
  // (jpg/json/media) PLUS the organization JSONs (folders/tag-types/ungrouped/
  // manual-groups). Excludes config.json (machine-specific) and .index.json
  // (cache). Manual-only: the scheduled path is the incremental mirror (runBackup),
  // which replaced the old scheduled-ZIP idea — ZIP stays as the hand-carried snapshot.
  ipcMain.handle('export-complete', async (_e, mode) => {
    const imagesOnly = mode === 'images';
    const src = getSaveFolder();
    // Emptiness is a cheap readdir — check it BEFORE the dialog so an empty library
    // never pops a save prompt (matches the old fileCount===0 → empty behaviour).
    let hasAny: boolean;
    try {
      hasAny = await archive.hasExportableFiles(src, imagesOnly);
    } catch (err) {
      return { saved: false, error: err.message };
    }
    if (!hasAny) return { saved: false, empty: true };
    const res = await dialog.showSaveDialog(getWin(), { defaultPath: `hologram-${imagesOnly ? 'images' : 'export'}-${exportStamp()}.zip` });
    if (res.canceled || !res.filePath) return { saved: false };
    // Stream the archive straight to the chosen path (yazl: bounded memory + ZIP64) —
    // the whole library never sits in memory and a >4 GiB archive stays valid. Progress
    // drives the Windows taskbar (BrowserWindow.setProgressBar) AND an 'export-progress'
    // IPC event for the in-app %; throttled to whole-percent changes so we don't spam.
    // On any failure, drop the partial file so a half-written ZIP is never left behind.
    const win = getWin();
    let lastPct = -1;
    const onProgress = (written: number, total: number) => {
      const frac = total > 0 ? Math.min(1, written / total) : 0;
      const pct = Math.floor(frac * 100);
      if (pct === lastPct) return;
      lastPct = pct;
      try {
        win?.setProgressBar(frac);
      } catch {
        /* window gone */
      }
      send('export-progress', { written, total, pct });
    };
    try {
      win?.setProgressBar(0);
      send('export-progress', { written: 0, total: 0, pct: 0 });
      const built = imagesOnly ? await archive.writeImagesZip(src, res.filePath, onProgress) : await archive.writeCompleteZip(src, res.filePath, undefined, onProgress);
      try {
        win?.setProgressBar(-1);
      } catch {
        /* window gone */
      }
      send('export-progress', { done: true });
      return { saved: true, path: res.filePath, fileCount: built.fileCount };
    } catch (err) {
      try {
        win?.setProgressBar(-1);
      } catch {
        /* window gone */
      }
      send('export-progress', { done: true });
      try {
        await fs.promises.unlink(res.filePath);
      } catch {
        /* nothing to clean up */
      }
      return { saved: false, error: err.message };
    }
  });

  // --- Complete import (restore a complete-export ZIP) --------------------------
  // Captures (jpg/json/media) are copied into the save folder, SKIPPING any that
  // already exist (by filename) — so re-importing is idempotent and importing into
  // a non-empty library merges rather than clobbers. The organization JSONs are
  // MERGED (union) so existing folders/tags are never wiped. (Legacy exports —
  // metadata.json + images/ — keep using the renderer's importPosts path.)
  ipcMain.handle('import-complete', async (_e, bytes) => {
    try {
      return await archive.importCompleteZip(await getJSZip(), getSaveFolder(), Buffer.from(bytes));
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Change where the library lives. Picks a folder, MOVES the existing library
  // there (crash-safe: copy → flip config → delete old), then re-points the watcher
  // and forces the renderer to resync. The native host reads saveFolder from the
  // same config.json, so new captures follow automatically.
  //
  // Split in two so a non-blocking warning can sit between picking and moving (#95):
  // pick-save-folder resolves + validates a destination and reports anything the user
  // should see first; move-save-folder does the actual relocation once they accept.
  // The move re-validates from scratch — the renderer round-trip is a UI step, not a
  // trust boundary.
  function moveLibraryTo(dest) {
    const src = getSaveFolder();
    const v = validateSaveFolder(dest);
    if (!v.ok) return { ok: false, error: v.error };

    // Whole crash-safe sequence lives in lib-migrate (copy+catch-up → flip →
    // verified cleanup → shell removal → delayed straggler sweep).
    return relocateLibrary(src, dest, {
      readConfig,
      writeConfig,
      emit: (payload) => send('save-folder-progress', payload),
      // Re-point the watcher and drop the delta baseline so the renderer full-resyncs.
      afterFlip: () => {
        watchSaveFolder();
        resetDelta();
      },
      // The sweep fires a minute later — skip it if the library moved yet again.
      stillCurrent: () => path.resolve(getSaveFolder() || '') === path.resolve(dest),
    });
  }

  ipcMain.handle('pick-save-folder', async () => {
    const res = await dialog.showOpenDialog(getWin(), { properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
    const chosen = res.filePaths[0];
    // Treat the picked folder as a PARENT and put the library in a named subfolder
    // — never dump sidecars/images flat into a folder that may hold the user's own
    // files. If they re-pick an existing Hologram-library folder, use it as-is (no
    // double nesting).
    const dest = path.basename(chosen).toLowerCase() === LIBRARY_SUBDIR.toLowerCase() ? chosen : path.join(chosen, LIBRARY_SUBDIR);
    const v = validateSaveFolder(dest);
    if (!v.ok) return { ok: false, error: v.error };

    // Warn (never block) when the destination looks like it sits under a cloud-sync
    // root: the library is written live, and a sync client racing those writes can
    // corrupt it. Heuristic → the user decides; the mirror is the supported cloud spot.
    const cloudProvider = cloudSyncProviderOf(dest);
    if (cloudProvider) return { ok: false, confirm: 'cloud-sync', provider: cloudProvider, dest };

    return moveLibraryTo(dest);
  });

  // Second half of the pick flow: relocate to a destination the user already
  // accepted a warning for. Not a general "move anywhere" entry point.
  ipcMain.handle('move-save-folder', async (_e, dest) => {
    if (!dest || typeof dest !== 'string') return { ok: false, error: 'invalid' };
    return moveLibraryTo(dest);
  });

  ipcMain.handle('import-images', async () => {
    const folder = getSaveFolder();
    if (!folder) return { imported: 0, skipped: 0, error: 'no-folder' };
    const res = await dialog.showOpenDialog(getWin(), {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Media', extensions: IMPORTABLE_MEDIA }],
    });
    if (res.canceled || !res.filePaths || !res.filePaths.length) return { imported: 0, skipped: 0, canceled: true };
    fs.mkdirSync(folder, { recursive: true });
    let imported = 0,
      skipped = 0,
      seq = 0;
    const stamp = Date.now();
    for (const fp of res.filePaths) {
      try {
        const ext = (path.extname(fp).slice(1) || 'png').toLowerCase();
        if (!IMPORTABLE_MEDIA.includes(ext)) {
          skipped++;
          continue;
        }
        const st = await fs.promises.stat(fp);
        if (!st.isFile()) {
          skipped++;
          continue;
        }
        const isVid = IMPORTABLE_VID.includes(ext);
        const captureId = `drag-${stamp}-${String(seq++).padStart(4, '0')}`;
        const file = `${captureId}.${ext}`;
        const nowIso = new Date().toISOString();
        const mtimeIso = st.mtime && !Number.isNaN(st.mtime.getTime()) ? st.mtime.toISOString() : nowIso;
        const rec = {
          captureId,
          source: 'drag',
          url: null,
          platform: null,
          title: path.basename(fp, path.extname(fp)) || null,
          text: null,
          displayName: null,
          screenName: null,
          mediaType: isVid ? 'video' : 'image',
          capturedAt: nowIso,
          date: mtimeIso,
          updatedAt: nowIso,
          media: [],
          tags: [],
          hashtags: [],
        };
        if (isVid) (rec as any).video = file;
        else (rec as any).image = file;
        await fs.promises.copyFile(fp, path.join(folder, file));
        await fs.promises.writeFile(path.join(folder, `${captureId}.json`), JSON.stringify(rec, null, 2), 'utf8');
        imported++;
      } catch {
        skipped++;
      }
    }
    return { imported, skipped };
  });
}

export { register };
