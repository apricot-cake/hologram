'use strict';

// Transfer IPC handlers, extracted from main.js (mechanical move — logic unchanged).
// The highest-blast-radius group: import-legacy-zip (a pre-#300 export read in main,
// expanded to data: URLs + best-effort avatar fetch),
// import-images (local files), clear-all (destructive wipe, gated on config health),
// export-save / export-complete / import-complete (ZIP round-trip), and pick-save-folder
// (crash-safe library relocation: copy → flip config → delete old, then re-point the
// watcher + full-resync the renderer). The heavy engines (validateSaveFolder,
// copyLibraryInto, watchSaveFolder, the config/pointer layer, clearAllBlockReason,
// avatar fetch) live outside this module (#227: lib-backup.ts, lib-migrate.ts,
// lib-config.ts, native-host.ts) and arrive via ctx; mutable state is reached through
// getWin/send/getConfigLastCorrupt/resetDelta accessors.
import { ipcMain, dialog, clipboard } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import * as archive from './lib-archive.ts';
import { parseJsonLoose } from './lib-json.ts';
import { cloudSyncProviderOf } from './save-folder-guard.ts';
import { fillCardDims } from './lib-card-dims.ts';
import { makeTagResolver, preparePostStmts, writePost } from './lib-db-record-writer.ts';
import { IMPORTABLE_MEDIA, buildLocalRecord, importLocalImage, localCaptureId } from './lib-local-intake.ts';
import type { PostRecordInput } from '../../../native-host/post-record.mts';
import type { BrowserWindow } from 'electron';
import type { IpcContext } from './ipc-context.ts';
import type { ClearAllResult, ClipboardImportResult, CompleteImportResult, ExportCompleteResult, ExportSaveResult, LegacyImportResult, MediaImportResult, SaveFolderMoveResult, SaveFolderPickResult } from './ipc-payloads.ts';

function exportStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

// Named subfolder for a relocated library, so picking a folder never dumps
// sidecars/images flat into it (parallel to BACKUP_SUBDIR's Hologram-mirror).
const LIBRARY_SUBDIR = 'Hologram-library';

// The extension lists and the record shape a locally-imported file becomes now live
// in lib-local-intake.ts — the dialog below is one of four doors that share them
// (#84's 実装設計 comment; the clipboard door is at the bottom of this file).

function register(ctx: IpcContext) {
  const {
    getSaveFolder,
    getTrashDir,
    readConfig,
    writeConfig,
    readSavePointer,
    getConfigLastCorrupt,
    clearAllBlockReason,
    LIBRARY_MEDIA_EXTS,
    getDbWriter,
    pixivRefererFor,
    downloadAvatar,
    getWin,
    send,
    validateSaveFolder,
    relocateLibrary,
    watchInboxFolder,
    resetDelta,
    ensurePostsSynced,
    scheduleSavedIndexWrite,
    sweepReplacements,
  } = ctx;

  // #299: the app itself is the DB's one writer, so importing posts writes
  // straight into the DB via the shared record writer (lib-db-record-writer.ts
  // — the same writer the sidecar importer and the inbox consumer use) instead
  // of producing a sidecar the DB would have to re-derive from later. Dedup
  // checks the DB (URL-based) instead of scanning sidecars — there are none
  // left to scan for a post that comes in this way.
  //
  // Not an IPC handler: the legacy ZIP import is the only producer of these
  // records and it reads the archive in main now (#322), so the records — which
  // carry a base64 data: URL per post — never cross the process boundary. It used
  // to be `import-posts`, invoked by the renderer with the array it had built from
  // its own copy of the archive.
  //
  // #34 turned the URL duplicate from a fixed skip into the same three answers
  // the extension's warning offers, asked ONCE for the batch rather than per
  // post (an import is a hundred posts arriving at once; a per-post question
  // would be a hundred questions). `duplicateMode` is the answer:
  //   'skip'    — leave the library's copy alone, import the rest (the old,
  //               and still the default, behaviour)
  //   'copy'    — import the duplicates too, as additional records
  //   'replace' — import them AND retire the record each one duplicates, via
  //               the same `replaces` marker the extension writes
  // Absent, with duplicates present, imports NOTHING and answers
  // { needsChoice, duplicates } so the renderer can ask and call back.
  async function importPostRecords(posts, duplicateMode) {
    const mode = duplicateMode === 'copy' || duplicateMode === 'replace' || duplicateMode === 'skip' ? duplicateMode : null;
    const folder = getSaveFolder();
    if (!folder || !Array.isArray(posts)) return { imported: 0, skipped: 0 };
    fs.mkdirSync(folder, { recursive: true });
    const handle = await ensurePostsSynced();
    if (!handle) return { imported: 0, skipped: 0 };
    const { sqlite } = handle;

    // Duplicate detection. url is the primary identity; URL-less posts (file/
    // Eagle migrations — the dominant legacy case) would otherwise duplicate
    // wholesale on a re-import, so they fall back to a composite of eagleName +
    // capturedAt + image byte size (stat only — no content read/hash). All three
    // must agree: eagleName alone is NOT unique (it's a user-visible title —
    // real Eagle libraries carry many duplicate names), and a converter may
    // stamp one capturedAt across a whole batch, so neither field alone is
    // trustworthy.
    //
    // The live library is kept as url -> captureId rather than a bare set,
    // because "replace" has to name the record it retires (#34). Trashed URLs
    // stay a separate set: a deliberately deleted post must not resurrect
    // through a re-import whatever the answer to the duplicate question is.
    const existingByUrl = new Map<string, string>();
    const trashedUrls = new Set<string>();
    const existingLegacy = new Set<string>();
    const legacyKeyOf = (name, at, bytes) => `${name}\u0000${at}\u0000${bytes}`;
    for (const row of sqlite.prepare('SELECT captureId, url, eagleName, capturedAt, image FROM posts').all() as Array<{ captureId: string; url: string | null; eagleName: string | null; capturedAt: string; image: string | null }>) {
      if (row.url) {
        if (!existingByUrl.has(row.url)) existingByUrl.set(row.url, row.captureId);
        continue;
      }
      if (row.eagleName && row.capturedAt && typeof row.image === 'string') {
        try {
          // statSync throw (image file missing) skips the key — that record
          // just can't dedup, the import stays conservative.
          existingLegacy.add(legacyKeyOf(row.eagleName, row.capturedAt, fs.statSync(path.join(folder, row.image)).size));
        } catch {
          /* skip */
        }
      }
    }
    // .trash/ still holds sidecar JSON (trash is out of this Issue's scope —
    // #301) — a deliberately deleted post must not resurrect through a
    // re-import while it still sits there.
    const trashDir = getTrashDir();
    if (trashDir) {
      let names: string[] = [];
      try {
        names = fs.readdirSync(trashDir);
      } catch {
        names = [];
      }
      for (const f of names) {
        if (!f.toLowerCase().endsWith('.json')) continue;
        try {
          const r = parseJsonLoose(fs.readFileSync(path.join(trashDir, f), 'utf8'));
          if (r.url) trashedUrls.add(r.url);
          else if (r.eagleName && r.capturedAt && typeof r.image === 'string') {
            existingLegacy.add(legacyKeyOf(r.eagleName, r.capturedAt, fs.statSync(path.join(trashDir, r.image)).size));
          }
        } catch {
          /* skip unreadable */
        }
      }
    }

    // Avatars land in the shared avatars/ store (one file per avatar URL) — the
    // store itself dedupes successful downloads by existence, so only FAILED URLs
    // need a local cache (a legacy import with dead avatar hosts would otherwise
    // re-pay the fetch timeout once per record of that author).
    const avatarFailed = new Set();
    async function fetchAvatarShared(url) {
      if (avatarFailed.has(url)) return null;
      let file: string | null = null;
      try {
        file = await downloadAvatar(url, pixivRefererFor(url), folder);
      } catch {
        file = null;
      }
      if (!file) avatarFailed.add(url);
      return file;
    }

    // Ask before importing anything (#34). Counted over the SAME predicate the
    // loop below uses, so the number in the question is the number of posts the
    // answer applies to. A batch with no duplicates never asks.
    if (!mode) {
      let duplicates = 0;
      for (const p of posts) if (p?.url && existingByUrl.has(p.url)) duplicates++;
      if (duplicates) return { imported: 0, skipped: 0, needsChoice: true, duplicates, total: posts.length };
    }
    const onDuplicate = mode || 'skip';

    const stamp = Date.now();
    let imported = 0,
      skipped = 0,
      seq = 0;
    const toWrite: PostRecordInput[] = [];
    for (const p of posts) {
      if (!p || typeof p.image !== 'string' || !/^data:image\//.test(p.image)) {
        skipped++;
        continue;
      }
      if (p.url && trashedUrls.has(p.url)) {
        skipped++;
        continue;
      }
      const duplicateOf = p.url ? existingByUrl.get(p.url) : undefined;
      if (duplicateOf !== undefined && onDuplicate === 'skip') {
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
      const rec: PostRecordInput = {
        captureId,
        // 'replace': the same marker the extension writes, consumed by the
        // same sweep (lib-db-replaces.ts) — one definition of what replacing
        // a record means, whichever door the record came in through.
        replaces: duplicateOf !== undefined && onDuplicate === 'replace' ? duplicateOf : null,
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
        capturedVia: p.capturedVia || null,
        eagleName: p.eagleName || null,
        mediaType: p.mediaType || null,
        lang: p.lang || null,
        isReply: p.isReply || null,
        isQuote: p.isQuote || null,
        isThread: p.isThread || null,
        quotedUrl: p.quotedUrl || null,
        replyToId: p.replyToId || null,
        media: Array.isArray(p.media) ? p.media : [],
        hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
        tags: Array.isArray(p.tags) ? p.tags : [],
      };
      try {
        fs.writeFileSync(path.join(folder, `${captureId}.jpg`), imgBuf);
        // Best-effort avatar before the DB write so avatarFile reflects what
        // landed on disk. Wrapped on its own so an avatar failure leaves
        // avatarFile null (the viewer hides it) and NEVER fails the import.
        if (rec.avatar) {
          try {
            const af = await fetchAvatarShared(rec.avatar);
            if (af) rec.avatarFile = af;
          } catch {
            /* avatar is best-effort */
          }
        }
        toWrite.push(rec);
        // Within one batch the FIRST import of a URL claims it, so a second
        // copy of the same post in the same ZIP is a duplicate of the record
        // just written rather than of the library's original.
        if (p.url) existingByUrl.set(p.url, captureId);
        else if (legacyKey) existingLegacy.add(legacyKey);
        imported++;
      } catch {
        skipped++;
      }
    }

    if (toWrite.length) {
      const stmts = preparePostStmts(sqlite);
      const resolveTagId = makeTagResolver(sqlite);
      sqlite.exec('BEGIN');
      try {
        for (const rec of toWrite) writePost(stmts, resolveTagId, fillCardDims(folder, rec));
        sqlite.exec('COMMIT');
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
      // The bridge's saved-badge snapshot has no other way to learn about
      // these URLs (there's no sidecar/inbox event for it to notice).
      scheduleSavedIndexWrite(handle);
      // An in-app write leaves no inbox event, so the watcher that normally
      // consumes `replaces` markers never fires for these — do it here (#34).
      if (onDuplicate === 'replace') await sweepReplacements();
    }
    return { imported, skipped };
  }

  ipcMain.handle('clear-all', async (): Promise<ClearAllResult> => {
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
    // Drop the records first: the media files are what the user sees, but the posts
    // themselves live in the DB, and since #302 nothing re-derives "this record lost
    // its file" from a scan. Organization is kept (see deleteAllPosts).
    ensurePostsSynced();
    getDbWriter().deleteAllPosts();
    // Then the media — every viewable type (incl. jfif/avif/svg/video/-poster),
    // mirroring delete-post. Media is all a library holds since #302: the records
    // are in the DB, so there is no companion file to sweep alongside them.
    const CLEAR_RE = new RegExp('\\.(' + LIBRARY_MEDIA_EXTS.join('|') + ')$', 'i');
    try {
      for (const f of fs.readdirSync(folder)) {
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

  ipcMain.handle('export-save', async (_e, filename, bytes): Promise<ExportSaveResult> => {
    // Every dialog below is parented to the main window, whose renderer is where
    // the call came from — so getWin() is non-null here, which is what Electron's
    // parent parameter requires.
    const res = await dialog.showSaveDialog(getWin() as BrowserWindow, { defaultPath: filename });
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
  // (jpg/media) PLUS DB-regenerated sidecars and the organization layer (#300/St7 —
  // lib-archive.ts's module comment explains why these can't be a disk copy
  // anymore). Excludes config.json (machine-specific).
  // Manual-only: the scheduled path is the incremental mirror (runBackup), which
  // replaced the old scheduled-ZIP idea — ZIP stays as the hand-carried snapshot.
  ipcMain.handle('export-complete', async (_e, mode, includeTrash): Promise<ExportCompleteResult> => {
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
    // The complete-format export reads posts from the DB (imagesOnly stays a plain
    // disk copy, same as before — it never carried sidecars/organization data).
    let handle: any = null;
    if (!imagesOnly) {
      handle = await ensurePostsSynced();
      if (!handle) return { saved: false, error: 'no-folder' };
    }
    const res = await dialog.showSaveDialog(getWin() as BrowserWindow, { defaultPath: `hologram-${imagesOnly ? 'images' : 'export'}-${exportStamp()}.zip` });
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
      const built = imagesOnly ? await archive.writeImagesZip(src, res.filePath, onProgress) : await archive.writeCompleteZip(handle.sqlite, src, getTrashDir(), res.filePath, { includeTrash: !!includeTrash }, undefined, onProgress);
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
  // Captures (jpg/media) are copied into the save folder, SKIPPING any that
  // already exist (by filename) — so re-importing is idempotent and importing into
  // a non-empty library merges rather than clobbers. Per-post .json sidecars go to
  // the DB instead of disk, and the organization JSONs are DB-read, MERGED
  // (union, same as before), and written back — see lib-archive.ts's
  // importCompleteZipToDb module comment (#300/St7) for why this replaces the
  // disk-only importCompleteZip here.
  //
  // The FILE PICKER lives here, not in the renderer (#485). The renderer used to
  // read the whole archive with FileReader and hand the bytes over IPC, which is
  // exactly what a 4 GiB+ export cannot survive — the renderer OOMs and the IPC
  // message never lands. main picks the path and yauzl streams it off disk, so
  // archive size stops mattering to everything above this handler.
  //
  // Legacy exports (metadata.json + images/) are still importable, and main reads
  // those too (#322 — the decision was to keep the format and put it behind the
  // same guards, not to drop it). An archive that is not a complete export comes
  // back as { legacy:true, path } and the renderer asks for the import itself in a
  // second call: the #34 duplicate question is UI policy and has to sit between
  // reading and writing. What crosses IPC is the PATH main picked — never the
  // archive's bytes, and never the expanded records.
  ipcMain.handle('import-complete', async (): Promise<CompleteImportResult> => {
    const res = await dialog.showOpenDialog(getWin() as BrowserWindow, {
      properties: ['openFile'],
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
    const zipPath = res.filePaths[0];
    try {
      const handle = await ensurePostsSynced();
      if (!handle) return { ok: false, error: 'no-folder' };
      const out = await archive.importCompleteZipToDb(handle.sqlite, zipPath, getSaveFolder());
      if (!out.notComplete) return out;
      return { ok: false, legacy: true, path: zipPath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Second half of a legacy import: read the archive at `zipPath` and write the
  // records it describes. Called twice when the batch has duplicates — once to get
  // the count for the question, once with the answer — so the archive is re-read
  // rather than kept expanded in memory across a user prompt. Reading it is all
  // this does with the path, and the guards in readLegacyZipPosts are what bound
  // that; a ZipLimitError lands in the catch as a plain failed import.
  ipcMain.handle('import-legacy-zip', async (_e, zipPath, duplicateMode): Promise<LegacyImportResult> => {
    if (!zipPath || typeof zipPath !== 'string') return { ok: false, error: 'invalid', imported: 0, skipped: 0 };
    try {
      const posts = await archive.readLegacyZipPosts(zipPath);
      if (!posts) return { ok: false, error: 'not-an-export', imported: 0, skipped: 0 };
      return Object.assign({ ok: true }, await importPostRecords(posts, duplicateMode));
    } catch (err) {
      return { ok: false, error: err.message, imported: 0, skipped: 0 };
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
  function moveLibraryTo(dest: string): SaveFolderMoveResult | Promise<SaveFolderMoveResult> {
    const src = getSaveFolder();
    const v = validateSaveFolder(dest);
    if (!v.ok) return { ok: false, error: v.error };

    // Whole crash-safe sequence lives in lib-migrate (copy+catch-up → flip →
    // verified cleanup → shell removal → delayed straggler sweep).
    return relocateLibrary(src, dest, {
      readConfig,
      writeConfig,
      emit: (payload) => send('save-folder-progress', payload),
      // Re-point the inbox watcher and drop the delta baseline so the renderer full-resyncs.
      afterFlip: () => {
        watchInboxFolder();
        resetDelta();
      },
      // The sweep fires a minute later — skip it if the library moved yet again.
      stillCurrent: () => path.resolve(getSaveFolder() || '') === path.resolve(dest),
    });
  }

  ipcMain.handle('pick-save-folder', async (): Promise<SaveFolderPickResult> => {
    const res = await dialog.showOpenDialog(getWin() as BrowserWindow, { properties: ['openDirectory', 'createDirectory'] });
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
  ipcMain.handle('move-save-folder', async (_e, dest): Promise<SaveFolderMoveResult> => {
    if (!dest || typeof dest !== 'string') return { ok: false, error: 'invalid' };
    return moveLibraryTo(dest);
  });

  // #299: same rationale as importPostRecords above — write straight into the DB (a real
  // video field now, not the `(rec as any).video` escape hatch this used pre-
  // #299) instead of a sidecar the DB would have to re-derive from later.
  ipcMain.handle('import-images', async (): Promise<MediaImportResult> => {
    const folder = getSaveFolder();
    if (!folder) return { imported: 0, skipped: 0, error: 'no-folder' };
    const res = await dialog.showOpenDialog(getWin() as BrowserWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Media', extensions: IMPORTABLE_MEDIA }],
    });
    if (res.canceled || !res.filePaths || !res.filePaths.length) return { imported: 0, skipped: 0, canceled: true };
    fs.mkdirSync(folder, { recursive: true });
    const handle = await ensurePostsSynced();
    if (!handle) return { imported: 0, skipped: 0, error: 'no-folder' };
    const { sqlite } = handle;
    let imported = 0,
      skipped = 0,
      seq = 0;
    const stamp = Date.now();
    const toWrite: PostRecordInput[] = [];
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
        const captureId = localCaptureId('drag', stamp, seq++);
        const file = `${captureId}.${ext}`;
        const nowIso = new Date().toISOString();
        const mtimeIso = st.mtime && !Number.isNaN(st.mtime.getTime()) ? st.mtime.toISOString() : nowIso;
        // Shared with the clipboard door and (later) the watch folder — see
        // lib-local-intake.ts. This door keeps its own copy+batch-transaction
        // because it writes many records at once; only the record SHAPE is shared.
        const rec: PostRecordInput = buildLocalRecord({
          captureId,
          file,
          ext,
          source: 'drag',
          title: path.basename(fp, path.extname(fp)) || null,
          date: mtimeIso,
          now: nowIso,
        });
        await fs.promises.copyFile(fp, path.join(folder, file));
        toWrite.push(rec);
        imported++;
      } catch {
        skipped++;
      }
    }

    if (toWrite.length) {
      const stmts = preparePostStmts(sqlite);
      const resolveTagId = makeTagResolver(sqlite);
      sqlite.exec('BEGIN');
      try {
        for (const rec of toWrite) writePost(stmts, resolveTagId, fillCardDims(folder, rec));
        sqlite.exec('COMMIT');
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    }
    return { imported, skipped };
  });

  // Paste an image straight into the library (#85). The renderer's Ctrl+V lands
  // here; everything about WHEN that key counts as an import (input fields,
  // overlays) is decided renderer-side in services/clipboard-intake.ts, because
  // only the renderer knows what has focus.
  //
  // PNG, always: readImage() hands back a decoded bitmap with the original
  // encoding already lost, so re-encoding is not a choice — "keep the source
  // format" has no implementation here. Callers who want the original bytes use a
  // file door (the dialog, #234's drop, #84's watch folder).
  //
  // `title` comes from the renderer because the label is user-visible and this
  // process holds no message table (i18n is renderer-only, services/i18n.ts).
  // Nothing else about the record is taken from it.
  ipcMain.handle('import-clipboard', async (_e, title): Promise<ClipboardImportResult> => {
    const folder = getSaveFolder();
    if (!folder) return { imported: 0, error: 'no-folder' };
    let bytes: Buffer | null = null;
    try {
      // availableFormats() first: a clipboard holding only text answers an empty
      // NativeImage anyway, but asking the cheap question keeps a large text/html
      // payload from being handed to the image decoder just to be discarded.
      if (clipboard.availableFormats().some((f) => f.startsWith('image/'))) {
        const img = clipboard.readImage();
        if (!img.isEmpty()) bytes = img.toPNG();
      }
    } catch {
      bytes = null;
    }
    // Not an error — the user pressed Ctrl+V with something else on the clipboard.
    if (!bytes || !bytes.length) return { imported: 0, empty: true };
    const handle = await ensurePostsSynced();
    if (!handle) return { imported: 0, error: 'no-folder' };
    try {
      await importLocalImage({
        folder,
        sqlite: handle.sqlite,
        source: 'clipboard',
        idPrefix: 'clip',
        ext: 'png',
        bytes,
        title: typeof title === 'string' && title.trim() ? title : null,
        // No origin date to carry — the paste IS the record's date (#85).
      });
    } catch (err) {
      return { imported: 0, error: err.message };
    }
    // An in-app write leaves no inbox event, so the watcher that normally tells the
    // renderer to refetch never fires — same as a delete (ipc-trash.ts).
    send('posts-changed', null);
    return { imported: 1 };
  });
}

export { register };
