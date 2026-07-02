'use strict';

// Transfer IPC handlers, extracted from main.js (mechanical move — logic unchanged).
// The highest-blast-radius group: import-posts (data: URLs + best-effort avatar fetch),
// import-images (local files), clear-all (destructive wipe, gated on config health),
// export-save / export-complete / import-complete (ZIP round-trip), and pick-save-folder
// (crash-safe library relocation: copy → flip config → delete old, then re-point the
// watcher + full-resync the renderer). The heavy engines (validateSaveFolder,
// copyLibraryInto, watchSaveFolder, the config/pointer layer, clearAllBlockReason,
// avatar fetch) stay in main.js and arrive via ctx; mutable state is reached through
// getWin/send/getConfigLastCorrupt/resetDelta accessors. JSZip stays lazily required
// via the local getJSZip so a normal launch never pulls it in.
const { ipcMain, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const archive = require('./lib-archive');
const { parseJsonLoose } = require('./lib-json.js');
let _JSZip = null;
function getJSZip() {
  return _JSZip || (_JSZip = require(path.join(__dirname, 'vendor', 'jszip.min.js')));
}
function exportStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

// Named subfolder for a relocated library, so picking a folder never dumps
// sidecars/images flat into it (parallel to BACKUP_SUBDIR's Corpus-mirror).
const LIBRARY_SUBDIR = 'Corpus-library';

// 任意の画像ファイルをライブラリ画像として取り込む（ユーザー自前の画像でもOK）。
// source:'drag' を付けるので画像閲覧に出る。Corpusのメディアのみエクスポートの取り込みも兼ねる。
const IMPORTABLE_IMG = ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'avif', 'bmp', 'tiff', 'svg'];
const IMPORTABLE_VID = ['mp4', 'webm', 'mov', 'm4v'];
const IMPORTABLE_MEDIA = IMPORTABLE_IMG.concat(IMPORTABLE_VID);

function register(ctx) {
  const { getSaveFolder, readConfig, writeConfig, readSavePointer, getConfigLastCorrupt, clearAllBlockReason, VIEWABLE_EXTS, fetchStillImage, pixivRefererFor, getWin, send, validateSaveFolder, relocateLibrary, watchSaveFolder, resetDelta } = ctx;

  ipcMain.handle('import-posts', async (_e, posts) => {
    const folder = getSaveFolder();
    if (!folder || !Array.isArray(posts)) return { imported: 0, skipped: 0 };
    fs.mkdirSync(folder, { recursive: true });

    const existing = new Set();
    try {
      for (const f of fs.readdirSync(folder)) {
        if (!f.toLowerCase().endsWith('.json') || f === 'config.json' || f === '.index.json') continue;
        try {
          const r = parseJsonLoose(fs.readFileSync(path.join(folder, f), 'utf8'));
          if (r.url) existing.add(r.url);
        } catch {
          /* skip */
        }
      }
    } catch {
      /* empty */
    }

    // Avatars are downloaded once per unique URL: a legacy library has many posts
    // per author, so dedup the network fetch and reuse the bytes for each record's
    // own <captureId>-avatar.<ext>. null = a URL we already tried and failed.
    const avatarCache = new Map();
    async function fetchAvatarCached(url) {
      if (avatarCache.has(url)) return avatarCache.get(url);
      let got = null;
      try {
        got = await fetchStillImage(url, pixivRefererFor(url));
      } catch {
        got = null;
      }
      avatarCache.set(url, got);
      return got;
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
      if (p.url && existing.has(p.url)) {
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
        avatarFile: null,
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
        fs.writeFileSync(path.join(folder, `${captureId}.jpg`), Buffer.from(p.image.split(',')[1] || '', 'base64'));
        // Best-effort avatar before the sidecar so avatarFile reflects what landed
        // on disk. Wrapped on its own so an avatar failure leaves avatarFile null
        // (the viewer hides it) and NEVER fails the import.
        if (rec.avatar) {
          try {
            const got = await fetchAvatarCached(rec.avatar);
            if (got) {
              const af = `${captureId}-avatar.${got.ext}`;
              fs.writeFileSync(path.join(folder, af), got.buf);
              rec.avatarFile = af;
            }
          } catch {
            /* avatar is best-effort */
          }
        }
        fs.writeFileSync(path.join(folder, `${captureId}.json`), JSON.stringify(rec, null, 2), 'utf8');
        if (p.url) existing.add(p.url);
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
    // Keep app metadata (config + migrated tag groups); wipe sidecars + every
    // viewable media type (incl. jfif/avif/svg/video/-poster), mirroring delete-post.
    const CLEAR_RE = new RegExp('\\.(' + VIEWABLE_EXTS.join('|') + '|json)$', 'i');
    try {
      for (const f of fs.readdirSync(folder)) {
        if (
          f === 'config.json' ||
          f === '.index.json' ||
          f === 'tag-groups.json' ||
          f === 'tag-types.json' ||
          f === 'ungrouped.json' ||
          f === 'manual-groups.json' ||
          f === 'folders.json' ||
          f === 'collections.json' ||
          f === 'tabs.json' ||
          f === 'poster-favorites.json' ||
          f === 'poster-folders.json' ||
          f === 'poster-tags.json'
        )
          continue;
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
  // (jpg/json/media) PLUS the organization JSONs (folders/tag-groups/ungrouped/
  // manual-groups). Excludes config.json (machine-specific) and .index.json
  // (cache). Built in main so both manual export and the scheduled export share it.
  ipcMain.handle('export-complete', async (_e, mode) => {
    const imagesOnly = mode === 'images';
    let built;
    try {
      built = imagesOnly ? await archive.buildImagesZip(getJSZip(), getSaveFolder()) : await archive.buildCompleteZip(getJSZip(), getSaveFolder());
    } catch (err) {
      return { saved: false, error: err.message };
    }
    if (built.fileCount === 0) return { saved: false, empty: true };
    const res = await dialog.showSaveDialog(getWin(), { defaultPath: `corpus-${imagesOnly ? 'images' : 'export'}-${exportStamp()}.zip` });
    if (res.canceled || !res.filePath) return { saved: false };
    try {
      await fs.promises.writeFile(res.filePath, built.buffer);
      return { saved: true, path: res.filePath, fileCount: built.fileCount };
    } catch (err) {
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
      return await archive.importCompleteZip(getJSZip(), getSaveFolder(), Buffer.from(bytes));
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Change where the library lives. Picks a folder, MOVES the existing library
  // there (crash-safe: copy → flip config → delete old), then re-points the watcher
  // and forces the renderer to resync. The native host reads saveFolder from the
  // same config.json, so new captures follow automatically.
  ipcMain.handle('pick-save-folder', async () => {
    const res = await dialog.showOpenDialog(getWin(), { properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
    const chosen = res.filePaths[0];
    // Treat the picked folder as a PARENT and put the library in a named subfolder
    // — never dump sidecars/images flat into a folder that may hold the user's own
    // files. If they re-pick an existing Corpus-library folder, use it as-is (no
    // double nesting).
    const dest = path.basename(chosen).toLowerCase() === LIBRARY_SUBDIR.toLowerCase() ? chosen : path.join(chosen, LIBRARY_SUBDIR);
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
        if (isVid) rec.video = file;
        else rec.image = file;
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

module.exports = { register };
