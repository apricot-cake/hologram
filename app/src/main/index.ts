'use strict';

import { app, BrowserWindow, protocol, nativeImage, nativeTheme, screen } from 'electron';
import log from 'electron-log/main';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { openDatabase, DatabaseCorruptError } from './lib-db.ts';
import { computeDelta } from './lib-post-delta.ts';
import { postsFromDb } from './lib-db-query.ts';
import { createDbWriter } from './lib-db-write.ts';
// ⚠️ Scaffolding — the one-time pre-#5 library migration (#441).
import { LEGACY_INTERNAL_FILES, migrateLegacyLibrary } from './lib-legacy-import.ts';
import { buildSavedIndex, SAVED_INDEX_FILE } from './lib-saved-index.ts';
import { drainInbox } from './lib-db-inbox.ts';
import { compactInbox } from './lib-db-inbox-compact.ts';
import { snapshotDatabase } from './lib-db-snapshot.ts';
import { checkOrphans, synthesizeOrphanRecords } from './lib-db-integrity.ts';
import { inboxNewDir, ensureInboxDirs, INBOX_DIRNAME } from '../../../native-host/inbox.mts';
import { pruneDecision, nextBaseline } from './backup-guard.ts';
import { resolveDevServerUrl } from './dev-server-guard.ts';
import { parseJsonLoose } from './lib-json.ts';
// Save-folder relocation engine (copy+catch-up → flip → verified cleanup → sweep).
import { relocateLibrary } from './lib-migrate.ts';
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

// CJS require + __dirname reconstructed for ESM. native-host/ modules are loaded by
// computed path (dev sibling vs packaged resource), so they stay dynamic CJS requires.
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// native-host/ lives outside app/. In dev, electron-vite emits this file to
// app/out/main/index.js, so native-host (a repo-root sibling of app/) is three
// levels up. When packaged it is bundled as an extraResource under resources/native-host.
const nativeHostDir = app.isPackaged ? path.join(process.resourcesPath, 'native-host') : path.join(__dirname, '..', '..', '..', 'native-host');
const { configDir, defaultLibraryDir } = require(path.join(nativeHostDir, 'paths.cts'));
const installer = require(path.join(nativeHostDir, 'install.cts'));
// Best-effort avatar download for import-posts (same SSRF guard/caps as capture,
// same shared avatars/ store — downloadAvatar dedupes by avatar URL).
//
// media-download.cts requires the npm package undici. In dev, requiring the raw
// source resolves it fine (repo-root node_modules), so dev keeps requiring the
// source directly — edit-and-restart needs no rebuild. But electron-builder
// copies native-host/ as a raw extraResource with no node_modules, so a packaged
// build must require the pre-bundled copy (undici inlined) that
// app/build-native-host-bridge.mjs produces at native-host/dist/media-download.js
// — requiring the raw source there crashed on startup with "Cannot find module
// 'undici'".
const mediaDownloadPath = app.isPackaged ? path.join(nativeHostDir, 'dist', 'media-download.js') : path.join(nativeHostDir, 'media-download.cts');
const { pixivRefererFor, downloadAvatar } = require(mediaDownloadPath);
// Save-folder resolution + clear-all gating. Shared with the native host (which
// must resolve the SAME save folder), so it lives alongside paths.cts in native-host/.
const { resolveSaveFolder, clearAllBlockReason } = require(path.join(nativeHostDir, 'config-recovery.cts'));

// Holographic app icon (iridescent square). Used for the taskbar/window icon at
// runtime; electron-builder converts the same PNG to .ico for the installed exe.
// out/main/index.js -> out -> app/, where assets/ sits alongside out/ (both dev
// and packaged: electron-builder's `files` ships out/** and assets/** at the same
// relative depth from the package root).
const APP_ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');

// Pin userData to the SAME directory the native host reads its config from, so
// the bridge (plain Node, spawned by Chrome) and this app always agree.
// Must run before app is ready.
app.setPath('userData', configDir());

const CONFIG_PATH = path.join(configDir(), 'config.json');

// Keep diagnostics next to the configuration shared with the native host, rather
// than Electron's AppData default. MSIX storage virtualization can otherwise make
// the log appear in a different location from the configuration it describes.
log.transports.file.resolvePathFn = () => path.join(configDir(), 'logs', 'main.log');
// We own the preload bridge, so electron-log must not register a second preload
// script for every session. app/src/preload/index.ts imports electron-log/preload instead.
log.initialize({ preload: false });
log.errorHandler.startCatching({ showDialog: false });

// Custom scheme to serve images from the (arbitrary) save folder. Lets the
// renderer lazy-load images by filename without disabling webSecurity or
// loading every image into JS memory.
protocol.registerSchemesAsPrivileged([{ scheme: 'asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

let win: BrowserWindow | null = null;

// --- Config ---
// True iff the LAST readConfig() found config.json present-but-unparseable. Lets
// destructive ops (clear-all) refuse to run on top of a degraded config.
let configLastCorrupt = false;
function readConfig() {
  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch {
    configLastCorrupt = false;
    return {}; // no config yet (fresh install) — absence is not corruption
  }
  try {
    const cfg = parseJsonLoose(raw);
    configLastCorrupt = false;
    return cfg;
  } catch {
    // Corrupt config (e.g. a truncation from a pre-atomic-write forced kill).
    // PRESERVE it instead of letting the caller silently overwrite it with {} —
    // a truncated config that reads as {} and is then re-written loses
    // saveFolder/extensionId/backup at once. Keep a copy for recovery/forensics.
    configLastCorrupt = true;
    try {
      if (raw && raw.length) fs.copyFileSync(CONFIG_PATH, `${CONFIG_PATH}.corrupt-${Date.now()}`);
    } catch {
      /* best-effort */
    }
    return {};
  }
}

// Redundant save-folder pointer: a tiny file written ALONGSIDE config.json holding
// just the save-folder path. config.json carrying the only copy of saveFolder is
// what let one truncation drop the library to the empty default; this independent
// file survives that and lets getSaveFolder() recover instead of silently switching.
const SAVE_POINTER_PATH = () => path.join(configDir(), 'saveFolder.path');
function writeSavePointer(folder) {
  if (typeof folder !== 'string' || !folder.trim()) return;
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    const tmp = SAVE_POINTER_PATH() + '.tmp';
    fs.writeFileSync(tmp, folder, 'utf8');
    fs.renameSync(tmp, SAVE_POINTER_PATH()); // atomic, independent of config.json
  } catch {
    /* best-effort redundancy */
  }
}
function readSavePointer() {
  try {
    const p = fs.readFileSync(SAVE_POINTER_PATH(), 'utf8').trim();
    return p || null;
  } catch {
    return null;
  }
}
function dirExists(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Atomic write: a forced kill or crash mid-write must NEVER leave a truncated
// config.json. Write to a tmp file, fsync, then rename over the target — readers
// only ever see the complete old or complete new file. (Non-atomic writeFileSync
// truncated config.json on a forced kill → readConfig() returned {} → the next
// write persisted {} → saveFolder/extensionId/backup were lost at once. That
// cascade is what made a library "disappear".) Mirrors lib-index's snapshot write.
function writeConfig(cfg) {
  fs.mkdirSync(configDir(), { recursive: true });
  const tmp = `${CONFIG_PATH}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(cfg, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, CONFIG_PATH);
  // Keep the redundant pointer in lockstep with whatever save folder we just wrote.
  if (cfg && typeof cfg.saveFolder === 'string' && cfg.saveFolder.trim()) writeSavePointer(cfg.saveFolder);
}

// Explicit config wins; otherwise recover from the redundant pointer before falling
// back to the shared default library dir (same resolution as the bridge's
// readSaveFolder). Never returns null — a fresh install uses defaultLibraryDir().
// The pointer is only consulted when config has no saveFolder (degraded/fresh), so
// the common path stays a single config read with no extra file I/O.
function getSaveFolder() {
  const folder = readConfig().saveFolder;
  if (typeof folder === 'string' && folder.trim()) return folder;
  const ptr = readSavePointer();
  return resolveSaveFolder({
    configSaveFolder: folder,
    pointer: ptr,
    pointerExists: ptr ? dirExists(ptr) : false,
    defaultDir: defaultLibraryDir(),
  }).folder;
}

// Once at startup: keep the redundant pointer fresh for an existing install, and —
// if config LOST its saveFolder (corruption) but the pointer still resolves to a
// real library — write it back into config so the value is durable and the native
// host (which reads config independently) stays in sync rather than diverging.
function initSaveFolderRedundancy() {
  const cfg = readConfig();
  if (typeof cfg.saveFolder === 'string' && cfg.saveFolder.trim()) {
    writeSavePointer(cfg.saveFolder);
    return;
  }
  const ptr = readSavePointer();
  if (ptr && dirExists(ptr)) {
    try {
      writeConfig(Object.assign({}, cfg, { saveFolder: ptr }));
    } catch {
      /* best-effort recovery */
    }
  }
}

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
// could all fire here). Directory created first (design comment: "起動時にinbox
// ディレクトリを作ってから watcher を張り") so the watch target always exists.
let inboxWatcher: import('node:fs').FSWatcher | null = null;
let inboxWatchDebounce: any = null;
function watchInboxFolder() {
  if (inboxWatcher) {
    try {
      inboxWatcher.close();
    } catch {
      /* already closed */
    }
    inboxWatcher = null;
  }
  const folder = getSaveFolder();
  if (!folder) return;
  try {
    ensureInboxDirs(folder);
    inboxWatcher = fs.watch(inboxNewDir(folder), () => {
      clearTimeout(inboxWatchDebounce);
      inboxWatchDebounce = setTimeout(() => {
        // null = full reconcile — see the function comment for why this
        // watcher never tries to ship a targeted hint.
        if (win && !win.isDestroyed()) win.webContents.send('posts-changed', null);
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
// Where runBackup's DB snapshot lands (#301) — a dedicated subfolder under the
// mirror root, same "don't dump into dest's top level" convention INBOX_DIRNAME
// already follows there. Read here (restore) and written in runBackup
// (snapshot); kept as one function so the two never drift apart.
function dbSnapshotPath(backupDir: string) {
  return path.join(backupDest(backupDir), 'hologram-db', 'hologram.db');
}

// Copies the latest DB snapshot over `file` if one exists — called only when
// `file` is about to be created fresh (missing, or corrupt-and-just-deleted) so a
// real restore point wins over an empty database. There is no on-disk fallback
// truth source to re-derive from any more, so a snapshot — when one exists — is
// strictly better than empty. #299's inbox replay (ensurePostsSynced's
// drainInboxLogged) then catches up whatever happened after the snapshot, and
// #301's orphan synthesis (run-orphan-recovery) can recover what neither the
// snapshot nor the inbox saw.
function restoreFromSnapshotIfAvailable(file: string): boolean {
  const b = readBackupConfig();
  if (!b.dir) return false;
  const snapshot = dbSnapshotPath(b.dir);
  if (!fs.existsSync(snapshot)) return false;
  try {
    fs.copyFileSync(snapshot, file);
    log.warn(`restored hologram.db from mirror snapshot: ${snapshot}`);
    return true;
  } catch (err) {
    log.error('failed to restore DB snapshot:', err);
    return false;
  }
}

let dbHandle: { db: any; sqlite: any } | null = null;
function ensureDb() {
  if (dbHandle) return dbHandle;
  const file = path.join(configDir(), 'hologram.db');
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
  return dbHandle;
}

function getDbWriter() {
  return createDbWriter(ensureDb().sqlite);
}

// ⚠️ Scaffolding — remove before release together with lib-legacy-import.ts
// (#441). Runs at most once per database: a library predating #5 still
// has its metadata as per-post sidecar + organization JSON on disk, and this is
// the only thing left that reads that format. A release-time install finds
// nothing and stamps truthSource straight away.
function ensureDbTruthSource(folder: string, handle: { db: any; sqlite: any }) {
  if (getDbWriter().stateGet('truthSource') === 'db') return;
  const report = migrateLegacyLibrary({ folder, sqlite: handle.sqlite, backupRoot: path.join(configDir(), 'db-migration-backups'), trashSubdir: TRASH_SUBDIR });
  if (report.sidecarCount) log.info(`legacy library migrated: ${report.sidecarCount} sidecar(s) -> ${report.dbPostCount} post row(s); old JSON preserved at ${report.backupPath}`);
  for (const f of report.parseFailures) log.warn(`legacy migration skipped ${f.file}: ${f.error}`);
  getDbWriter().stateSet('truthSource', 'db');
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
function scheduleSavedIndexWrite(handle: { sqlite: any }) {
  clearTimeout(savedIndexTimer);
  savedIndexTimer = setTimeout(() => {
    try {
      const data = buildSavedIndex(handle.sqlite);
      const dir = configDir();
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, SAVED_INDEX_FILE);
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
      fs.renameSync(tmp, file);
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
    for (const s of report.skipped) log.warn(`inbox drain skipped ${s.file}: ${s.reason}${s.detail ? ` (${s.detail})` : ''}`);
    if (report.segmentsReplayed.length) log.info(`inbox replayed ${report.segmentsReplayed.length} segment(s) with no DB receipt yet (DB-loss recovery path)`);
    scheduleInboxCompaction(folder, sqlite);
    return report;
  } catch (err) {
    log.error('inbox drain failed:', err);
    return { scanned: 0, applied: [], receiptOnly: [], noop: 0, skipped: [], segmentsReplayed: [] };
  }
}

// Idle-time compaction (#5 St6 / #299 design comment, "保持量とコンパクショ
// ン"): debounced like scheduleSnapshot/scheduleSavedIndexWrite so a burst of
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

// Opens the DB, applies the one-time legacy migration if this database has never
// seen it, and drains the intake queue — everything that has to happen before the
// posts table can be considered current. Returns the open handle (null if no save
// folder is set yet). Write handlers share this because a post-level DB write
// assumes its captureId already has a posts row, and an IPC call is not
// guaranteed to arrive after the renderer's own first listPosts().
function ensurePostsSynced() {
  const folder = getSaveFolder();
  if (!folder) return null;
  const handle = ensureDb();
  ensureDbTruthSource(folder, handle);
  // Prime the snapshot once truthSource is confirmed 'db', regardless of
  // whether this pass finds anything to drain — buildSavedIndex is two
  // indexed SELECTs, cheap enough to run unconditionally on every launch
  // rather than tracking file freshness against the DB's last write.
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
let _deltaFolder: string | null = null;
let _lastSent = new Map<string, unknown>(); // captureId -> updatedAt last delivered to the renderer
async function listPostsDelta(haveBaseline: boolean) {
  const folder = getSaveFolder();
  if (!folder) {
    _deltaFolder = null;
    _lastSent = new Map();
    return { saveFolder: null, full: true, posts: [] };
  }
  const handle = ensurePostsSynced();
  if (!handle) return { saveFolder: null, full: true, posts: [] };

  const posts = await postsFromDb(handle.sqlite);
  const stamps = new Map<string, unknown>(posts.map((p: any) => [p.captureId, p.updatedAt]));
  if (!haveBaseline || _deltaFolder !== folder) {
    _deltaFolder = folder;
    _lastSent = stamps;
    return { saveFolder: folder, full: true, posts };
  }
  const { added, removed } = computeDelta(_lastSent, posts, stamps);
  _lastSent = stamps;
  return { saveFolder: folder, full: false, added, removed };
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
  }
}

// --- Image protocol ---
// Screenshots are JPEG; downloaded original media may be png/webp/gif.
const EXT_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.zip': 'application/zip', // pixiv うごイラ archive (#119 St3) — fetched by the player, never rendered
};
function mimeForFile(name) {
  return EXT_MIME[path.extname(name || '').toLowerCase()] || 'application/octet-stream';
}

// Thumbnails: the image-view tile grid downscaled full-resolution originals
// (multi-MB pixiv/X art) into ~180px cells, which made scrolling stutter as the
// GPU decoded every full image. Instead serve a resized JPEG via asset://…?w=N,
// generated once with Electron's built-in nativeImage and cached on disk
// (keyed by name + mtime + width, so re-migration invalidates it). The
// full-resolution original is still served when no ?w= is given (lightbox/viewer).
const THUMB_EXT = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif', '.avif', '.svg']);
function thumbCacheDir() {
  return path.join(configDir(), 'thumb-cache');
}

// nativeImage decode/resize/toJPEG is synchronous and runs on the main process's
// single JS thread. The tile grid fires many asset?w= requests at once when first
// scrolling into uncached cells; left unbounded they execute back-to-back as one
// long synchronous burst that starves every other IPC/UI message (first-scroll
// stutter). Funnel the heavy generation through a small pool that yields to the
// event loop (setImmediate) between jobs so the main thread keeps breathing, and
// coalesce concurrent identical requests so each tile is decoded at most once.
const THUMB_POOL = 2;
let _thumbRunning = 0;
const _thumbQueue: any[] = [];
const _thumbInflight = new Map(); // cachePath -> Promise<Buffer|null>
function _pumpThumbs() {
  while (_thumbRunning < THUMB_POOL && _thumbQueue.length) {
    const job = _thumbQueue.shift();
    _thumbRunning++;
    setImmediate(async () => {
      try {
        job.resolve(await job.fn());
      } catch {
        job.resolve(null);
      } finally {
        _thumbRunning--;
        _pumpThumbs();
      }
    });
  }
}
function runThumbJob(fn) {
  return new Promise((resolve) => {
    _thumbQueue.push({ fn, resolve });
    _pumpThumbs();
  });
}

async function getThumbnail(resolved, name, w) {
  if (!THUMB_EXT.has(path.extname(name).toLowerCase())) return null;
  let st: any;
  try {
    st = await fs.promises.stat(resolved);
  } catch {
    return null;
  }
  // q3: resize by the SHORT edge (not width). Tiles are square + object-fit:cover, so the
  // short edge is what maps to the tile. Resizing by width made wide images (e.g. 1920x1080)
  // become 180x101, which then got upscaled vertically into the square tile → heavy blur.
  const key = `${name}.${Math.round(st.mtimeMs)}.w${w}.q3.jpg`.replace(/[^\w.-]/g, '_');
  const cachePath = path.join(thumbCacheDir(), key);
  try {
    return await fs.promises.readFile(cachePath);
  } catch {
    /* cache miss */
  }
  // Coalesce: if this exact tile is already being generated, await that one job
  // instead of starting a duplicate decode (a full grid rebuild re-requests still-
  // visible tiles while the first decode is in flight).
  const pending = _thumbInflight.get(cachePath);
  if (pending) return pending;
  const job = runThumbJob(() => {
    let img = nativeImage.createFromPath(resolved);
    if (img.isEmpty()) return null;
    const sz = img.getSize();
    if (Math.min(sz.width, sz.height) > w) {
      img = sz.width >= sz.height ? img.resize({ height: w, quality: 'good' }) : img.resize({ width: w, quality: 'good' });
    }
    const buf = img.toJPEG(90);
    fs.promises
      .mkdir(thumbCacheDir(), { recursive: true })
      .then(() => fs.promises.writeFile(cachePath, buf))
      .catch(() => {
        /* cache best-effort */
      });
    return buf;
  });
  _thumbInflight.set(cachePath, job);
  try {
    return await job;
  } finally {
    _thumbInflight.delete(cachePath);
  }
}

function registerImageProtocol() {
  protocol.handle('asset', async (request) => {
    try {
      const folder = getSaveFolder();
      if (!folder) return new Response('No save folder', { status: 404 });

      const url = new URL(request.url);
      const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      if (!rel || rel === '.' || rel === '..') return new Response('Not found', { status: 404 });

      // Same containment rule as every file handler: basenames only, plus the
      // sanctioned 'avatars/<file>' subpath (shared avatar store). resolveInFolder
      // asserts the resolved path lands strictly INSIDE the save folder.
      const resolved = resolveInFolder(rel);
      if (!resolved) return new Response('Forbidden', { status: 403 });
      const name = path.basename(resolved);

      const w = Number.parseInt(url.searchParams.get('w') || '', 10);
      if (Number.isFinite(w) && w >= 64 && w <= 720) {
        const thumb = await getThumbnail(resolved, name, w);
        // Cache-key includes mtime+width, and capture filenames are content-stable
        // (unique captureId, written once) → immutable lets Chromium keep the
        // decoded bitmap and skip re-reads/re-decodes on scroll-back.
        if (thumb) return new Response(thumb, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' } });
        // fall through to the original if thumbnailing failed
      }

      const data = await fs.promises.readFile(resolved);
      return new Response(data, { headers: { 'content-type': mimeForFile(name), 'cache-control': 'public, max-age=31536000, immutable' } });
    } catch {
      return new Response('Error', { status: 500 });
    }
  });
}

// --- IPC ---
// Config / prefs / tabs handlers (get-config / set-extension-id / get-prefs / set-pref /
// app-info / get-tabs / set-tabs / window-control) were extracted to
// ./ipc-config.js (registered via ipcConfig.register below).

// Posts handlers (list-posts / list-posts-delta / image-data-url) were extracted to
// ./ipc-posts.js (registered via ipcPosts.register below).

// Organization-layer handlers (tag-types / ungrouped / manual-groups /
// folders / collections / poster-folders / poster-tags) were extracted to
// ./ipc-organize.js (registered via registerOrganize(ipcCtx) below).

// Window / shell handlers (open-external / open-image-window) were extracted to
// ./ipc-window.js (registered via ipcWindow.register below).

// --- File helpers (all confined to the save folder) ---
// Capture files live FLAT in the save folder (basename only). The one sanctioned
// subfolder is the shared avatar store 'avatars/<file>' (single level, no deeper):
// anything else is squashed to its basename, and the resolved path must still
// land strictly inside the folder.
function resolveInFolder(name) {
  const folder = getSaveFolder();
  if (!folder || !name) return null;
  const rel = String(name).replace(/\\/g, '/');
  const m = rel.match(/^avatars\/([^/]+)$/);
  if (m && (m[1] === '.' || m[1] === '..')) return null;
  const safe = m ? path.join('avatars', m[1]) : path.basename(rel);
  const resolved = path.resolve(path.join(folder, safe));
  return resolved.startsWith(path.resolve(folder) + path.sep) ? resolved : null;
}

// Every extension a downloaded library file can carry. NOT a "can the viewer
// show it" list: a pixiv うごイラ archive is a .zip nothing displays directly
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
const TRASH_SUBDIR = '.trash';
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
}

// Trash + tag-mutation handlers (delete-post / list-trash / restore-post / empty-trash /
// delete-from-trash / update-tags) were extracted to ./ipc-trash.js (registered via
// ipcTrash.register below).

// Transfer handlers (import-posts / clear-all / export-save / export-complete /
// import-complete) were extracted to ./ipc-transfer.js (registered via ipcTransfer.register
// below); the JSZip lazy-require + exportStamp moved there too.

// --- バックアップ / 増分ミラー --------------------------------------------------
// 保存先フォルダ自体をクラウド同期フォルダに置くとライブ書き込み中の同期で壊れやすい。
// ここでは選択した「宛先フォルダ」の中に「写し（remote）」を保持する。
// アセットは immutable（一度書いたら変わらない）→ 宛先に無いファイルだけコピー(O(new))。
// 削除は宛先からも伝播（最新ミラー）。ZIP は手動エクスポート専用に残す。
// 宛先直下にぶちまけない安全策として専用サブフォルダに書く（下記 BACKUP_SUBDIR）。
const BACKUP_SUBDIR = 'Hologram-mirror';
function backupDest(dir) {
  return path.join(dir, BACKUP_SUBDIR);
}
// (LIBRARY_SUBDIR — the named subfolder for a relocated library — moved to
// ./ipc-transfer.js with the pick-save-folder handler that owns it.)

const BACKUP_DEFAULTS = {
  dir: null, // 出力先（保存先フォルダの内外と重複しないこと）
  interval: false, // 一定間隔
  intervalValue: 1, // 間隔の数
  intervalUnit: 'day', // 'day' | 'week' | 'month'
  lastRunAt: null,
  lastResult: null,
};
function readBackupConfig() {
  const b = readConfig().backup || {};
  return Object.assign({}, BACKUP_DEFAULTS, b);
}
function writeBackupConfig(patch) {
  const cfg = readConfig();
  cfg.backup = Object.assign({}, BACKUP_DEFAULTS, cfg.backup || {}, patch || {});
  writeConfig(cfg);
  return cfg.backup;
}

// Integrity-check status (#301) — kept OUT of BACKUP_DEFAULTS/backup config on
// purpose: the startup orphan/integrity_check pass must run and be visible
// even when no mirror `dir` is configured (that's the whole point of it being
// separate from the "daily reconciliation" pass that piggybacks on runBackup),
// so it cannot live inside a config object whose UI treats `dir` as the
// feature's on/off switch.
const INTEGRITY_DEFAULTS = {
  lastCheckAt: null,
  dbOk: null, // null = never checked yet
  orphanCount: 0,
  missingCount: 0,
};
function readIntegrityStatus() {
  return Object.assign({}, INTEGRITY_DEFAULTS, readConfig().integrity || {});
}
function writeIntegrityStatus(patch) {
  const cfg = readConfig();
  cfg.integrity = Object.assign({}, INTEGRITY_DEFAULTS, cfg.integrity || {}, patch || {});
  writeConfig(cfg);
  return cfg.integrity;
}

// The one shared DB<->media reconciliation pass (#301 design: "検出機構は
// #100の品目1と共用し二重実装しない") — called both at startup (independent
// of any backup config) and from runBackup (piggybacking the interval run as
// the "daily照合"). `knownFiles`, when passed, is runBackup's already-scanned
// srcSet — skips a second readdir of the save folder.
function runIntegrityPass(folder: string, sqlite: any, knownFiles?: Set<string>) {
  let dbOk = true;
  try {
    const check = sqlite.pragma('integrity_check', { simple: true });
    dbOk = check === 'ok';
    if (!dbOk) log.error(`integrity_check failed: ${check}`);
  } catch (err) {
    dbOk = false;
    log.error('integrity_check threw:', err);
  }
  const { orphanMedia, missingMedia } = checkOrphans(folder, sqlite, knownFiles);
  const status = writeIntegrityStatus({ lastCheckAt: new Date().toISOString(), dbOk, orphanCount: orphanMedia.length, missingCount: missingMedia.length });
  if (win && !win.isDestroyed()) win.webContents.send('integrity-check-done', status);
  return { dbOk, orphanMedia, missingMedia };
}

// Standalone startup check (armBackupSchedule() call site) — must work with no
// backup mirror configured, so it opens the DB itself rather than piggybacking
// on runBackup (which early-returns before opening anything when `!b.dir`).
async function runStartupIntegrityCheck() {
  const folder = getSaveFolder();
  if (!folder) return;
  try {
    // ensurePostsSynced (not raw ensureDb) — see runBackup's identical
    // reasoning: the DB must reflect disk state before orphans are computed,
    // and this timer can fire before the renderer's first listPosts() call.
    const handle = await ensurePostsSynced();
    if (!handle) return;
    runIntegrityPass(folder, handle.sqlite);
  } catch (err) {
    log.error('startup integrity check failed:', err);
  }
}

// Manual-trigger orphan recovery (#301 design: never automatic — see
// lib-db-integrity.ts's synthesizeOrphanRecords comment for why a save still
// mid-flight must never be misread as a permanent loss). Re-runs the
// integrity pass afterward so the visible orphanCount drops immediately.
async function runOrphanRecovery() {
  const folder = getSaveFolder();
  if (!folder) return { ok: false, error: 'not-configured' };
  const handle = await ensurePostsSynced();
  if (!handle) return { ok: false, error: 'not-configured' };
  const written = synthesizeOrphanRecords(folder, handle.sqlite);
  if (written.length) scheduleSavedIndexWrite(handle);
  runIntegrityPass(folder, handle.sqlite);
  return { ok: true, recovered: written.length };
}

function pathIsInside(child, parent) {
  const c = path.resolve(child),
    p = path.resolve(parent);
  return c === p || c.startsWith(p + path.sep);
}
// 出力先が保存先と入れ子/同一だと、出力→watch→再エクスポートのループや破壊が起きる。
function validateBackupDir(dir) {
  if (!dir) return { ok: true };
  const src = getSaveFolder();
  if (src && (pathIsInside(dir, src) || pathIsInside(src, dir))) return { ok: false, error: 'overlap' };
  return { ok: true };
}

// --- Save-folder relocation ---
// Reject a destination that would corrupt the library or loop: the current
// folder itself, anything nested with it (can't move a folder into its own
// child), the config dir, or the backup mirror. Last, prove it's writable.
function validateSaveFolder(dir) {
  if (!dir || typeof dir !== 'string' || !dir.trim()) return { ok: false, error: 'invalid' };
  const cur = getSaveFolder();
  if (path.resolve(dir) === path.resolve(cur)) return { ok: false, error: 'same' };
  if (pathIsInside(dir, cur) || pathIsInside(cur, dir)) return { ok: false, error: 'nested' };
  if (pathIsInside(dir, configDir()) || pathIsInside(configDir(), dir)) return { ok: false, error: 'config-overlap' };
  const b = readBackupConfig();
  if (b && b.dir && (pathIsInside(dir, b.dir) || pathIsInside(b.dir, dir))) return { ok: false, error: 'backup-overlap' };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.hologram-write-probe-${Date.now()}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
  } catch {
    return { ok: false, error: 'not-writable' };
  }
  return { ok: true };
}

let backupRunning = false;
async function runBackup(reason) {
  const b = readBackupConfig();
  const src = getSaveFolder();
  if (!src || !b.dir) return { ok: false, error: 'not-configured' };
  if (!validateBackupDir(b.dir).ok) return { ok: false, error: 'overlap' };
  if (backupRunning) return { ok: false, error: 'busy' };
  backupRunning = true;
  if (win && !win.isDestroyed()) win.webContents.send('backup-start'); // sidebar sync icon → syncing
  // written = new files copied; pruned = files deleted (propagated deletions)
  const result: any = { ok: true, reason: reason || 'manual', fileCount: 0, written: 0, pruned: 0 };
  try {
    const dest = backupDest(b.dir);
    await fs.promises.mkdir(dest, { recursive: true });

    // Collect source files, skipping the trash bucket and transient write artifacts.
    // Keep each file's mtime so the mirror copy can carry it over.
    let srcFiles: string[];
    try {
      srcFiles = await fs.promises.readdir(src);
    } catch {
      srcFiles = [];
    }
    const srcSet = new Set<string>();
    const srcStat = new Map<string, any>(); // name -> { size, mtimeMs }
    for (const f of srcFiles) {
      if (f === TRASH_SUBDIR) continue;
      if (/\.tmp(-\d+)?$/i.test(f)) continue;
      try {
        const st = await fs.promises.stat(path.join(src, f));
        if (st.isFile()) {
          srcSet.add(f);
          srcStat.set(f, { size: st.size, mtimeMs: st.mtimeMs });
        }
      } catch {
        /* skip inaccessible entries */
      }
    }
    // Shared avatar store (avatars/<urlhash>.<ext> — write-once, single level):
    // mirror it under the same relative names so a restore keeps author icons.
    // Collected as 'avatars/<f>' entries; path.join resolves the '/' on Windows.
    const collectSubdir = async (root, sub, into, stats) => {
      let names: string[] = [];
      try {
        names = await fs.promises.readdir(path.join(root, sub));
      } catch {
        return; // subfolder absent (pre-avatars library)
      }
      for (const f of names) {
        if (/\.tmp(-\d+)?$/i.test(f)) continue;
        try {
          const st = await fs.promises.stat(path.join(root, sub, f));
          if (st.isFile()) {
            into.add(`${sub}/${f}`);
            if (stats) stats.set(`${sub}/${f}`, { size: st.size, mtimeMs: st.mtimeMs });
          }
        } catch {
          /* skip inaccessible entries */
        }
      }
    };
    await collectSubdir(src, 'avatars', srcSet, srcStat);
    result.fileCount = srcSet.size;

    // Collect destination files
    // (.hologram-inbox mirroring happens further below, deliberately OUTSIDE
    // srcSet/destSet — see the comment there for why.)
    let destFiles: string[];
    try {
      destFiles = await fs.promises.readdir(dest);
    } catch {
      destFiles = [];
    }
    const destSet = new Set<string>(destFiles.filter((f) => !/\.tmp(-\d+)?$/i.test(f)));
    await collectSubdir(dest, 'avatars', destSet, null);

    // .hologram-inbox/{new,segments} (#5 St6 / #299): mirrored separately from
    // srcSet/destSet, NOT folded into the general file-count pruneDecision()
    // guard above — compaction can legitimately shrink the loose event count
    // by >50% in one run (1,000 loose -> 1 segment), which must never look
    // like the "src collapsed" signal that guard exists to catch
    // (backup-guard.ts's module comment, the 2026-06-23 library-loss
    // incident). tmp/ is excluded; both new/ and segments/ entries are
    // immutable (write-once, like avatars/) so "present at dest" is proof
    // enough — no drift-refresh needed.
    const srcInboxNew = new Set<string>();
    const destInboxNew = new Set<string>();
    const srcInboxSegments = new Set<string>();
    const destInboxSegments = new Set<string>();
    const collectInboxSubdir = async (root: string, sub: string, into: Set<string>) => {
      let names: string[] = [];
      try {
        names = await fs.promises.readdir(path.join(root, INBOX_DIRNAME, sub));
      } catch {
        return; // no inbox (or that subdir) yet
      }
      for (const f of names) {
        if (/\.tmp(-\d+)?$/i.test(f)) continue;
        try {
          const st = await fs.promises.stat(path.join(root, INBOX_DIRNAME, sub, f));
          if (st.isFile()) into.add(f);
        } catch {
          /* skip inaccessible entries */
        }
      }
    };
    await collectInboxSubdir(src, 'new', srcInboxNew);
    await collectInboxSubdir(src, 'segments', srcInboxSegments);
    await collectInboxSubdir(dest, 'new', destInboxNew);
    await collectInboxSubdir(dest, 'segments', destInboxSegments);

    const copyInboxMissing = async (sub: string, srcNames: Set<string>, destNames: Set<string>) => {
      if (!srcNames.size) return;
      await fs.promises.mkdir(path.join(dest, INBOX_DIRNAME, sub), { recursive: true });
      for (const f of srcNames) {
        if (destNames.has(f)) continue;
        const destFile = path.join(dest, INBOX_DIRNAME, sub, f);
        const tmp = `${destFile}.tmp-${Date.now()}`;
        try {
          await fs.promises.copyFile(path.join(src, INBOX_DIRNAME, sub, f), tmp);
          await fs.promises.rename(tmp, destFile);
          destNames.add(f);
          result.written++;
        } catch (e: any) {
          try {
            await fs.promises.unlink(tmp);
          } catch {}
          if (!result.firstError) result.firstError = e.message;
        }
      }
    };
    // segments first: the loose prune below depends on knowing which segments
    // already landed at dest THIS run.
    await copyInboxMissing('segments', srcInboxSegments, destInboxSegments);
    await copyInboxMissing('new', srcInboxNew, destInboxNew);

    // Copy files missing at dest; presence is proof enough. Everything the mirror
    // carries from the library is write-once — media, screenshots, avatars, inbox
    // segments — so a file that exists at dest can never have a newer version at
    // src. Until #302 this also had to re-copy the organization JSON on size/mtime
    // drift, because that layer was rewritten in place on every edit; it lives in
    // the DB now and reaches the mirror as the snapshot runBackup takes below.
    // The copy is atomic (tmp + rename) so a reader never sees a half-written file.
    if ([...srcSet].some((f) => f.startsWith('avatars/'))) {
      await fs.promises.mkdir(path.join(dest, 'avatars'), { recursive: true });
    }
    for (const f of srcSet) {
      if (destSet.has(f)) continue;
      const tmp = path.join(dest, f + '.tmp-' + Date.now());
      try {
        await fs.promises.copyFile(path.join(src, f), tmp);
        // Preserve mtime (floored to ms, the granularity utimes can set) so a
        // mirror restored back into place keeps the library's own timestamps.
        try {
          const s = srcStat.get(f);
          if (s) {
            const t = new Date(Math.floor(s.mtimeMs));
            await fs.promises.utimes(tmp, t, t);
          }
        } catch {
          /* best-effort */
        }
        await fs.promises.rename(tmp, path.join(dest, f));
        result.written++;
      } catch (e) {
        try {
          await fs.promises.unlink(tmp);
        } catch {}
        // Surface the first copy error but keep going for the rest
        if (!result.firstError) result.firstError = e.message;
      }
    }

    // Prune files present in dest but gone from src (deleted posts propagate) —
    // but refuse to mirror a suspicious collapse of src (backup-guard.js).
    // Baseline = the src count from the last run we TRUSTED (carried forward when
    // a run skipped, so one empty/partial blip can't poison the threshold).
    const prevSummary = b.lastResult || {};
    const baseline = Number(prevSummary.lastGoodCount) || Number(prevSummary.fileCount) || 0;
    const decision = pruneDecision({ srcCount: srcSet.size, destCount: destSet.size, baseline });
    if (decision.skip) {
      result.pruneSkipped = decision.reason;
      result.baselineCount = baseline;
    } else {
      for (const f of destSet) {
        if (!srcSet.has(f)) {
          try {
            await fs.promises.unlink(path.join(dest, f));
            result.pruned++;
          } catch {}
        }
      }
    }
    result.lastGoodCount = nextBaseline(decision.skip, srcSet.size, baseline);

    // Inbox loose prune: only once every currently-known src segment is ALSO
    // at dest this run — independent of the general pruneDecision() guard
    // above (which is scoped to srcSet/destSet and never sees inbox entries).
    // Local compaction only deletes a loose file after its segment is
    // verified + renamed + receipted (lib-db-inbox-compact.ts); mirroring
    // that same ordering here means a loose file's mirror copy is never
    // pruned before the segment that supersedes it is safely at dest too —
    // design comment: "対応する event を含む検証済み segment が同じミラーに
    // コピー済みの場合だけ許可する".
    if ([...srcInboxSegments].every((f) => destInboxSegments.has(f))) {
      for (const f of destInboxNew) {
        if (!srcInboxNew.has(f)) {
          try {
            await fs.promises.unlink(path.join(dest, INBOX_DIRNAME, 'new', f));
            result.pruned++;
          } catch {}
        }
      }
    }

    // DB snapshot (#301): the ONLY sanctioned way to mirror the live
    // hologram.db — #97 forbids a raw file copy of a live .db (see
    // lib-db-snapshot.ts's module comment). Piggybacks the daily
    // reconciliation onto this same run (#301 design: "日次照合に
    // integrity_checkを相乗り"), reusing srcSet this run already
    // enumerated so the orphan/missing scan costs no extra readdir.
    try {
      // ensurePostsSynced (not raw ensureDb) so the DB reflects whatever is
      // actually on disk right now before orphans are computed against it —
      // otherwise a backup firing before the renderer's first listPosts() ever
      // ran could see an empty posts table and flag every file as orphaned.
      const handle = await ensurePostsSynced();
      if (!handle) throw new Error('save folder unavailable');
      await snapshotDatabase(handle.sqlite, dbSnapshotPath(b.dir));
      const pass = runIntegrityPass(src, handle.sqlite, srcSet);
      result.orphanCount = pass.orphanMedia.length;
      result.missingCount = pass.missingMedia.length;
    } catch (e: any) {
      if (!result.firstError) result.firstError = e.message;
    }
  } catch (err) {
    result.ok = false;
    result.error = err.message;
  } finally {
    backupRunning = false;
  }
  const at = new Date().toISOString();
  const summary = {
    fileCount: result.fileCount,
    written: result.written,
    pruned: result.pruned,
    reason: result.reason,
    ok: result.ok,
    error: result.error || result.firstError || null,
    at: at,
    pruneSkipped: result.pruneSkipped || null,
    baselineCount: result.baselineCount || 0,
    lastGoodCount: typeof result.lastGoodCount === 'number' ? result.lastGoodCount : 0,
    orphanCount: result.orphanCount || 0,
    missingCount: result.missingCount || 0,
  };
  try {
    writeBackupConfig({ lastRunAt: at, lastResult: summary });
  } catch {
    /* ignore */
  }
  if (win && !win.isDestroyed()) win.webContents.send('backup-done', Object.assign({}, result, { at: at }));
  return result;
}

let backupIntervalTimer: any = null;
// Node の setInterval は 2^31-1 ms 超の delay を 1ms にクランプするため、
// 大きな間隔（week×4 以上・year など）を直接渡すと暴走する。
// 短い heartbeat（1分）で due を判定し、閾値を超えたときだけ実行する方式に変更。
const BACKUP_HEARTBEAT_MS = 60 * 1000;
function backupIntervalMs(b) {
  // 'year' は UI から廃止済みだが旧設定値の後方互換として残す
  const unitMs = { day: 86400000, week: 604800000, month: 2592000000, year: 31536000000 };
  return Math.max(60000, (Number(b.intervalValue) || 1) * (unitMs[b.intervalUnit] || unitMs.day));
}
function armBackupSchedule() {
  if (backupIntervalTimer) {
    clearInterval(backupIntervalTimer);
    backupIntervalTimer = null;
  }
  const b = readBackupConfig();
  if (!b.dir || !b.interval) return;
  backupIntervalTimer = setInterval(() => {
    const cur = readBackupConfig();
    if (!cur.dir || !cur.interval) return;
    const last = cur.lastRunAt ? Date.parse(cur.lastRunAt) : 0;
    if (Date.now() - last >= backupIntervalMs(cur)) runBackup('interval');
  }, BACKUP_HEARTBEAT_MS);
}

// Backup handlers (get-backup / set-backup / pick-backup-dir / run-backup) were
// extracted to ./ipc-backup.js (registered via ipcBackup.register below).

// Relocation + local-import handlers (pick-save-folder / import-images) were extracted
// to ./ipc-transfer.js (registered via ipcTransfer.register below); IMPORTABLE_* moved
// there too.

// --- Window size/position persistence ---
// The window was fixed at 1100x820 every launch. Save bounds to config.json
// (`windowBounds`) and restore them, clamped to a visible display so a
// disconnected monitor can't reopen the window off-screen.
let _boundsSaveTimer: any = null;
function persistWindowBounds() {
  clearTimeout(_boundsSaveTimer);
  _boundsSaveTimer = setTimeout(saveWindowBoundsNow, 400);
}
function saveWindowBoundsNow() {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
    const cfg = readConfig();
    cfg.windowBounds = { x: b.x, y: b.y, width: b.width, height: b.height, isMaximized: win.isMaximized() };
    writeConfig(cfg);
  } catch {
    /* best-effort */
  }
}
function savedWindowBounds() {
  const b = readConfig().windowBounds;
  if (!b || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width < 400 || b.height < 300) return null;
  try {
    const onScreen = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
    });
    // Off-screen (e.g. monitor unplugged) → keep the size, drop x/y so the OS centers it.
    if (!onScreen || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
      return { width: b.width, height: b.height, isMaximized: !!b.isMaximized };
    }
  } catch {
    /* screen module unavailable before ready — fall through to use as-is */
  }
  return { x: b.x, y: b.y, width: b.width, height: b.height, isMaximized: !!b.isMaximized };
}

// electron-vite's dev server (HMR + React Fast Refresh for the renderer). Set
// automatically by `electron-vite dev`; absent under `electron-vite build` (and
// under Claude's own build→relaunch verification loop, which never runs
// `electron-vite dev` — see docs/build.md). null in prod, so loadFile + the
// file:// navigation guard stand unchanged.
//
// The value is an environment variable and this window's preload hands out
// destructive IPC, so it goes through dev-server-guard rather than straight into
// loadURL: a packaged build ignores it outright, and in dev only an http: loopback
// address survives. Everything the guard rejects loads the bundled renderer (#381).
const devServer = resolveDevServerUrl(process.env.ELECTRON_RENDERER_URL, app.isPackaged);
const DEV_SERVER_URL = devServer.url;
if (process.env.ELECTRON_RENDERER_URL && devServer.rejected) {
  log.warn('Ignoring ELECTRON_RENDERER_URL, loading the bundled renderer', { reason: devServer.rejected });
}

// Navigation lockdown for every web-contents the app creates. Without it, a file
// (e.g. a local .html) dropped onto a window would make the top frame navigate to
// file://…, which inherits the same preload and could call destructive IPC
// (clear-all / import-complete / …). We:
//   - deny will-navigate to anything other than our own renderer (file://…/
//     renderer/index.html) or the asset:// image-viewer scheme. The initial
//     loadFile/loadURL does NOT fire will-navigate, so this never blocks startup.
//   - deny window.open / target=_blank entirely; external links are funneled
//     through the open-external IPC (shell.openExternal), which this leaves intact.
function installNavigationGuards() {
  const indexFile = path.resolve(__dirname, '..', 'renderer', 'index.html');
  // Derived from the guard's output, never from the raw environment variable, so a
  // rejected value cannot widen what will-navigate accepts (#381).
  const devOrigin = DEV_SERVER_URL ? new URL(DEV_SERVER_URL).origin : null;
  const isAllowedNavigation = (rawUrl) => {
    let u: URL;
    try {
      u = new URL(rawUrl);
    } catch {
      return false;
    }
    // The standalone image window lives on the app-controlled asset:// scheme.
    if (u.protocol === 'asset:') return true;
    // Dev only: allow navigations within the Vite dev server — its HMR client does
    // a full location.reload() on non-Fast-Refreshable edits, which would otherwise
    // be blocked here. devOrigin is null in prod, so this is a no-op there.
    if (devOrigin && u.origin === devOrigin) return true;
    // Our own renderer, reached by file path (ignore query/hash differences).
    if (u.protocol === 'file:') {
      try {
        return path.resolve(decodeURIComponent(u.pathname).replace(/^\//, '')) === indexFile;
      } catch {
        return false;
      }
    }
    return false;
  };
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedNavigation(url)) event.preventDefault();
    });
    // Deny all renderer-initiated new windows/tabs. External navigation is meant
    // to go through the open-external IPC, not a popup that inherits our preload.
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}

// --- Extracted IPC registration ---
// The handlers below used to be inline ipcMain.handle(...) calls in this file. They
// were moved to ./ipc-*.js modules verbatim; each exposes register(ctx). We build one
// ctx exposing the core helpers/state the handlers close over and register them here,
// at the same top-level point (before whenReady) the inline handlers ran — ipcMain.handle
// has no ordering dependency on app-ready, and keeping registration top-level avoids
// racing an early renderer IPC. Mutable state (win, config-corrupt flag, delta) is
// exposed via accessors, never by value, so the closures read the live binding.
function registerExtractedIpc() {
  const ctx = {
    getSaveFolder,
    getDbWriter,
    ensurePostsSynced,
    scheduleSavedIndexWrite,
    listPosts,
    listPostsDelta,
    resolveInFolder,
    mimeForFile,
    readConfig,
    writeConfig,
    installer,
    APP_ICON,
    getTrashDir,
    baseOf,
    LIBRARY_MEDIA_EXTS,
    // ⚠️ Scaffolding — clear-all's "don't delete these" list is only about JSON a
    // pre-#5 library can still have lying around; it goes with #441.
    LEGACY_INTERNAL_FILES,
    readBackupConfig,
    writeBackupConfig,
    validateBackupDir,
    armBackupSchedule,
    runBackup,
    readIntegrityStatus,
    runOrphanRecovery,
    readSavePointer,
    clearAllBlockReason,
    pixivRefererFor,
    downloadAvatar,
    validateSaveFolder,
    relocateLibrary,
    watchInboxFolder,
    getWin: () => win,
    getConfigLastCorrupt: () => configLastCorrupt,
    resetDelta: () => {
      _deltaFolder = null;
      _lastSent = new Map();
    },
    send: (channel, ...args) => {
      if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
    },
  };
  ipcOrganize.register(ctx);
  ipcPosts.register(ctx);
  ipcConfig.register(ctx);
  ipcWindow.register(ctx);
  ipcTrash.register(ctx);
  ipcBackup.register(ctx);
  ipcTransfer.register(ctx);
}
registerExtractedIpc();

// --- Window ---
function createWindow(show = true) {
  // Resolve the theme from config up front so the first paint (and the window's
  // backdrop) match it — no flash, and SMOKE captures reflect it. We pass the
  // PREF (auto/light/dark) to the page as a ?theme= query that theme.js reads
  // synchronously during <head>; 'auto' is resolved there via prefers-color-scheme
  // (which follows nativeTheme). For the backdrop we resolve 'auto' here too.
  const cfgTheme = readConfig().theme;
  const theme = ['auto', 'light', 'dark'].includes(cfgTheme) ? cfgTheme : 'auto';
  const dark = theme === 'dark' || (theme === 'auto' && nativeTheme.shouldUseDarkColors);
  const smoke = process.env.HOLOGRAM_SMOKE === '1';
  const sb = smoke ? null : savedWindowBounds();
  win = new BrowserWindow({
    width: (sb && sb.width) || 1100,
    height: (sb && sb.height) || 820,
    ...(sb && Number.isFinite(sb.x) ? { x: sb.x, y: sb.y } : {}),
    minWidth: 720,
    minHeight: 480,
    show,
    backgroundColor: dark ? '#0c0e12' : '#f6f7f9',
    title: 'Hologram',
    icon: APP_ICON,
    paintWhenInitiallyHidden: true,
    // No titleBarOverlay: the min/max/close buttons are app-drawn in the tab bar. The OS
    // overlay draws its strip on the browser process' own compositor, so its color could
    // never be synchronized with a web-layer change (a modal scrim) — it could only be
    // approximated per frame, which showed as a flicker. App-drawn buttons live in the same
    // frame as the scrim, so the whole class of mismatch is gone. The cost is the Windows 11
    // Snap Layouts flyout, which only appears for a real caption button (the OS asks the
    // window "is this point the maximize button?" and only the native overlay can say yes);
    // Discord/Figma/Spotify/Obsidian all sit on this side of the trade. Snap itself still
    // works everywhere else: Win+arrow, drag-to-edge, Win+Z.
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.removeMenu();
  // The app-drawn maximize button mirrors the real window state, which also changes without
  // the button (snap, double-click on the drag strip, Win+arrow, the taskbar), so push every
  // change rather than have the renderer poll.
  const sendMaximized = () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('window-maximized-changed', win.isMaximized());
  };
  win.on('maximize', sendMaximized);
  win.on('unmaximize', sendMaximized);
  if (!smoke) {
    if (sb && sb.isMaximized) win.maximize();
    // Remember size/position across launches (debounced on resize/move; flushed on close).
    win.on('resize', persistWindowBounds);
    win.on('move', persistWindowBounds);
    win.on('maximize', persistWindowBounds);
    win.on('unmaximize', persistWindowBounds);
    win.on('close', saveWindowBoundsNow);
  }
  // Pass smoke=1 so the renderer disables the offscreen render optimizations
  // (content-visibility / lazy images) that leave the hidden capture window blank.
  if (DEV_SERVER_URL) {
    // Dev: load the renderer from electron-vite's Vite dev server (HMR + Fast Refresh).
    // Built through URL rather than string concatenation so the query lands in the
    // query slot whatever shape the (already validated) dev URL has.
    const devUrl = new URL(DEV_SERVER_URL);
    devUrl.search = new URLSearchParams({ theme, ...(smoke ? { smoke: '1' } : {}) }).toString();
    win.loadURL(devUrl.href);
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query: { theme, ...(smoke ? { smoke: '1' } : {}) } });
  }
}

// Move a window to the bottom of the z-order without activating it. Only used by
// the HOLOGRAM_START_INACTIVE verify path below, so koffi is a devDependency and
// the require is deliberately lazy: a packaged build never reaches this line, and
// if it somehow does, the window just stays where it is instead of the app dying.
// HWND is passed as uintptr_t rather than void* — getNativeWindowHandle() returns
// a Buffer HOLDING the handle, and a void* parameter would pass the address of
// that buffer instead of the handle itself.
function sendWindowToBack(w: BrowserWindow): void {
  if (process.platform !== 'win32') return;
  const HWND_BOTTOM = 1;
  const SWP_NOSIZE = 0x0001;
  const SWP_NOMOVE = 0x0002;
  const SWP_NOACTIVATE = 0x0010;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const SetWindowPos = user32.func('__stdcall', 'SetWindowPos', 'bool', ['uintptr_t', 'uintptr_t', 'int', 'int', 'int', 'int', 'uint']);
    const hwnd = w.getNativeWindowHandle().readBigUInt64LE(0);
    const ok = SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
    if (!ok) log.warn('SetWindowPos(HWND_BOTTOM) returned false');
  } catch (err) {
    log.warn('could not send window to back', { error: (err as Error).message });
  }
}

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
      if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
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
    registerImageProtocol();
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
    if (SANDBOX && process.env.HOLOGRAM_SANDBOX_NOTICE && win) {
      const notice = process.env.HOLOGRAM_SANDBOX_NOTICE;
      win.webContents.on('did-finish-load', () => {
        if (!win || win.isDestroyed()) return;
        win.webContents
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
    if (!SMOKE) {
      armBackupSchedule(); // interval スケジュールを起動
      // 起動時の取り戻し: 前回から間隔以上空いていれば1回だけ実行（閉じている間に逃した分）。
      const bk = readBackupConfig();
      if (bk.dir && bk.interval) {
        const last = bk.lastRunAt ? Date.parse(bk.lastRunAt) : 0;
        if (!last || Date.now() - last >= backupIntervalMs(bk)) setTimeout(() => runBackup('startup-overdue'), 4000);
      }
      setTimeout(() => purgeOldTrash(), 6000); // expire old trash entries on startup
      // 起動時整合チェック（#301）: バックアップ未設定でも動く必要があるため
      // runBackup とは独立に自分でDBを開く（runBackupは!b.dirで早期return
      // してDBを開かない）。
      setTimeout(() => runStartupIntegrityCheck(), 5000);
    }

    if (SMOKE) {
      const shot = process.env.HOLOGRAM_SMOKE_SHOT;
      (win as BrowserWindow).webContents.on('console-message', (_e, level, message) => {
        console.log(`[renderer:${level}] ${message}`);
      });
      let done = false;
      const quit = (tag) => {
        if (done) return;
        done = true;
        console.log(tag);
        app.quit();
      };
      (win as BrowserWindow).webContents.once('did-finish-load', () =>
        setTimeout(async () => {
          if (process.env.HOLOGRAM_SMOKE_EVAL) {
            try {
              const r = await (win as BrowserWindow).webContents.executeJavaScript(process.env.HOLOGRAM_SMOKE_EVAL);
              console.log('EVAL_RESULT', JSON.stringify(r));
            } catch (e) {
              console.log('EVAL_ERR', e.message);
            }
          }
          if (shot) {
            try {
              const img = await (win as BrowserWindow).webContents.capturePage();
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
      setTimeout(() => quit('SMOKE_TIMEOUT'), 25000);
      return;
    }

    // Start minimized when launched on the user's behalf, WITHOUT stealing focus or
    // flashing the taskbar button: show inactive (no focus → no FlashWindowEx), then
    // minimize and explicitly clear any pending attention flash. (A normal launch
    // opens a focused window.)
    if (startMin && win) {
      win.once('ready-to-show', () => {
        (win as BrowserWindow).showInactive();
        (win as BrowserWindow).minimize();
        (win as BrowserWindow).flashFrame(false);
      });
    }

    // Start visible but behind whatever the user already has open. showInactive()
    // covers only half of that — it skips activation, but the window still lands on
    // top of the z-order, measured on Windows 11. That is upstream's settled
    // position, not a bug: "showInactive() should maintain the Z order" was closed
    // as wontfix (electron#9941), and Electron exposes moveTop() with no counterpart.
    // So the window is pushed down through the Win32 call Windows provides for it.
    if (startInactive && win) {
      win.once('ready-to-show', () => {
        (win as BrowserWindow).showInactive();
        (win as BrowserWindow).flashFrame(false);
        sendWindowToBack(win as BrowserWindow);
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
});
