'use strict';

import { app, BrowserWindow, protocol } from 'electron';
import chokidar, { type FSWatcher } from 'chokidar';
import log from 'electron-log/main';
import fs from 'node:fs';
import path from 'node:path';

import { openDatabase, DatabaseCorruptError } from './lib-db.ts';
import { migratePosterKeyHost } from './lib-migrate-poster-key-host.ts';
import { computeDelta } from './lib-post-delta.ts';
import { postsFromDb, searchPostsFts } from './lib-db-query.ts';
import { createDbWriter } from './lib-db-write.ts';
import { buildSavedIndex, SAVED_INDEX_FILE } from './lib-saved-index.ts';
import { listTrashRecords } from './lib-trash-capture.ts';
import { drainInbox } from './lib-db-inbox.ts';
import { applyPendingReplacements } from './lib-db-replaces.ts';
import { compactInbox } from './lib-db-inbox-compact.ts';
import { inboxNewDir, ensureInboxDirs } from '../../../native-host/inbox.mts';
import { parseJsonLoose } from './lib-json.ts';
import { writeFileAtomicSync } from './lib-atomic.ts';
import { TRASH_SUBDIR, resolveInSaveFolder } from './lib-save-folder-path.ts';
// Save-folder relocation engine (copy+catch-up → flip → verified cleanup → sweep).
import { relocateLibrary } from './lib-migrate.ts';
// Subsystems extracted from this file (#227) — mechanical moves, logic unchanged.
// Each module's header states what it took and what it deliberately left behind;
// what remains here is the assembly plus the record pipeline every part of it
// shares (config → DB → inbox → renderer).
import { configDir, defaultLibraryDir, installer, pixivRefererFor, downloadAvatar, clearAllBlockReason } from './native-host.ts';
import { readConfig, writeConfig, getSaveFolder, readSavePointer, initSaveFolderRedundancy, isConfigCorrupt, invalidateConfigCache, saveFolderStatus } from './lib-config.ts';
import { mimeForFile, registerImageProtocol } from './lib-thumbnails.ts';
import { backupIntervalMs, createBackupEngine, latestRestorableSnapshot, readBackupConfig, readIntegrityStatus, validateBackupDir, validateSaveFolder, writeBackupConfig } from './lib-backup.ts';
import { APP_ICON, DEV_ORIGIN, DEV_SERVER_URL, createWindow, devServer, getWin, installNavigationGuards, sendToOtherWins, sendToWin, sendWindowToBack } from './lib-window.ts';
import { installDevRendererCsp, registerAppProtocol } from './app-protocol.ts';
import { runMlSmoke } from './ml-smoke.ts';
import { stopMlRuntime } from './lib-ml-runtime.ts';
// IPC handler modules, extracted from this file (mechanical move — logic unchanged).
// Each exposes register(ctx); ctx is built after the core functions below and passed
// in at the top-level registration site (see registerExtractedIpc, before whenReady).
import * as ipcOrganize from './ipc-organize.ts';
import * as ipcPosts from './ipc-posts.ts';
import * as ipcConfig from './ipc-config.ts';
import * as ipcWindow from './ipc-window.ts';
import * as ipcTrash from './ipc-trash.ts';
import * as ipcBackup from './ipc-backup.ts';
import * as ipcTransfer from './ipc-transfer.ts';
import * as ipcTagVocab from './ipc-tag-vocab.ts';
import * as ipcWatchImport from './ipc-watch-import.ts';
import { createWatchImportManager } from './lib-watch-import.ts';
import type { IpcContext } from './ipc-context.ts';

// Pin userData to the SAME directory the native host reads its config from, so
// the bridge (plain Node, spawned by Chrome) and this app always agree.
// Must run before app is ready.
app.setPath('userData', configDir());

// Keep diagnostics next to the configuration shared with the native host, rather
// than Electron's AppData default. MSIX storage virtualization can otherwise make
// the log appear in a different location from the configuration it describes.
log.transports.file.resolvePathFn = () => path.join(configDir(), 'logs', 'main.log');
// We own the preload bridge, so electron-log must not register a second preload
// script for every session. app/src/preload/index.ts imports electron-log/preload instead.
log.initialize({ preload: false });
log.errorHandler.startCatching({ showDialog: false });

// A rejected ELECTRON_RENDERER_URL is reported HERE rather than in lib-window.ts,
// which resolves it: that module's body runs before the lines above, so the same
// warning written there would land in electron-log's default file instead of the
// log this app keeps beside its config (#381 / #227).
if (process.env.ELECTRON_RENDERER_URL && devServer.rejected) {
  log.warn('Ignoring ELECTRON_RENDERER_URL, loading the bundled renderer', { reason: devServer.rejected });
}

// The two custom schemes this app serves, declared in ONE call: Electron
// requires registerSchemesAsPrivileged to run before ready and to be called only
// once, so a second registration site is not an option (a new scheme goes in
// this array).
//   asset:// — images and video from the (arbitrary) save folder, so the
//     renderer can lazy-load them by filename without disabling webSecurity or
//     holding every image in JS memory. Handler: lib-thumbnails.ts.
//   app://   — the built renderer itself (#7). Handler: app-protocol.ts, which
//     also says why neither scheme gets corsEnabled.
protocol.registerSchemesAsPrivileged([
  { scheme: 'asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// --- Config ---
// config.json reads/writes, the corruption guard and the redundant save-folder
// pointer were extracted to ./lib-config.ts (imported above).

// Watch .hologram-inbox/new (#5 St6 / #299) — the ONE thing that writes into the
// library from outside the app. Since #302 there is no second watcher on the save
// folder itself: nothing writes per-post JSON there any more (#298 moved in-app
// edits to the DB, #299 routed native-host saves through this queue), so watching
// the folder for record changes would be watching for something that can no longer
// happen. Media files DO still land there, but they arrive as part of an inbox
// envelope and are visible through it.
//
// Any change here is worth a full reconcile rather than a targeted one: drainInbox
// is cheap to re-run (already-applied events cost one indexed SELECT each —
// lib-db-inbox.ts's module comment), and an inbox filename isn't a safe per-event
// hint (a rename FROM tmp/, a mid-write partial, or a segment-compaction removal
// could all fire here). Directory created first (design comment: "at startup,
// create the inbox directory first, then set up the watcher") so the watch target always exists.
// Consumes any pending `replaces` marker (#34) — the duplicate-save warning's
// "replace" answer, which the native host can only write down (write-once) and
// the app has to carry out. Drains the inbox first, because the record that
// carries the marker is normally still sitting in it. Never throws: a
// replacement that cannot be finished leaves its marker set and is retried on
// the next pass, which is strictly better than failing whatever asked.
async function sweepReplacements() {
  const folder = getSaveFolder();
  const trashDir = getTrashDir();
  if (!folder || !trashDir) return;
  const handle = ensurePostsSynced();
  if (!handle) return;
  try {
    const report = await applyPendingReplacements({ sqlite: handle.sqlite, folder, trashDir, mediaExts: LIBRARY_MEDIA_EXTS });
    for (const r of report.applied) log.info(`replaced capture ${r.oldId} with ${r.newId} (#34) — the old capture is in the trash`);
    for (const f of report.failed) log.warn(`replacement ${f.oldId} -> ${f.newId} failed, will retry: ${f.error}`);
    // The badge index still names the retired capture until it is rebuilt.
    if (report.applied.length) scheduleSavedIndexWrite(handle);
  } catch (err) {
    log.error('replacement sweep failed:', err);
  }
}

let inboxWatcher: FSWatcher | null = null;
let inboxWatchDebounce: any = null;
// chokidar (#11), not fs.watch: cross-platform normalization and a single
// rename-detection story instead of chasing platform-specific fs.watch quirks
// ourselves. This directory only ever holds files arriving into the inbox, so
// depth: 0 (this dir's own entries, no recursion) is enough, and
// ignoreInitial matches fs.watch's behavior of never firing for what was
// already there when the watch started.
function watchInboxFolder() {
  if (inboxWatcher) {
    const closing = inboxWatcher;
    void closing.close().catch(() => {
      /* already closed */
    });
    inboxWatcher = null;
  }
  const folder = getSaveFolder();
  if (!folder) return;
  // #37: never mkdir the save folder back into existence here. getSaveFolder()
  // returns an EXPLICIT config value verbatim even when nothing is there any
  // more (moved/renamed/unmounted outside the app) — before this check,
  // ensureInboxDirs below unconditionally recreated the folder (plus its empty
  // .hologram-inbox tree) on every launch, which is exactly the "looks like a
  // fresh empty library" failure this Issue exists to stop. Skip the watch
  // entirely; refreshLibraryStatus() is what surfaces this to the renderer.
  if (!fs.existsSync(folder)) {
    log.warn('save folder is missing — not watching or recreating it', { folder });
    return;
  }
  try {
    ensureInboxDirs(folder);
    inboxWatcher = chokidar.watch(inboxNewDir(folder), { depth: 0, ignoreInitial: true });
    inboxWatcher.on('all', () => {
      clearTimeout(inboxWatchDebounce);
      inboxWatchDebounce = setTimeout(() => {
        // The sweep runs BEFORE the event so the renderer's refetch already
        // sees the replacement settled — otherwise a "replace" save would show
        // both records for one refresh cycle and then quietly lose one.
        void sweepReplacements().finally(() => {
          // null = full reconcile — see the function comment for why this
          // watcher never tries to ship a targeted hint.
          sendToWin('posts-changed', null);
        });
      }, 400);
    });
  } catch (err) {
    console.error('Failed to watch inbox folder:', err);
  }
}

// --- Posts (DB-backed, #5) ---
// The renderer's post array comes from SQLite (lib-db-query.ts): a cold launch is
// a SELECT, not tens of thousands of readFileSync+JSON.parse calls. Since #302
// there is no folder scan left at all — the DB is the truth source, so reading it
// needs no reconciliation against disk first, and the only intake that has to be
// picked up is the inbox queue (drainInbox, one indexed SELECT per already-applied
// event).
//
// hologram.db lives in configDir, NOT the save folder: #5's design comments
// (2026-07-17 orphan-recovery comment, 2026-07-21 cloud-sync-unfriendly note)
// already assume the live DB is never naively copied by a folder-level sync —
// putting the single-writer file inside a save folder a user points at a
// cloud-synced directory (exactly what #95/#101 warn about) would defeat that
// assumption on day one. thumb-cache sits in configDir for the same "local,
// not portable with the library" reason.

// Copies the newest DB generation over `file` if one exists — called only when
// `file` is about to be created fresh (missing, or corrupt-and-just-deleted) so a
// real restore point wins over an empty database. There is no on-disk fallback
// truth source to re-derive from any more, so a generation — when one exists — is
// strictly better than empty. #299's inbox replay (ensurePostsSynced's
// drainInboxLogged) then catches up whatever happened after the snapshot, and
// #301's orphan synthesis (run-orphan-recovery) can recover what neither the
// snapshot nor the inbox saw. (latestRestorableSnapshot is lib-backup.ts's: it
// prefers the library's own generation store and falls back to a backup
// destination's copy of it — #233.)
function restoreFromSnapshotIfAvailable(file: string): boolean {
  const snapshot = latestRestorableSnapshot();
  if (!snapshot || !fs.existsSync(snapshot)) return false;
  try {
    fs.copyFileSync(snapshot, file);
    log.warn(`restored hologram.db from DB generation: ${snapshot}`);
    return true;
  } catch (err) {
    log.error('failed to restore DB snapshot:', err);
    return false;
  }
}

// #37: the current save-folder status (missing on disk or not) for the
// renderer's get-library-status IPC — a fresh saveFolderStatus() read on every
// call, not a cached flag. The renderer re-invokes this at boot and after a
// retry/repoint, which is all "detection" this module does; there is no
// dedicated poll (fs.watch does not notice a directory disappearing anyway).
function refreshLibraryStatus() {
  const status = saveFolderStatus();
  if (status.missing) log.warn('save folder is missing', { folder: status.folder });
  return { missing: status.missing, path: status.folder };
}
// Live check for write-guards (clear-all / import* / relocate) — a fresh
// statSync, not the cached push above, so a drive that comes back mid-session
// (remounted, folder restored) unblocks writes without requiring a restart.
function isLibraryMissing() {
  return saveFolderStatus().missing;
}

let dbHandle: { db: any; sqlite: any } | null = null;
// One name for the live database file, because more than one caller needs it now
// (#233's rollback replaces it wholesale).
function dbFile() {
  return path.join(configDir(), 'hologram.db');
}
// Closes the live handle and forgets it, so the next ensureDb() opens whatever
// is on disk. Only #233's rollback calls this mid-session: it swaps the file
// underneath, which an open connection would neither see nor tolerate.
function closeDb() {
  try {
    dbHandle?.sqlite.close();
  } catch (err) {
    log.warn('could not close the database cleanly:', err);
  }
  dbHandle = null;
}
function ensureDb() {
  if (dbHandle) return dbHandle;
  const file = dbFile();
  if (!fs.existsSync(file)) restoreFromSnapshotIfAvailable(file);
  try {
    dbHandle = openDatabase(file);
  } catch (err) {
    if (!(err instanceof DatabaseCorruptError)) throw err;
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.rmSync(file + suffix, { force: true });
      } catch {
        /* best-effort */
      }
    }
    restoreFromSnapshotIfAvailable(file);
    dbHandle = openDatabase(file);
  }
  migratePosterKeyHost(dbHandle.sqlite);
  return dbHandle;
}

function getDbWriter() {
  return createDbWriter(ensureDb().sqlite);
}

// The bridge's other half of the "saved" badge (#5 St6 / #299 — see
// bridge.cts's "Saved-post index" comment): a small postKey->captureId map
// rebuilt from the DB and written to configDir, NOT the save folder (so it never
// lands next to the library's media). Debounced + atomic (tmp + rename);
// best-effort because a stale/missing file just makes the bridge fall back
// further to its journal + loose-inbox rescan, never wrong, only slower to
// reflect an app-side change.
let savedIndexTimer: any = null;
// Set once ensurePostsSynced has primed the snapshot for this process (#466):
// without it, a launch that drains nothing from the inbox and recovers no
// orphans never calls scheduleSavedIndexWrite at all, so the bridge answers
// saved-status queries from its journal + loose-inbox fallback indefinitely
// even though the DB itself has the record.
let savedIndexPrimed = false;
// Wired to the backup engine's noteLibraryMutation once that exists (further
// down — it needs this pipeline, so it cannot be constructed above it). This
// function is the single funnel every library change already passes through
// (an inbox drain, a trash operation, an import, an orphan recovery), which
// makes it the honest place for the backup lanes to learn that something
// changed: the media lane starts its "right after the save" countdown and the
// DB lane counts toward its next generation (#233).
let onLibraryMutation: (() => void) | null = null;
function scheduleSavedIndexWrite(handle: { sqlite: any }) {
  onLibraryMutation?.();
  clearTimeout(savedIndexTimer);
  savedIndexTimer = setTimeout(async () => {
    try {
      // The trash half (#158) comes off the filesystem, not the DB: a trashed
      // post has no posts row at all. listTrashRecords is what the trash view
      // itself reads with, so a planted record is normalized here too (#324).
      // A trash folder that cannot be read yields no notices rather than
      // failing the whole write — the saved half is the more important one.
      const trashDir = getTrashDir();
      const trash = trashDir ? (await listTrashRecords(trashDir)).map((r) => ({ captureId: r.captureId, url: r.url, trashedAt: r.trashedAt })) : [];
      const data = buildSavedIndex(handle.sqlite, trash);
      const dir = configDir();
      fs.mkdirSync(dir, { recursive: true });
      writeFileAtomicSync(path.join(dir, SAVED_INDEX_FILE), JSON.stringify(data));
    } catch {
      /* best-effort — the bridge falls back to journal + loose-inbox scanning */
    }
  }, 1500);
}

// Drains .hologram-inbox/new into the DB (#5 St6 / #299) — one receipted,
// transactional apply per envelope, loose files kept afterward (see
// lib-db-inbox.ts). Logs whatever it skipped (missing media, a hash/post
// conflict, a corrupt or unknown-version envelope) so a stuck capture is
// diagnosable; never throws — drainInbox itself never lets one bad file stop
// the rest, and a synchronous fs error here (folder briefly unavailable) just
// means this pass found nothing, not a reason to fail the caller's sync.
function drainInboxLogged(folder: string, sqlite: any) {
  try {
    const report = drainInbox(folder, sqlite);
    // Names the captureIds that actually reached the library (#519). Only
    // skips and failures were logged before, so "the save succeeded but the
    // post is not in the library" had no record on this side at all — and the
    // host's own `bridge/ok` line in capture.log stops at "written to disk".
    // The captureId is what joins the two logs; a save's whole path is
    // therefore readable across them, which is why this stays in main.log
    // rather than being appended to a file another process owns.
    if (report.applied.length) log.info(`inbox applied ${report.applied.length}: ${report.applied.join(' ')}`);
    for (const s of report.skipped) log.warn(`inbox drain skipped ${s.file}: ${s.reason}${s.detail ? ` (${s.detail})` : ''}`);
    if (report.segmentsReplayed.length) log.info(`inbox replayed ${report.segmentsReplayed.length} segment(s) with no DB receipt yet (DB-loss recovery path)`);
    scheduleInboxCompaction(folder, sqlite);
    return report;
  } catch (err) {
    log.error('inbox drain failed:', err);
    return { scanned: 0, applied: [], receiptOnly: [], noop: 0, skipped: [], segmentsReplayed: [] };
  }
}

// Idle-time compaction (#5 St6 / #299 design comment, "retention volume and
// compaction"): debounced like scheduleSnapshot/scheduleSavedIndexWrite so a burst of
// saves triggers it once, after things settle, rather than on every single
// drain. compactInbox itself no-ops below its 1,000-loose-event threshold, so
// calling this after every drain costs one COUNT-equivalent query in the
// common case.
let compactionTimer: any = null;
function scheduleInboxCompaction(folder: string, sqlite: any) {
  clearTimeout(compactionTimer);
  compactionTimer = setTimeout(() => {
    try {
      const report = compactInbox(folder, sqlite);
      if (report.compacted) log.info(`inbox compacted ${report.eventCount} event(s) into segment ${report.segmentId}`);
    } catch (err) {
      log.error('inbox compaction failed:', err);
    }
  }, 1500);
}

// Opens the DB and drains the intake queue — everything that has to happen
// before the posts table can be considered current. Returns the open handle
// (null if no save folder is set yet). Write handlers share this because a
// post-level DB write assumes its captureId already has a posts row, and an IPC
// call is not guaranteed to arrive after the renderer's own first listPosts().
function ensurePostsSynced() {
  const folder = getSaveFolder();
  if (!folder) return null;
  const handle = ensureDb();
  // Prime the snapshot regardless of whether this pass finds anything to
  // drain — buildSavedIndex is two indexed SELECTs, cheap enough to run
  // unconditionally on every launch rather than tracking file freshness
  // against the DB's last write.
  if (!savedIndexPrimed) {
    savedIndexPrimed = true;
    scheduleSavedIndexWrite(handle);
  }
  const inboxReport = drainInboxLogged(folder, handle.sqlite);
  if (inboxReport.applied.length) scheduleSavedIndexWrite(handle);
  return handle;
}
async function listPosts() {
  const handle = ensurePostsSynced();
  if (!handle) return { saveFolder: null, posts: [] };
  const posts = await postsFromDb(handle.sqlite);
  return { saveFolder: getSaveFolder(), posts };
}

// Delta variant for the renderer. Serializing all ~9k records over IPC on every
// refresh costs ~450ms, so the window holds the full set and main ships only
// added/updated/removed records. `haveBaseline` is the renderer asserting it still
// holds the last full set; when either side lacks one (cold main, folder switch, or
// a renderer that reloaded and lost its cache) we resend a full snapshot and both
// sides re-sync.
//
// One shape, no hints: reading every post is a single SELECT now, so the delta is
// always computed against a fresh full read and is always reliable. Before #302
// this branched on an fs-watch filename hint, because the alternative was
// re-reading tens of thousands of sidecars to find out what moved — the hint
// existed to avoid a cost the DB doesn't have.
//
// #32 St1 (highest-priority correctness fix in the design doc): this baseline used
// to be ONE `_deltaFolder`/`_lastSent` pair for the whole process, which was fine
// while there was only ever one renderer calling in. With a second window it silently
// broke — window B's delta call would overwrite window A's "what did I last see"
// bookkeeping, so A's NEXT call computed its delta against B's baseline instead of
// its own and could drop updates it was never actually shown. Keyed by the calling
// webContents' id instead, so two windows polling in the same tick can never step on
// each other; an entry is dropped when its window closes (see the
// 'web-contents-created' listener below) so this never grows unbounded across a
// session with many opened/closed windows.
interface DeltaBaseline {
  folder: string | null;
  lastSent: Map<string, unknown>; // captureId -> updatedAt last delivered to THIS renderer
}
const _deltaBySender = new Map<number, DeltaBaseline>();
async function listPostsDelta(haveBaseline: boolean, senderId: number) {
  const folder = getSaveFolder();
  if (!folder) {
    _deltaBySender.delete(senderId);
    return { saveFolder: null, full: true, posts: [] };
  }
  const handle = ensurePostsSynced();
  if (!handle) return { saveFolder: null, full: true, posts: [] };

  const posts = await postsFromDb(handle.sqlite);
  const stamps = new Map<string, unknown>(posts.map((p: any) => [p.captureId, p.updatedAt]));
  const baseline = _deltaBySender.get(senderId);
  if (!haveBaseline || !baseline || baseline.folder !== folder) {
    _deltaBySender.set(senderId, { folder, lastSent: stamps });
    return { saveFolder: folder, full: true, posts };
  }
  const { added, removed } = computeDelta(baseline.lastSent, posts, stamps);
  _deltaBySender.set(senderId, { folder, lastSent: stamps });
  return { saveFolder: folder, full: false, added, removed };
}
// Every webContents this process ever creates (every window, plus the standalone
// image-viewer popup — harmless, it never calls list-posts-delta) is watched here so
// a closed window's entry above is dropped rather than kept forever.
app.on('web-contents-created', (_e, contents) => {
  contents.once('destroyed', () => _deltaBySender.delete(contents.id));
});

// #29: cross-tab full-text search. Read-only over the same synced DB listPosts
// uses — no separate sync path, so a hit is never staler than the grid itself.
// The renderer decides which posts match (services/fulltext.ts runs the same
// matcher the in-tab quick search uses, over fields posts_fts does not index
// yet — #288); this only supplies bm25() relevance order for whichever of
// those hits posts_fts also covers.
async function searchFullText(query: string, limit?: number) {
  const handle = ensurePostsSynced();
  if (!handle) return [];
  return searchPostsFts(handle.sqlite, query, limit);
}

// --- Native host registration (idempotent, on each launch) ---
function ensureHostRegistered() {
  try {
    // Always (re)write the launcher: install() now routes a non-ASCII Electron
    // path through an ASCII directory junction (see native-host/install.js), so
    // refreshing on every launch is safe and self-heals an old broken launcher
    // that pointed straight at a mangled non-ASCII path. extensionId is read
    // from config by install() when present.
    installer.install({ exe: process.execPath, runAsNode: true });
  } catch (err) {
    console.error('Failed to register native messaging host:', err);
  } finally {
    // install() can write config.json without going through writeConfig (#61 —
    // install.cts persistExtensionId). No id is passed here, so today it never
    // does; drop the cache regardless, so the cache's correctness does not rest
    // on an argument at a call site far from lib-config.ts.
    invalidateConfigCache();
  }
}

// --- Image protocol ---
// The asset:// handler, the mime table and the thumbnail pool/cache behind ?w=N
// were extracted to ./lib-thumbnails.ts (registered via registerImageProtocol
// below, which takes resolveInFolder from here).

// --- IPC ---
// Config / prefs / tabs handlers (get-config / get-extension-contact / get-prefs /
// set-pref / app-info / get-tabs / set-tabs / window-control) were extracted to
// ./ipc-config.js (registered via ipcConfig.register below).

// Posts handlers (list-posts / list-posts-delta / image-data-url) were extracted to
// ./ipc-posts.js (registered via ipcPosts.register below).

// Organization-layer handlers (tag-types / ungrouped / manual-groups /
// folders / collections / poster-folders / poster-tags) were extracted to
// ./ipc-organize.js (registered via registerOrganize(ipcCtx) below).

// Window / shell handlers (open-external / open-image-window) were extracted to
// ./ipc-window.js (registered via ipcWindow.register below).

// --- File helpers (all confined to the save folder) ---
// The rule itself (which shapes a name may take, and the containment check on
// what it resolves to) lives in lib-save-folder-path.ts — Electron-free, so it is
// unit-testable and so the inbox drain and the trash sweep share the SAME copy.
//
// What stays here is the binding to the live save folder: this is the rule EVERY
// file handler shares (image-data-url, the trash sweeps, drag-out), so the
// already-bound form belongs to the assembly that hands it to all of them rather
// than to the first caller.
function resolveInFolder(name: string): string | null {
  return resolveInSaveFolder(getSaveFolder(), name);
}

// Every extension a downloaded library file can carry. NOT a "can the viewer
// show it" list: a pixiv ugoira archive is a .zip nothing displays directly
// (#119 St3), and it belongs here because the sweeps below enumerate a
// capture's files — one missed extension leaves an orphan behind.
const LIBRARY_MEDIA_EXTS = ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'avif', 'svg', 'mp4', 'webm', 'mov', 'm4v', 'zip'];

// Recover the captureId base from a filename. The argument may be the primary
// image (<base>.<ext>), a poster (<base>-poster.<ext>), or the media file
// itself. Strip the -poster marker first, then any extension.
function baseOf(name) {
  return path
    .basename(name || '')
    .replace(/-poster\.[a-z0-9]+$/i, '')
    .replace(/\.[a-z0-9]+$/i, '');
}

// --- Trash (soft delete) ---
// TRASH_SUBDIR is imported, not declared here: the directory this writes into and
// the directory resolveInFolder will serve out of have to be the same one (#267).
const TRASH_DAYS = 30;
function getTrashDir() {
  const folder = getSaveFolder();
  return folder ? path.join(folder, TRASH_SUBDIR) : null;
}
// Delete items in trash older than TRASH_DAYS. Called at startup.
async function purgeOldTrash() {
  const trashDir = getTrashDir();
  if (!trashDir) return;
  let names: string[];
  try {
    names = await fs.promises.readdir(trashDir);
  } catch {
    return;
  }
  const cutoff = Date.now() - TRASH_DAYS * 86400000;
  const toPurge = new Set();
  for (const f of names) {
    if (!f.toLowerCase().endsWith('.json')) continue;
    const id = f.slice(0, -5);
    try {
      const rec = parseJsonLoose(await fs.promises.readFile(path.join(trashDir, f), 'utf8'));
      if (rec.trashedAt && Date.parse(rec.trashedAt) < cutoff) toPurge.add(id);
    } catch {
      /* corrupt sidecar — skip */
    }
  }
  if (!toPurge.size) return;
  for (const f of names) {
    for (const id of toPurge) {
      if (f.startsWith(id + '.') || f.startsWith(id + '-')) {
        try {
          await fs.promises.unlink(path.join(trashDir, f));
        } catch {}
        break;
      }
    }
  }
  // An expired record's "it is in the trash" notice has to expire with it
  // (#158): the post is gone for good now, and the index is the only thing the
  // bridge reads. Nothing else would rewrite it — this pass touches no DB row.
  // Guarded because purgeOldTrash is fire-and-forget (a startup timer, nothing
  // awaits it), so a database that will not open must not surface here as an
  // unhandled rejection — the files are already gone either way.
  try {
    scheduleSavedIndexWrite(ensureDb());
  } catch {
    /* the index keeps the stale notice until the next write; the purge itself stands */
  }
}

// Trash + tag-mutation handlers (delete-post / list-trash / restore-post / empty-trash /
// delete-from-trash / update-tags) were extracted to ./ipc-trash.js (registered via
// ipcTrash.register below).

// Transfer handlers (import-legacy-zip / clear-all / export-save / export-complete /
// import-complete) were extracted to ./ipc-transfer.js (registered via ipcTransfer.register
// below); exportStamp moved there too.

// --- Backup ---
// The two-lane engine, its schedule, the destination validators and the #301
// integrity pass were extracted to ./lib-backup.ts. The engine is instantiated
// here because it needs the record pipeline above (a run must sync the DB
// before it snapshots it or counts orphans against it).
const { runBackup, listDbGenerations, rollbackDbGeneration, armBackupSchedule, runStartupIntegrityCheck, runOrphanRecovery, noteLibraryMutation } = createBackupEngine({ ensurePostsSynced, scheduleSavedIndexWrite, send: sendToWin, dbFile, closeDb });
onLibraryMutation = noteLibraryMutation;
const watchImport = createWatchImportManager({ readConfig, writeConfig, getSaveFolder, isLibraryMissing, ensurePostsSynced, send: sendToWin });

// --- Window ---
// Bounds persistence, the navigation lockdown and createWindow were extracted to
// ./lib-window.ts, which also owns the `win` binding (getWin / sendToWin).

// --- Extracted IPC registration ---
// The handlers below used to be inline ipcMain.handle(...) calls in this file. They
// were moved to ./ipc-*.js modules verbatim; each exposes register(ctx). We build one
// ctx exposing the core helpers/state the handlers close over and register them here,
// at the same top-level point (before whenReady) the inline handlers ran — ipcMain.handle
// has no ordering dependency on app-ready, and keeping registration top-level avoids
// racing an early renderer IPC. Mutable state (win, config-corrupt flag, delta) is
// exposed via accessors, never by value, so the closures read the live binding.
// The annotation is the point (#228): `IpcContext` (./ipc-context.ts) is what
// every register(ctx) is typed against, so a helper renamed or reshaped here is
// a build error rather than a runtime one on the boundary that carries
// clear-all / import-complete / move-save-folder.
function registerExtractedIpc() {
  const ctx: IpcContext = {
    getSaveFolder,
    getDbWriter,
    ensurePostsSynced,
    scheduleSavedIndexWrite,
    sweepReplacements,
    listPosts,
    listPostsDelta,
    searchFullText,
    resolveInFolder,
    mimeForFile,
    readConfig,
    writeConfig,
    invalidateConfigCache,
    APP_ICON,
    getTrashDir,
    baseOf,
    LIBRARY_MEDIA_EXTS,
    readBackupConfig,
    writeBackupConfig,
    validateBackupDir,
    armBackupSchedule,
    runBackup,
    listDbGenerations,
    rollbackDbGeneration,
    readIntegrityStatus,
    runOrphanRecovery,
    readSavePointer,
    clearAllBlockReason,
    getLibraryStatus: refreshLibraryStatus,
    isLibraryMissing,
    pixivRefererFor,
    downloadAvatar,
    validateSaveFolder,
    relocateLibrary,
    watchInboxFolder,
    watchImportFolders: () => watchImport.refresh(),
    getWatchImportConfig: () => ({ folders: watchImport.folders(), status: watchImport.status() }),
    setWatchImportFolders: async (folders, markExisting = []) => {
      const result = await watchImport.setFolders(folders, markExisting);
      return { folders: result.folders, status: result.status };
    },
    getWin,
    isConfigCorrupt,
    resetDelta: () => {
      _deltaBySender.clear();
    },
    send: sendToWin,
    sendExcept: sendToOtherWins,
    // #32 St1: the tabs.json guard (ipc-config.ts's get-tabs/set-tabs) — only the
    // PRIMARY window's sender may read or write it, so this is a no-op check, not a
    // per-call-site branch a future caller could forget.
    isPrimarySender: (webContentsId) => getWin()?.webContents.id === webContentsId,
    openNewWindow: () => {
      createWindow(true, { secondary: true });
    },
  };
  ipcOrganize.register(ctx);
  ipcPosts.register(ctx);
  ipcConfig.register(ctx);
  ipcWindow.register(ctx);
  ipcWatchImport.register(ctx);
  ipcTrash.register(ctx);
  ipcBackup.register(ctx);
  ipcTransfer.register(ctx);
  ipcTagVocab.register(ctx);
}
registerExtractedIpc();

// Side-effect-free launch check: skips host registration, hides the window,
// and quits once the renderer has loaded. Run with HOLOGRAM_SMOKE=1.
const SMOKE = process.env.HOLOGRAM_SMOKE === '1';

// The harnesses look up controls by their Japanese labels, and the language they
// get is normally the machine's: the 'auto' language pref resolves through
// navigator.language (src/renderer/src/services/i18n.ts). So the same suite that
// passes on a Japanese development machine went red on an en-US CI runner, and the
// English UI reads as missing controls rather than as a different language. Pin it
// for harness runs; HOLOGRAM_LANG overrides for a run that wants the other one.
// Must be set before the app is ready, which is why it lives here.
//
// HOLOGRAM_LANG is honored on its own, not only under SMOKE, because the Playwright
// suite (e2e/) reads the same labels off a VISIBLE window — it launches through the
// sandbox path, not the smoke one, and would otherwise get the runner's language.
const HARNESS_LANG = process.env.HOLOGRAM_LANG || (SMOKE ? 'ja' : '');
if (HARNESS_LANG) app.commandLine.appendSwitch('lang', HARNESS_LANG);

// Sandbox verify instance (scripts/sandbox-app.cts): a visible, persistent
// second instance on an isolated HOLOGRAM_CONFIG_DIR. Unlike SMOKE it stays
// interactive, but like SMOKE it must never touch machine-shared state — host
// registration would point the real Chrome's HKCU manifest entry at the
// sandbox config dir and break real captures.
const SANDBOX = process.env.HOLOGRAM_SANDBOX === '1';

// Single instance: a second launch focuses the existing window instead of
// opening a duplicate (which would fight over the shared userData/cache).
// Skipped under SMOKE so isolated headless test runs never block each other.
const gotSingleInstanceLock = SMOKE || app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  if (!SMOKE) {
    app.on('second-instance', () => {
      // #32 St1: a second launch opens ANOTHER window rather than only focusing the
      // first one (design: "2回目起動＝新規ウィンドウを開く") — UNLESS this run was
      // itself started minimized/inactive (a verification harness restart), where the
      // old "surface what's already running" behavior is still what is wanted: a new
      // window would leave the original invisible and defeat the harness's "did the
      // restart bring the window back" check.
      const launchedHidden = process.env.HOLOGRAM_START_MINIMIZED === '1' || process.env.HOLOGRAM_START_INACTIVE === '1';
      if (launchedHidden) {
        const w = getWin();
        if (w) {
          if (w.isMinimized()) w.restore();
          w.show();
          w.focus();
        }
        return;
      }
      createWindow(true, { secondary: true });
    });
  }

  app.whenReady().then(() => {
    // Bind the taskbar/Alt-Tab identity to the appId so Windows shows our window
    // icon (not electron.exe's) in dev too. electron-builder sets this for the
    // installed exe; setting it here covers the HologramLaunch dev run.
    app.setAppUserModelId('com.hologram.app');
    log.eventLogger.startLogging();
    log.info('Starting Hologram', { packaged: app.isPackaged, version: app.getVersion() });
    // Recover/refresh the redundant save-folder pointer FIRST, so the rest of startup
    // (watcher, listPosts, native host) sees a config repaired from the pointer rather
    // than the empty default when config was truncated. (2026-06-23 incident.)
    initSaveFolderRedundancy();
    // #37: log the initial verdict once at boot — refreshLibraryStatus() itself
    // is called again by the renderer's get-library-status on mount, so this is
    // observability only (main.log), not the source of truth the UI reads.
    refreshLibraryStatus();
    // Fresh install (no explicit save folder): make sure the default library dir
    // exists so folder/tag writes don't fail before the first capture. Explicit
    // user-picked folders are left untouched.
    try {
      if (!readConfig().saveFolder) fs.mkdirSync(defaultLibraryDir(), { recursive: true });
    } catch {
      /* ignore */
    }
    // Dev server and sandbox runs never capture, so skip host registration —
    // no HKCU writes and no native-host copy into the shared ~/.hologram.
    if (!SMOKE && !SANDBOX && !DEV_SERVER_URL) ensureHostRegistered();
    // Before createWindow: the window's very first load IS an app:// request.
    registerAppProtocol();
    registerImageProtocol({ resolveInFolder });
    // Prod serves the renderer's CSP on the app:// response itself; dev gets the
    // same policy pinned onto the Vite dev server's responses (renderer-csp.ts).
    installDevRendererCsp(DEV_ORIGIN);
    installNavigationGuards();
    const startMin = !SMOKE && process.env.HOLOGRAM_START_MINIMIZED === '1';
    // Verification launches (the sandbox second instance, a restart driven from a
    // session) must not interrupt whatever the user is doing on screen. Minimizing
    // is not an option here: the window has to keep compositing so CSS transitions
    // and real layout are observable, which is the whole reason a verify run opens
    // a window instead of using the SMOKE hidden one.
    const startInactive = !SMOKE && !startMin && process.env.HOLOGRAM_START_INACTIVE === '1';
    createWindow(!SMOKE && !startMin && !startInactive); // both → create hidden, then show without activating below
    // A sandbox seeded from the real library (#286) holds a snapshot of real post
    // text and, when a capture was pinpointed, real media — so anything captured
    // from this window is personal data. The notice is drawn INSIDE the page
    // rather than printed to the console, because a screenshot has to carry it;
    // re-applied on every load so a renderer reload cannot drop it.
    if (SANDBOX && process.env.HOLOGRAM_SANDBOX_NOTICE && getWin()) {
      const notice = process.env.HOLOGRAM_SANDBOX_NOTICE;
      (getWin() as BrowserWindow).webContents.on('did-finish-load', () => {
        const w = getWin();
        if (!w || w.isDestroyed()) return;
        w.webContents
          .executeJavaScript(
            `(() => { const id = 'hologram-sandbox-notice'; const old = document.getElementById(id); if (old) old.remove();
               const el = document.createElement('div'); el.id = id; el.textContent = ${JSON.stringify(notice)};
               el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;pointer-events:none;background:#b3261e;color:#fff;font:12px/1.7 system-ui,sans-serif;text-align:center';
               document.body.appendChild(el); })()`,
          )
          .catch((err) => log.warn('could not install the sandbox notice', { error: err.message }));
      });
    }
    watchInboxFolder();
    void watchImport.refresh();
    // #34: a "replace" answered while the app was closed is only a marker on the
    // new record until now — this is where it becomes the replacement. Outside
    // the SMOKE guard below and ahead of purgeOldTrash: the capture it retires
    // should start its 30 trash days today, and the harness that proves the
    // app-closed path works boots in exactly that mode.
    setTimeout(() => void sweepReplacements(), 1500);
    if (!SMOKE) {
      armBackupSchedule(); // start the interval schedule
      // Startup catch-up: run once if more than the interval has passed since last time (the run missed while closed).
      const bk = readBackupConfig();
      if (bk.dir && bk.interval) {
        const last = bk.lastRunAt ? Date.parse(bk.lastRunAt) : 0;
        if (!last || Date.now() - last >= backupIntervalMs(bk)) setTimeout(() => runBackup('startup-overdue'), 4000);
      }
      setTimeout(() => purgeOldTrash(), 6000); // expire old trash entries on startup
      // Startup integrity check (#301): needs to work even when backup isn't configured, so
      // it opens the DB itself independent of runBackup (runBackup early-returns on !b.dir
      // and never opens the DB).
      setTimeout(() => runStartupIntegrityCheck(), 5000);
    }

    if (SMOKE) {
      const shot = process.env.HOLOGRAM_SMOKE_SHOT;
      (getWin() as BrowserWindow).webContents.on('console-message', (_e, level, message) => {
        console.log(`[renderer:${level}] ${message}`);
      });
      let done = false;
      const quit = (tag) => {
        if (done) return;
        done = true;
        console.log(tag);
        app.quit();
      };
      (getWin() as BrowserWindow).webContents.once('did-finish-load', () =>
        setTimeout(async () => {
          // #831: one local inference through the utilityProcess runtime, with
          // the window kept busy at the same time. ml-smoke.ts says why the
          // check has to run inside the real app.
          if (process.env.HOLOGRAM_ML_SMOKE_MODEL) {
            try {
              console.log('ML_SMOKE_RESULT', JSON.stringify(await runMlSmoke(process.env.HOLOGRAM_ML_SMOKE_MODEL, getWin())));
            } catch (e) {
              console.log('ML_SMOKE_ERR', e.message);
            }
          }
          if (process.env.HOLOGRAM_SMOKE_EVAL) {
            try {
              const r = await (getWin() as BrowserWindow).webContents.executeJavaScript(process.env.HOLOGRAM_SMOKE_EVAL);
              console.log('EVAL_RESULT', JSON.stringify(r));
            } catch (e) {
              console.log('EVAL_ERR', e.message);
            }
          }
          if (shot) {
            try {
              const img = await (getWin() as BrowserWindow).webContents.capturePage();
              fs.writeFileSync(shot, img.toPNG());
            } catch (err) {
              console.error('capture failed:', err);
            }
          }
          quit('SMOKE_OK');
        }, 1300),
      );
      // Backstop for a renderer that never answers, not a budget for the eval: the
      // eval scripts carry their own waitFor timeouts, so a real hang still ends here
      // while a legitimately long flow (multi-step UI harnesses) is not cut off
      // mid-run — which reads as "no eval result" and is easy to misread as a bug.
      // 25s was too close to be that backstop: the nightly Windows runner put
      // test-app-import-dedup (3.6s locally, no waits of its own — just ZIP imports over
      // the runner's disk) straight into SMOKE_TIMEOUT, and test-app-image-zoom against
      // the same wall (#818). A hang still ends well inside run-app-tests.cts's own 120s
      // spawn timeout; the slow-but-honest run now finishes instead of being cut off.
      setTimeout(() => quit('SMOKE_TIMEOUT'), 60000);
      return;
    }

    // Start minimized when launched on the user's behalf, WITHOUT stealing focus or
    // flashing the taskbar button: show inactive (no focus → no FlashWindowEx), then
    // minimize and explicitly clear any pending attention flash. (A normal launch
    // opens a focused window.)
    if (startMin && getWin()) {
      (getWin() as BrowserWindow).once('ready-to-show', () => {
        const w = getWin() as BrowserWindow;
        w.showInactive();
        w.minimize();
        w.flashFrame(false);
      });
    }

    // Start visible but behind whatever the user already has open. showInactive()
    // covers only half of that — it skips activation, but the window still lands on
    // top of the z-order, measured on Windows 11. That is upstream's settled
    // position, not a bug: "showInactive() should maintain the Z order" was closed
    // as wontfix (electron#9941), and Electron exposes moveTop() with no counterpart.
    // So the window is pushed down through the Win32 call Windows provides for it.
    if (startInactive && getWin()) {
      (getWin() as BrowserWindow).once('ready-to-show', () => {
        const w = getWin() as BrowserWindow;
        w.showInactive();
        w.flashFrame(false);
        sendWindowToBack(w);
      });
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try {
    dbHandle?.sqlite.close();
  } catch {
    /* already closed, or never opened this run */
  }
  // A utilityProcess is not a child of the app's exit path; left alone it can
  // outlive the window it was started for (#831).
  stopMlRuntime();
});
