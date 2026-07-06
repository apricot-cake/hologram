'use strict';

import { app, BrowserWindow, ipcMain, dialog, shell, protocol, nativeImage, nativeTheme, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { createPostIndex, computeDelta } from './lib-index.mts';
import { pruneDecision, nextBaseline } from './backup-guard.mts';
import { parseJsonLoose } from './lib-json.mts';
// Save-folder relocation engine (copy+catch-up → flip → verified cleanup → sweep).
import { relocateLibrary } from './lib-migrate.mts';
// IPC handler modules, extracted from this file (mechanical move — logic unchanged).
// Each exposes register(ctx); ctx is built after the core functions below and passed
// in at the top-level registration site (see registerExtractedIpc, before whenReady).
import * as ipcOrganize from './ipc-organize.mts';
import * as ipcPosts from './ipc-posts.mts';
import * as ipcConfig from './ipc-config.mts';
import * as ipcWindow from './ipc-window.mts';
import * as ipcTrash from './ipc-trash.mts';
import * as ipcBackup from './ipc-backup.mts';
import * as ipcTransfer from './ipc-transfer.mts';

// CJS require + __dirname reconstructed for ESM. native-host/ modules are loaded by
// computed path (dev sibling vs packaged resource), so they stay dynamic CJS requires.
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// native-host/ lives outside app/. In dev it's a sibling dir; when packaged it
// is bundled as an extraResource under resources/native-host.
const nativeHostDir = app.isPackaged ? path.join(process.resourcesPath, 'native-host') : path.join(__dirname, '..', 'native-host');
const { configDir, defaultLibraryDir } = require(path.join(nativeHostDir, 'paths'));
const installer = require(path.join(nativeHostDir, 'install'));
// Best-effort avatar download for import-posts (same SSRF guard/caps as capture,
// same shared avatars/ store — downloadAvatar dedupes by avatar URL).
const { pixivRefererFor, downloadAvatar } = require(path.join(nativeHostDir, 'media-download'));
// Save-folder resolution + clear-all gating. Shared with the native host (which
// must resolve the SAME save folder), so it lives alongside paths.js in native-host/.
const { resolveSaveFolder, clearAllBlockReason } = require(path.join(nativeHostDir, 'config-recovery'));

// Holographic app icon (iridescent square). Used for the taskbar/window icon at
// runtime; electron-builder converts the same PNG to .ico for the installed exe.
const APP_ICON = path.join(__dirname, 'assets', 'icon.png');

// Pin userData to the SAME directory the native host reads its config from, so
// the bridge (plain Node, spawned by Chrome) and this app always agree.
// Must run before app is ready.
app.setPath('userData', configDir());

const CONFIG_PATH = path.join(configDir(), 'config.json');

// Custom scheme to serve images from the (arbitrary) save folder. Lets the
// renderer lazy-load images by filename without disabling webSecurity or
// loading every image into JS memory.
protocol.registerSchemesAsPrivileged([{ scheme: 'psimg', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

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

// One-time migration (2026-06-25): configDir moved OUT of %APPDATA% to a
// non-virtualized home dir (~/.corpus — see native-host/paths.js). Carry the user's
// existing config.json (+ redundant pointer) over from the old %APPDATA%\Corpus
// location so settings (saveFolder, extensionId, backup) survive the move. Must run
// before the first config read. Best-effort + idempotent: skips once the new config
// exists, and never deletes the old copy (left as a fallback/forensic trail).
function migrateConfigDirFromAppData() {
  if (process.platform !== 'win32') return;
  const oldBase = process.env.APPDATA;
  if (!oldBase) return;
  const oldDir = path.join(oldBase, 'Corpus');
  const newDir = configDir();
  try {
    if (path.resolve(oldDir) === path.resolve(newDir)) return; // override points back at old (e.g. tests)
    if (fs.existsSync(path.join(newDir, 'config.json'))) return; // already migrated / fresh on new
    if (!fs.existsSync(path.join(oldDir, 'config.json'))) return; // nothing to carry over
    fs.mkdirSync(newDir, { recursive: true });
    fs.copyFileSync(path.join(oldDir, 'config.json'), path.join(newDir, 'config.json'));
    const oldPtr = path.join(oldDir, 'saveFolder.path');
    if (fs.existsSync(oldPtr)) fs.copyFileSync(oldPtr, path.join(newDir, 'saveFolder.path'));
    console.log(`Migrated config ${oldDir} -> ${newDir}`);
  } catch (err) {
    console.error('Config-dir migration failed (continuing):', err);
  }
}

// App-internal metadata files that live in the save folder but are NOT posts.
// The renderer writes these constantly (tabs.json on every tab switch via
// persistTabsDebounced, folders/groups/ungrouped on edits), so the watcher must
// IGNORE them — otherwise each write self-triggers a full library reload
// (listPosts re-reads all sidecars, ~1s on a 9k-post folder) and the UI stalls.
const INTERNAL_FILES = new Set(['config.json', '.index.json', 'tag-groups.json', 'tag-types.json', 'ungrouped.json', 'manual-groups.json', 'folders.json', 'collections.json', 'tabs.json', 'poster-favorites.json', 'poster-folders.json', 'poster-tags.json']);

// The subset of INTERNAL_FILES that the renderer REWRITES in place on every edit
// (organization layer: tags / groups / folders / collections / clip / poster-* /
// open tabs). Unlike write-once captures (.jpg + .json sidecar), these mutate, so
// a backup that only copies "files not yet present at dest" freezes them at their
// first-ever contents — restoring from that mirror would silently discard every
// tagging / foldering edit made since the first backup. The backup must re-copy
// these whenever the source changed (size or mtime). config.json lives in
// configDir (never in the save folder) and .index.json is a rebuildable snapshot
// already skipped by the backup, so neither belongs here.
const MUTABLE_INTERNAL = new Set(['tag-groups.json', 'tag-types.json', 'ungrouped.json', 'manual-groups.json', 'folders.json', 'collections.json', 'tabs.json', 'poster-favorites.json', 'poster-folders.json', 'poster-tags.json']);

// Watch the save folder and tell the renderer to refresh when files change
// (e.g. a new capture arrives, or dummy data is injected). Debounced because a
// single capture writes both a .jpg and a .json.
let folderWatcher: import('node:fs').FSWatcher | null = null;
let watchDebounce: any = null;
let watchChanged = new Set<string>(); // changed sidecar (.json) basenames within the debounce window
let watchUnknown = false; // a watch event lacked a filename -> can't target, force a full reconcile
function watchSaveFolder() {
  if (folderWatcher) {
    try {
      folderWatcher.close();
    } catch {
      /* already closed */
    }
    folderWatcher = null;
  }
  const folder = getSaveFolder();
  if (!folder) return;
  try {
    folderWatcher = fs.watch(folder, (_event, filename) => {
      if (!filename) {
        watchUnknown = true; // platform didn't tell us which file -> renderer will full-reconcile
      } else {
        const base = path.basename(filename);
        if (!/\.(jpe?g|jfif|png|webp|gif|json)$/i.test(base)) return;
        // App-internal metadata churns constantly; only real captures should refresh.
        if (INTERNAL_FILES.has(base)) return;
        // Only the .json sidecar carries a record; collect those as the targeted
        // hint. An image-only event has no record change to ship yet (its .json
        // lands separately and re-triggers).
        if (base.toLowerCase().endsWith('.json')) watchChanged.add(base);
        else return;
      }
      clearTimeout(watchDebounce);
      watchDebounce = setTimeout(() => {
        // names: null = full reconcile (unusable hint); [] = no sidecar changed;
        // [..] = re-scan only these. The renderer relays it back to listPostsDelta.
        const names = watchUnknown ? null : [...watchChanged];
        watchChanged = new Set();
        watchUnknown = false;
        if (win && !win.isDestroyed()) win.webContents.send('posts-changed', names);
      }, 400);
    });
  } catch (err) {
    console.error('Failed to watch save folder:', err);
  }
}

// --- Posts (scan sidecars, via the on-disk + in-memory index) ---
// listPosts is now async and O(changed): the index re-reads only sidecars whose
// mtime moved and restores the rest from .index.json / memory, so a post-capture
// refresh no longer freezes the main process (was ~900ms full re-scan on ~9k).
const postIndex = createPostIndex({ internalFiles: INTERNAL_FILES });
let snapshotTimer: any = null;
function scheduleSnapshot(folder) {
  // Debounced + best-effort. .index.json is in INTERNAL_FILES, so this write does
  // not self-trigger the folder watcher. Atomic (tmp + rename) inside writeSnapshot.
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    postIndex.writeSnapshot(folder).catch(() => {
      /* re-scan next cold start */
    });
  }, 1500);
}
async function listPosts() {
  const folder = getSaveFolder();
  if (!folder) return { saveFolder: null, posts: [] };
  const { posts, changed } = await postIndex.list(folder);
  if (changed) scheduleSnapshot(folder);
  return { saveFolder: folder, posts };
}

// Delta variant for the renderer. Serializing all ~9k records over IPC on every
// refresh costs ~450ms (the new bottleneck once the scan is indexed). The window
// is a single client, so main tracks what it last delivered and ships only
// added/updated/removed records — a post-capture refresh becomes O(changed).
// `haveBaseline` is the renderer asserting it still holds the last full set; when
// either side lacks a baseline (cold main, folder switch, or a renderer that
// reloaded and lost its cache) we resend a full snapshot and both sides re-sync.
// changedNames (the fs-watch hint relayed by the renderer):
//   undefined/null -> reliable hint unavailable: full folder re-scan
//   []             -> files changed but no sidecar among them: nothing to ship
//   [names…]       -> re-stat ONLY these sidecars (the O(changed) fast path)
let _deltaFolder = null;
let _lastSent = new Map(); // captureId -> mtimeMs last delivered to the renderer
async function listPostsDelta(haveBaseline, changedNames) {
  const folder = getSaveFolder();
  if (!folder) {
    _deltaFolder = null;
    _lastSent = new Map();
    return { saveFolder: null, full: true, posts: [] };
  }

  // Full (re)sync or hint-less refresh: scan the whole folder (the reliable path).
  if (!haveBaseline || _deltaFolder !== folder || changedNames == null) {
    const { posts, changed, stamps } = await postIndex.list(folder);
    if (changed) scheduleSnapshot(folder);
    if (!haveBaseline || _deltaFolder !== folder) {
      _deltaFolder = folder;
      _lastSent = new Map(stamps);
      return { saveFolder: folder, full: true, posts };
    }
    const { added, removed } = computeDelta(_lastSent, posts, stamps); // hint-less delta vs baseline
    _lastSent = new Map(stamps);
    return { saveFolder: folder, full: false, added, removed };
  }

  // Targeted: only the named sidecars moved — no folder-wide stat.
  if (changedNames.length === 0) return { saveFolder: folder, full: false, added: [], removed: [] };
  const r: any = await postIndex.applyChanges(folder, changedNames);
  const added: any[] = [];
  for (const t of r.added) {
    _lastSent.set(t.id, t.mtimeMs);
    added.push(t.record);
  }
  for (const id of r.removed) _lastSent.delete(id);
  if (r.added.length || r.removed.length) scheduleSnapshot(folder);
  return { saveFolder: folder, full: false, added, removed: r.removed };
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
};
function mimeForFile(name) {
  return EXT_MIME[path.extname(name || '').toLowerCase()] || 'application/octet-stream';
}

// Thumbnails: the image-view tile grid downscaled full-resolution originals
// (multi-MB pixiv/X art) into ~180px cells, which made scrolling stutter as the
// GPU decoded every full image. Instead serve a resized JPEG via psimg://…?w=N,
// generated once with Electron's built-in nativeImage and cached on disk
// (keyed by name + mtime + width, so re-migration invalidates it). The
// full-resolution original is still served when no ?w= is given (lightbox/viewer).
const THUMB_EXT = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif', '.avif', '.svg']);
function thumbCacheDir() {
  return path.join(configDir(), 'thumb-cache');
}

// nativeImage decode/resize/toJPEG is synchronous and runs on the main process's
// single JS thread. The tile grid fires many psimg?w= requests at once when first
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
  const key = `${name}.${Math.round(st.mtimeMs)}.w${w}.q3.jpg`.replace(/[^\w.\-]/g, '_');
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
  protocol.handle('psimg', async (request) => {
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
// app-info / get-tabs / set-tabs / set-titlebar-overlay) were extracted to
// ./ipc-config.js (registered via ipcConfig.register below).

// Posts handlers (list-posts / list-posts-delta / image-data-url) were extracted to
// ./ipc-posts.js (registered via ipcPosts.register below).

// Organization-layer handlers (tag-groups / tag-types / ungrouped / manual-groups /
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

// Atomically rewrite a sidecar the watcher tracks: write a sibling .tmp, then
// rename over the target so a reader only ever sees the complete old or complete
// new file — never a half-written one. A non-atomic in-place writeFile can be
// caught mid-write by listPostsDelta -> postIndex.applyChanges (fired by the
// fs.watch event): JSON.parse throws, the record reads as null, and the prior
// record's captureId is pushed to `removed`. The renderer then drops it from
// _postsById and reconcileFolders() PERMANENTLY purges that captureId from
// collections.json membership and the clip set. The card reappears on the next
// watch event but its collection/clip membership is gone for good. The .tmp
// suffix is invisible to the watcher (its regex only matches jpe?g|jfif|png|
// webp|gif|json). Mirrors lib-index's writeSnapshot.
async function writeSidecarAtomic(jsonPath, rec) {
  const tmp = `${jsonPath}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(rec, null, 2), 'utf8');
  await fs.promises.rename(tmp, jsonPath);
}

// Synchronous sibling of writeSidecarAtomic for the app-internal organization
// JSON (collections / tags / groups / folders / …). Same crash-safety reason: a
// non-atomic in-place writeFileSync caught mid-write by a crash/power loss leaves
// a torn or zero-byte file, whose next get-* read JSON.parse-throws and returns an
// empty default. The renderer adopts that empty as authoritative and the next edit
// persist()s it back — permanently losing the organization layer (re-created from
// nothing, unlike write-once images/sidecars). tmp+rename means a reader only ever
// sees the complete old or complete new file. The .tmp suffix is invisible to the
// watcher (its regex matches only image/json, not .tmp).
function writeJsonAtomicSync(filePath, value) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

// --- Organization-JSON degraded guard --------------------------------------
// The atomic writes above stop US from tearing these files, but a file can still
// be present-but-unparseable from an external edit, a pre-atomic-write torn file,
// or disk corruption. The get-* handlers can't tell that apart from "file absent"
// (both JSON.parse-throw paths), so they'd return the empty default; the renderer
// adopts it and the next set-* persists {} back — permanently purging the layer.
// Same failure mode (and the same defense) as readConfig()/clear-all: when a read
// finds a file present-but-corrupt we (1) keep a forensic copy, (2) flag the file
// degraded, and (3) refuse the next write to it, so the corrupt-but-recoverable
// file is preserved instead of overwritten with an empty default. A clean read
// (e.g. after the user restores/removes the bad file and restarts) clears the flag.
const degradedOrgFiles = new Set();

// Read an org JSON. Returns { value, degraded }:
//   - absent (ENOENT)        → { value: null, degraded: false }  (legitimately empty)
//   - present but unparseable → { value: null, degraded: true }  (preserve, don't purge)
//   - parsed                  → { value: <obj>, degraded: false }
function readOrgJsonSync(filePath) {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    degradedOrgFiles.delete(filePath); // truly absent — not corruption
    return { value: null, degraded: false };
  }
  try {
    const value = parseJsonLoose(raw);
    degradedOrgFiles.delete(filePath); // clean read clears any prior degraded flag
    return { value, degraded: false };
  } catch {
    if (!degradedOrgFiles.has(filePath)) {
      // Keep one forensic copy the first time we notice this corruption.
      try {
        if (raw && raw.length) fs.copyFileSync(filePath, `${filePath}.corrupt-${Date.now()}`);
      } catch {
        /* best-effort */
      }
    }
    degradedOrgFiles.add(filePath);
    return { value: null, degraded: true };
  }
}

// Atomic write that refuses to clobber a file currently flagged degraded. Throws
// so the caller's existing try/catch returns { ok: false } and the corrupt file
// is left intact (the in-memory data isn't lost — the renderer keeps it and can
// retry once the underlying file is fixed and re-read cleanly).
function writeOrgJsonSync(filePath, value) {
  if (degradedOrgFiles.has(filePath)) {
    throw new Error('refusing to overwrite degraded org file: ' + path.basename(filePath));
  }
  writeJsonAtomicSync(filePath, value);
}

// Recover the captureId base from a filename. The argument may be the primary
// image (<base>.<ext>, any viewable ext), a video poster (<base>-poster.<ext>),
// or the video itself. Strip the -poster marker first, then any extension.
const VIEWABLE_EXTS = ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'avif', 'svg', 'mp4', 'webm', 'mov', 'm4v'];
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
const BACKUP_SUBDIR = 'Corpus-mirror';
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
    const probe = path.join(dir, `.corpus-write-probe-${Date.now()}`);
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

    // Collect source files, skipping app-internal and transient entries. Keep each
    // file's size/mtime so mutable internal files can be re-copied only when changed.
    let srcFiles: string[];
    try {
      srcFiles = await fs.promises.readdir(src);
    } catch {
      srcFiles = [];
    }
    const srcSet = new Set<string>();
    const srcStat = new Map<string, any>(); // name -> { size, mtimeMs }
    for (const f of srcFiles) {
      if (f === '.index.json' || f === TRASH_SUBDIR) continue;
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
    let destFiles: string[];
    try {
      destFiles = await fs.promises.readdir(dest);
    } catch {
      destFiles = [];
    }
    const destSet = new Set<string>(destFiles.filter((f) => !/\.tmp(-\d+)?$/i.test(f)));
    await collectSubdir(dest, 'avatars', destSet, null);

    // Decide whether a destination copy is stale and must be refreshed. Write-once
    // captures (.jpg + .json sidecar) never change, so their presence at dest is
    // proof enough — re-copying would only waste I/O. Mutable internal files
    // (organization JSON: tags / folders / collections / clip / tabs / poster-*)
    // are rewritten on every edit, so compare size+mtime and re-copy on drift;
    // otherwise the mirror freezes at the first backup and a restore loses edits.
    // mtime is compared at whole-millisecond granularity: stat().mtimeMs carries
    // sub-ms (ns) precision but utimes() can only set ms, so the preserved dest
    // mtime never equals the float src value — flooring both avoids re-copying an
    // unchanged file forever.
    const needsRefresh = async (f) => {
      if (!MUTABLE_INTERNAL.has(f)) return false;
      const s = srcStat.get(f);
      if (!s) return false;
      try {
        const d = await fs.promises.stat(path.join(dest, f));
        return d.size !== s.size || Math.floor(d.mtimeMs) !== Math.floor(s.mtimeMs);
      } catch {
        return true;
      } // unreadable dest copy -> re-copy to be safe
    };

    // Copy files missing at dest, and re-copy mutable internal files that drifted.
    // The copy is atomic (tmp + rename) so a reader never sees a half-written file.
    if ([...srcSet].some((f) => f.startsWith('avatars/'))) {
      await fs.promises.mkdir(path.join(dest, 'avatars'), { recursive: true });
    }
    for (const f of srcSet) {
      if (destSet.has(f) && !(await needsRefresh(f))) continue;
      const tmp = path.join(dest, f + '.tmp-' + Date.now());
      try {
        await fs.promises.copyFile(path.join(src, f), tmp);
        // Preserve mtime (floored to ms) so the next run's drift check compares
        // like with like and an unchanged mutable file is not re-copied.
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

// Vite dev server base — honored ONLY when CORPUS_DEV_SERVER is set (island HMR /
// React Fast Refresh while developing). '1' resolves to the strictPort default;
// any other value is used as the base URL verbatim (trailing slashes trimmed).
// null in prod, so loadFile + the file:// navigation guard stand unchanged.
const DEV_SERVER_URL = process.env.CORPUS_DEV_SERVER ? (process.env.CORPUS_DEV_SERVER === '1' ? 'http://localhost:5173' : process.env.CORPUS_DEV_SERVER.replace(/\/+$/, '')) : null;

// Navigation lockdown for every web-contents the app creates. Without it, a file
// (e.g. a local .html) dropped onto a window would make the top frame navigate to
// file://…, which inherits the same preload and could call destructive IPC
// (clear-all / import-complete / …). We:
//   - deny will-navigate to anything other than our own renderer (file://…/
//     renderer/index.html) or the psimg:// image-viewer scheme. The initial
//     loadFile/loadURL does NOT fire will-navigate, so this never blocks startup.
//   - deny window.open / target=_blank entirely; external links are funneled
//     through the open-external IPC (shell.openExternal), which this leaves intact.
function installNavigationGuards() {
  const indexFile = path.resolve(__dirname, 'renderer', 'index.html');
  const devOrigin = DEV_SERVER_URL ? new URL(DEV_SERVER_URL).origin : null;
  const isAllowedNavigation = (rawUrl) => {
    let u: URL;
    try {
      u = new URL(rawUrl);
    } catch {
      return false;
    }
    // The standalone image window lives on the app-controlled psimg:// scheme.
    if (u.protocol === 'psimg:') return true;
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
    readOrgJsonSync,
    writeOrgJsonSync,
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
    VIEWABLE_EXTS,
    INTERNAL_FILES,
    writeSidecarAtomic,
    readBackupConfig,
    writeBackupConfig,
    validateBackupDir,
    armBackupSchedule,
    runBackup,
    readSavePointer,
    clearAllBlockReason,
    pixivRefererFor,
    downloadAvatar,
    validateSaveFolder,
    relocateLibrary,
    watchSaveFolder,
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
  const smoke = process.env.CORPUS_SMOKE === '1';
  const sb = smoke ? null : savedWindowBounds();
  win = new BrowserWindow({
    width: (sb && sb.width) || 1100,
    height: (sb && sb.height) || 820,
    ...(sb && Number.isFinite(sb.x) ? { x: sb.x, y: sb.y } : {}),
    minWidth: 720,
    minHeight: 480,
    show,
    backgroundColor: dark ? '#0c0e12' : '#f6f7f9',
    title: 'Corpus',
    icon: APP_ICON,
    paintWhenInitiallyHidden: true,
    titleBarStyle: 'hidden',
    // color MUST match --tabbar-bg (dark #0e0f11 / light #eceef2) so the caption-
    // button strip blends into the tab bar instead of floating. height 37 = 1px less
    // than --tabbar-h(38) so the tab bar's bottom border peeks under the buttons.
    titleBarOverlay: { color: dark ? '#0e0f11' : '#eceef2', symbolColor: dark ? '#9aa3af' : '#5b6470', height: 37 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.removeMenu();
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
    // Dev: load the renderer from Vite (HMR + Fast Refresh for the islands). Vite's
    // root is app/, so index.html is served at /renderer/index.html and the island
    // <script> tags are rewritten to their .tsx module sources (see vite.config.mjs).
    const q = new URLSearchParams({ theme, ...(smoke ? { smoke: '1' } : {}) }).toString();
    win.loadURL(`${DEV_SERVER_URL}/renderer/index.html?${q}`);
  } else {
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { theme, ...(smoke ? { smoke: '1' } : {}) } });
  }
}

// Side-effect-free launch check: skips host registration, hides the window,
// and quits once the renderer has loaded. Run with CORPUS_SMOKE=1.
const SMOKE = process.env.CORPUS_SMOKE === '1';

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
    // installed exe; setting it here covers the CorpusLaunch dev run.
    app.setAppUserModelId('com.corpus.app');
    // Carry config over from the old %APPDATA% location now that configDir moved out
    // of AppData (must run before any config read). 2026-06-25.
    migrateConfigDirFromAppData();
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
    // Dev server runs (CORPUS_DEV_SERVER) never capture, so skip host registration —
    // no HKCU writes and no native-host copy into the shared ~/.corpus.
    if (!SMOKE && !DEV_SERVER_URL) ensureHostRegistered();
    registerImageProtocol();
    installNavigationGuards();
    const startMin = !SMOKE && process.env.CORPUS_START_MINIMIZED === '1';
    createWindow(!SMOKE && !startMin); // start-minimized → create hidden, then show inactive below
    watchSaveFolder();
    // Dev-only: hot-reload the renderer when its source (js/html/css) changes, so
    // iterating on UI/CSS needs no manual reload — and no terminal-spawning reload
    // command from outside. Packaged builds never watch.
    if (!SMOKE && !app.isPackaged) {
      try {
        let _rendererReloadT: any = null;
        fs.watch(path.join(__dirname, 'renderer'), { recursive: true }, (_e, fn) => {
          if (!fn || !/\.(js|html|css)$/i.test(String(fn))) return;
          clearTimeout(_rendererReloadT);
          _rendererReloadT = setTimeout(() => {
            if (win && !win.isDestroyed()) win.webContents.reloadIgnoringCache();
          }, 180);
        });
      } catch {
        /* dev watcher is best-effort */
      }
    }
    if (!SMOKE) {
      armBackupSchedule(); // interval スケジュールを起動
      // 起動時の取り戻し: 前回から間隔以上空いていれば1回だけ実行（閉じている間に逃した分）。
      const bk = readBackupConfig();
      if (bk.dir && bk.interval) {
        const last = bk.lastRunAt ? Date.parse(bk.lastRunAt) : 0;
        if (!last || Date.now() - last >= backupIntervalMs(bk)) setTimeout(() => runBackup('startup-overdue'), 4000);
      }
      setTimeout(() => purgeOldTrash(), 6000); // expire old trash entries on startup
    }

    if (SMOKE) {
      const shot = process.env.CORPUS_SMOKE_SHOT;
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
          if (process.env.CORPUS_SMOKE_EVAL) {
            try {
              const r = await (win as BrowserWindow).webContents.executeJavaScript(process.env.CORPUS_SMOKE_EVAL);
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
      setTimeout(() => quit('SMOKE_TIMEOUT'), 9000);
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

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
