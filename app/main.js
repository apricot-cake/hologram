'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, protocol, nativeImage, nativeTheme, screen } = require('electron');
const fs = require('fs');
const path = require('path');

// native-host/ lives outside app/. In dev it's a sibling dir; when packaged it
// is bundled as an extraResource under resources/native-host.
const nativeHostDir = app.isPackaged
  ? path.join(process.resourcesPath, 'native-host')
  : path.join(__dirname, '..', 'native-host');
const { configDir, defaultLibraryDir } = require(path.join(nativeHostDir, 'paths'));
const installer = require(path.join(nativeHostDir, 'install'));
// Best-effort avatar download for import-posts (same SSRF guard/caps as capture).
const { fetchStillImage, pixivRefererFor } = require(path.join(nativeHostDir, 'media-download'));
const { createPostIndex, computeDelta } = require('./lib-index');
const { pruneDecision, nextBaseline } = require('./backup-guard');
// Save-folder resolution + clear-all gating. Shared with the native host (which
// must resolve the SAME save folder), so it lives alongside paths.js in native-host/.
const { resolveSaveFolder, clearAllBlockReason } = require(path.join(nativeHostDir, 'config-recovery'));

// Pin userData to the SAME directory the native host reads its config from, so
// the bridge (plain Node, spawned by Chrome) and this app always agree.
// Must run before app is ready.
app.setPath('userData', configDir());

const CONFIG_PATH = path.join(configDir(), 'config.json');

// Custom scheme to serve images from the (arbitrary) save folder. Lets the
// renderer lazy-load images by filename without disabling webSecurity or
// loading every image into JS memory.
protocol.registerSchemesAsPrivileged([
  { scheme: 'psimg', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

let win = null;

// --- Config ---
// True iff the LAST readConfig() found config.json present-but-unparseable. Lets
// destructive ops (clear-all) refuse to run on top of a degraded config.
let configLastCorrupt = false;
function readConfig() {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch {
    configLastCorrupt = false;
    return {};   // no config yet (fresh install) — absence is not corruption
  }
  try {
    const cfg = JSON.parse(raw);
    configLastCorrupt = false;
    return cfg;
  } catch {
    // Corrupt config (e.g. a truncation from a pre-atomic-write forced kill).
    // PRESERVE it instead of letting the caller silently overwrite it with {} —
    // a truncated config that reads as {} and is then re-written loses
    // saveFolder/extensionId/backup at once. Keep a copy for recovery/forensics.
    configLastCorrupt = true;
    try { if (raw && raw.length) fs.copyFileSync(CONFIG_PATH, `${CONFIG_PATH}.corrupt-${Date.now()}`); } catch { /* best-effort */ }
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
    fs.renameSync(tmp, SAVE_POINTER_PATH());   // atomic, independent of config.json
  } catch { /* best-effort redundancy */ }
}
function readSavePointer() {
  try { const p = fs.readFileSync(SAVE_POINTER_PATH(), 'utf8').trim(); return p || null; }
  catch { return null; }
}
function dirExists(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

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
    configSaveFolder: folder, pointer: ptr,
    pointerExists: ptr ? dirExists(ptr) : false, defaultDir: defaultLibraryDir()
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
    try { writeConfig(Object.assign({}, cfg, { saveFolder: ptr })); } catch { /* best-effort recovery */ }
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
    if (path.resolve(oldDir) === path.resolve(newDir)) return;     // override points back at old (e.g. tests)
    if (fs.existsSync(path.join(newDir, 'config.json'))) return;   // already migrated / fresh on new
    if (!fs.existsSync(path.join(oldDir, 'config.json'))) return;  // nothing to carry over
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
const INTERNAL_FILES = new Set([
  'config.json', '.index.json', 'tag-groups.json', 'tag-types.json', 'ungrouped.json',
  'manual-groups.json', 'folders.json', 'collections.json', 'tabs.json', 'poster-favorites.json',
  'poster-folders.json', 'poster-tags.json',
]);

// Watch the save folder and tell the renderer to refresh when files change
// (e.g. a new capture arrives, or dummy data is injected). Debounced because a
// single capture writes both a .jpg and a .json.
let folderWatcher = null;
let watchDebounce = null;
let watchChanged = new Set();   // changed sidecar (.json) basenames within the debounce window
let watchUnknown = false;       // a watch event lacked a filename -> can't target, force a full reconcile
function watchSaveFolder() {
  if (folderWatcher) {
    try { folderWatcher.close(); } catch { /* already closed */ }
    folderWatcher = null;
  }
  const folder = getSaveFolder();
  if (!folder) return;
  try {
    folderWatcher = fs.watch(folder, (_event, filename) => {
      if (!filename) {
        watchUnknown = true;   // platform didn't tell us which file -> renderer will full-reconcile
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
let snapshotTimer = null;
function scheduleSnapshot(folder) {
  // Debounced + best-effort. .index.json is in INTERNAL_FILES, so this write does
  // not self-trigger the folder watcher. Atomic (tmp + rename) inside writeSnapshot.
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => { postIndex.writeSnapshot(folder).catch(() => { /* re-scan next cold start */ }); }, 1500);
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
let _lastSent = new Map();   // captureId -> mtimeMs last delivered to the renderer
async function listPostsDelta(haveBaseline, changedNames) {
  const folder = getSaveFolder();
  if (!folder) { _deltaFolder = null; _lastSent = new Map(); return { saveFolder: null, full: true, posts: [] }; }

  // Full (re)sync or hint-less refresh: scan the whole folder (the reliable path).
  if (!haveBaseline || _deltaFolder !== folder || changedNames == null) {
    const { posts, changed, stamps } = await postIndex.list(folder);
    if (changed) scheduleSnapshot(folder);
    if (!haveBaseline || _deltaFolder !== folder) {
      _deltaFolder = folder;
      _lastSent = new Map(stamps);
      return { saveFolder: folder, full: true, posts };
    }
    const { added, removed } = computeDelta(_lastSent, posts, stamps);   // hint-less delta vs baseline
    _lastSent = new Map(stamps);
    return { saveFolder: folder, full: false, added, removed };
  }

  // Targeted: only the named sidecars moved — no folder-wide stat.
  if (changedNames.length === 0) return { saveFolder: folder, full: false, added: [], removed: [] };
  const r = await postIndex.applyChanges(folder, changedNames);
  const added = [];
  for (const t of r.added) { _lastSent.set(t.id, t.mtimeMs); added.push(t.record); }
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
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v'
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
function thumbCacheDir() { return path.join(configDir(), 'thumb-cache'); }

async function getThumbnail(resolved, name, w) {
  if (!THUMB_EXT.has(path.extname(name).toLowerCase())) return null;
  let st;
  try { st = await fs.promises.stat(resolved); } catch { return null; }
  // q3: resize by the SHORT edge (not width). Tiles are square + object-fit:cover, so the
  // short edge is what maps to the tile. Resizing by width made wide images (e.g. 1920x1080)
  // become 180x101, which then got upscaled vertically into the square tile → heavy blur.
  const key = `${name}.${Math.round(st.mtimeMs)}.w${w}.q3.jpg`.replace(/[^\w.\-]/g, '_');
  const cachePath = path.join(thumbCacheDir(), key);
  try { return await fs.promises.readFile(cachePath); } catch { /* cache miss */ }
  try {
    let img = nativeImage.createFromPath(resolved);
    if (img.isEmpty()) return null;
    const sz = img.getSize();
    if (Math.min(sz.width, sz.height) > w) {
      img = (sz.width >= sz.height) ? img.resize({ height: w, quality: 'good' }) : img.resize({ width: w, quality: 'good' });
    }
    const buf = img.toJPEG(90);
    fs.promises.mkdir(thumbCacheDir(), { recursive: true })
      .then(() => fs.promises.writeFile(cachePath, buf)).catch(() => { /* cache best-effort */ });
    return buf;
  } catch { return null; }
}

function registerImageProtocol() {
  protocol.handle('psimg', async (request) => {
    try {
      const folder = getSaveFolder();
      if (!folder) return new Response('No save folder', { status: 404 });

      const url = new URL(request.url);
      const name = path.basename(decodeURIComponent(url.pathname.replace(/^\/+/, '')));
      if (!name || name === '.' || name === '..') return new Response('Not found', { status: 404 });

      const folderResolved = path.resolve(folder);
      const resolved = path.resolve(path.join(folder, name));
      // name is already a basename, but assert the resolved path is strictly
      // INSIDE the save folder. Compare against folder + separator: a bare
      // startsWith(folder) would also accept a sibling like "<folder>-other".
      if (!resolved.startsWith(folderResolved + path.sep)) {
        return new Response('Forbidden', { status: 403 });
      }

      const w = parseInt(url.searchParams.get('w') || '', 10);
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
ipcMain.handle('get-config', () => {
  const cfg = readConfig();
  return { saveFolder: getSaveFolder(), extensionId: cfg.extensionId || null };
});

ipcMain.handle('set-extension-id', (_event, id) => {
  const cfg = readConfig();
  cfg.extensionId = (typeof id === 'string' ? id.trim() : '');
  writeConfig(cfg);
  try {
    // Update only the manifest's allowed origin; keep the existing launcher.
    if (fs.existsSync(installer.manifestPath())) {
      installer.updateAllowedOrigin(cfg.extensionId);
    } else {
      installer.install({ exe: process.execPath, runAsNode: true, extensionId: cfg.extensionId });
    }
  } catch (err) {
    console.error('Failed to update native host origin:', err);
  }
  return { extensionId: cfg.extensionId };
});

ipcMain.handle('list-posts', () => listPosts());
ipcMain.handle('list-posts-delta', (_e, haveBaseline, changedNames) => listPostsDelta(!!haveBaseline, changedNames));

// Tag groups (migrated from the imported library's metadata) live alongside the
// sidecars as <saveFolder>/tag-groups.json: { groups: [{id,name,tags[]}] }.
ipcMain.handle('get-tag-groups', () => {
  const folder = getSaveFolder();
  if (!folder) return { groups: [] };
  try {
    const j = JSON.parse(fs.readFileSync(path.join(folder, 'tag-groups.json'), 'utf8'));
    return { groups: Array.isArray(j.groups) ? j.groups : [] };
  } catch {
    return { groups: [] };
  }
});

ipcMain.handle('set-tag-groups', (_e, groups) => {
  const folder = getSaveFolder();
  if (!folder || !Array.isArray(groups)) return { ok: false };
  try {
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'tag-groups.json'), JSON.stringify({ groups }, null, 2), 'utf8');
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

// Tag "vocabulary book" (用語帳): a tag's 種別 (kind) is an attribute of the TAG,
// not of any post — so classifying a few hundred distinct tags needs zero post
// migration. Lives as <saveFolder>/tag-types.json: { types: { "<tag>": "work"|
// "character" } }. Tags absent from the map are implicitly 一般 (general). The
// renamable work⊃character pair powers the (later) copyright/character sections;
// `labels` is reserved/pass-through for that phase.
ipcMain.handle('get-tag-types', () => {
  const folder = getSaveFolder();
  if (!folder) return { types: {}, labels: null };
  try {
    const j = JSON.parse(fs.readFileSync(path.join(folder, 'tag-types.json'), 'utf8'));
    const types = (j && j.types && typeof j.types === 'object') ? j.types : {};
    const labels = (j && j.labels && typeof j.labels === 'object') ? j.labels : null;
    return { types, labels };
  } catch {
    return { types: {}, labels: null };
  }
});

ipcMain.handle('set-tag-types', (_e, types, labels) => {
  const folder = getSaveFolder();
  if (!folder || !types || typeof types !== 'object') return { ok: false };
  try {
    fs.mkdirSync(folder, { recursive: true });
    const out = { types };
    if (labels && typeof labels === 'object') out.labels = labels;
    fs.writeFileSync(path.join(folder, 'tag-types.json'), JSON.stringify(out, null, 2), 'utf8');
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

// Persistent per-post "do not group" set (image-view). Post keys whose images
// should stay individual tiles (e.g. several pics from one post that aren't a
// multi-page work). Lives as <saveFolder>/ungrouped.json: { keys: [...] }.
ipcMain.handle('get-ungrouped', () => {
  const folder = getSaveFolder();
  if (!folder) return { keys: [] };
  try {
    const j = JSON.parse(fs.readFileSync(path.join(folder, 'ungrouped.json'), 'utf8'));
    return { keys: Array.isArray(j.keys) ? j.keys : [] };
  } catch {
    return { keys: [] };
  }
});
ipcMain.handle('set-ungrouped', (_e, keys) => {
  const folder = getSaveFolder();
  if (!folder) return { ok: false };
  try {
    fs.writeFileSync(path.join(folder, 'ungrouped.json'),
      JSON.stringify({ keys: Array.isArray(keys) ? keys.map(String) : [] }, null, 2), 'utf8');
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

// (poster favorites feature removed; legacy <saveFolder>/poster-favorites.json is
// still listed in INTERNAL_FILES so the post index keeps skipping it.)

// Named poster folders (poster view). { folders: [{ id, name, items:[posterKey] }] }
// — same shape as folders.json (minus workspace), so import reuses mergeFolders.
ipcMain.handle('get-poster-folders', () => {
  const folder = getSaveFolder();
  if (!folder) return { folders: [] };
  try {
    const j = JSON.parse(fs.readFileSync(path.join(folder, 'poster-folders.json'), 'utf8'));
    return { folders: Array.isArray(j.folders) ? j.folders : [] };
  } catch {
    return { folders: [] };
  }
});
ipcMain.handle('set-poster-folders', (_e, data) => {
  const folder = getSaveFolder();
  if (!folder || !data || !Array.isArray(data.folders)) return { ok: false };
  try {
    fs.writeFileSync(path.join(folder, 'poster-folders.json'),
      JSON.stringify({ folders: data.folders }, null, 2), 'utf8');
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

// Per-poster tags (poster view). { tags: { "<posterKey>": ["tag", …] } } — the
// poster-level peer of poster-folders. Shares the post tag
// vocabulary (tag-groups/tag-types) but is keyed by poster, NOT stored on posts.
ipcMain.handle('get-poster-tags', () => {
  const folder = getSaveFolder();
  if (!folder) return { tags: {} };
  try {
    const j = JSON.parse(fs.readFileSync(path.join(folder, 'poster-tags.json'), 'utf8'));
    return { tags: (j && typeof j.tags === 'object' && j.tags) ? j.tags : {} };
  } catch {
    return { tags: {} };
  }
});
ipcMain.handle('set-poster-tags', (_e, data) => {
  const folder = getSaveFolder();
  if (!folder || !data || typeof data.tags !== 'object' || !data.tags) return { ok: false };
  try {
    fs.writeFileSync(path.join(folder, 'poster-tags.json'),
      JSON.stringify({ tags: data.tags }, null, 2), 'utf8');
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

// Manual image groups (image-view): user-defined groups of captureIds that should
// collapse into one tile (for images not auto-grouped by post URL). Lives as
// <saveFolder>/manual-groups.json: { groups: [ [captureId, …], … ] }.
ipcMain.handle('get-manual-groups', () => {
  const folder = getSaveFolder();
  if (!folder) return { groups: [] };
  try {
    const j = JSON.parse(fs.readFileSync(path.join(folder, 'manual-groups.json'), 'utf8'));
    return { groups: Array.isArray(j.groups) ? j.groups : [] };
  } catch {
    return { groups: [] };
  }
});
ipcMain.handle('set-manual-groups', (_e, groups) => {
  const folder = getSaveFolder();
  if (!folder) return { ok: false };
  try {
    const clean = Array.isArray(groups) ? groups.filter((g) => Array.isArray(g) && g.length > 1).map((g) => g.map(String)) : [];
    fs.writeFileSync(path.join(folder, 'manual-groups.json'), JSON.stringify({ groups: clean }, null, 2), 'utf8');
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

// User folders: named permanent collections of captureIds. Plus a single
// `workspace` — an ephemeral one-click tray. Distinct from tags. Lives as
// <saveFolder>/folders.json: { folders: [ { id, name, items:[…] } ], workspace:[…] }.
// (The old `defaultId` key is dropped on read/write — default folder was removed.)
ipcMain.handle('get-folders', () => {
  const folder = getSaveFolder();
  if (!folder) return { folders: [], workspace: [], posterWorkspace: [] };
  try {
    const j = JSON.parse(fs.readFileSync(path.join(folder, 'folders.json'), 'utf8'));
    const folders = Array.isArray(j.folders) ? j.folders
      .filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string')
      .map((f) => ({ id: f.id, name: f.name, items: Array.isArray(f.items) ? [...new Set(f.items.map(String))] : [] })) : [];
    const workspace = Array.isArray(j.workspace) ? [...new Set(j.workspace.map(String))] : [];
    const posterWorkspace = Array.isArray(j.posterWorkspace) ? [...new Set(j.posterWorkspace.map(String))] : [];
    return { folders, workspace, posterWorkspace };
  } catch {
    return { folders: [], workspace: [], posterWorkspace: [] };
  }
});
ipcMain.handle('set-folders', (_e, data) => {
  const folder = getSaveFolder();
  if (!folder) return { ok: false };
  try {
    const src = (data && Array.isArray(data.folders)) ? data.folders : [];
    const folders = src
      .filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string')
      .map((f) => ({ id: f.id, name: f.name, items: Array.isArray(f.items) ? [...new Set(f.items.map(String))] : [] }));
    const workspace = (data && Array.isArray(data.workspace)) ? [...new Set(data.workspace.map(String))] : [];
    const posterWorkspace = (data && Array.isArray(data.posterWorkspace)) ? [...new Set(data.posterWorkspace.map(String))] : [];
    fs.writeFileSync(path.join(folder, 'folders.json'), JSON.stringify({ folders, workspace, posterWorkspace }, null, 2), 'utf8');
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

// `collections` — the unified container that supersedes folders + workspace
// (Phase① of the collection feature). <saveFolder>/collections.json:
//   { collections:[{id,name,kind:'static',created,items:[captureId]}], clip:[captureId], posterWorkspace:[posterKey] }
// `clip` is the library-wide ephemeral flag set (the 📎 tray). `activeId` is legacy
// (the old 🔖 one-click target); the renderer no longer writes it, so it settles to
// null. On first read we migrate any existing folders.json into this shape, then
// DELETE folders.json (clean cutover — no backup, by design). get/set-folders stay
// for the migration read and for folding a legacy folders.json out of an imported
// ZIP (lib-archive.js).
function normCollections(arr) {
  return Array.isArray(arr) ? arr
    .filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string')
    .map((c) => {
      const out = {
        id: c.id, name: c.name,
        kind: c.kind === 'dynamic' ? 'dynamic' : 'static',
        created: typeof c.created === 'number' ? c.created : null,
        items: Array.isArray(c.items) ? [...new Set(c.items.map(String))] : [],
      };
      if (c.kind === 'dynamic') {
        if (c.tree && typeof c.tree === 'object') out.tree = c.tree;   // saved query tree
        if (typeof c.q === 'string' && c.q) out.q = c.q;              // saved free-text search
      }
      return out;
    }) : [];
}
// Shape a legacy folders.json into the collections model. Folders become static
// collections (ids preserved). The legacy workspace tray is dropped (clip starts
// empty — no migration, by design). Returns null when there is nothing to migrate.
function migrateFoldersToCollections(folder) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(folder, 'folders.json'), 'utf8')); } catch { return null; }
  const folders = Array.isArray(j.folders) ? j.folders : [];
  const posterWorkspace = Array.isArray(j.posterWorkspace) ? [...new Set(j.posterWorkspace.map(String))] : [];
  const collections = normCollections(folders.map((f) => ({ id: f.id, name: f.name, kind: 'static', created: null, items: f.items })));
  return { collections, activeId: null, clip: [], posterWorkspace };
}
ipcMain.handle('get-collections', () => {
  const folder = getSaveFolder();
  const empty = { collections: [], activeId: null, clip: [], posterWorkspace: [] };
  if (!folder) return empty;
  // 1) already migrated → read collections.json
  try {
    const j = JSON.parse(fs.readFileSync(path.join(folder, 'collections.json'), 'utf8'));
    const collections = normCollections(j.collections);
    const ids = new Set(collections.map((c) => c.id));
    const activeId = (typeof j.activeId === 'string' && ids.has(j.activeId)) ? j.activeId : null;
    const clip = Array.isArray(j.clip) ? [...new Set(j.clip.map(String))] : [];
    const posterWorkspace = Array.isArray(j.posterWorkspace) ? [...new Set(j.posterWorkspace.map(String))] : [];
    return { collections, activeId, clip, posterWorkspace };
  } catch { /* not migrated yet — fall through */ }
  // 2) migrate a legacy folders.json once, write collections.json, delete folders.json
  const migrated = migrateFoldersToCollections(folder);
  if (!migrated) return empty;
  try { fs.writeFileSync(path.join(folder, 'collections.json'), JSON.stringify(migrated, null, 2), 'utf8'); } catch { return migrated; }
  try { fs.unlinkSync(path.join(folder, 'folders.json')); } catch { /* best-effort */ }
  return migrated;
});
ipcMain.handle('set-collections', (_e, data) => {
  const folder = getSaveFolder();
  if (!folder) return { ok: false };
  try {
    const collections = normCollections(data && data.collections);
    const ids = new Set(collections.map((c) => c.id));
    const activeId = (data && typeof data.activeId === 'string' && ids.has(data.activeId)) ? data.activeId : null;
    const clip = (data && Array.isArray(data.clip)) ? [...new Set(data.clip.map(String))] : [];
    const posterWorkspace = (data && Array.isArray(data.posterWorkspace)) ? [...new Set(data.posterWorkspace.map(String))] : [];
    fs.writeFileSync(path.join(folder, 'collections.json'), JSON.stringify({ collections, activeId, clip, posterWorkspace }, null, 2), 'utf8');
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle('set-titlebar-overlay', (_e, opts) => {
  try { if (win) win.setTitleBarOverlay(opts); } catch { /* non-Windows or overlay-less build */ }
});

ipcMain.handle('get-tabs', () => {
  const folder = getSaveFolder();
  if (!folder) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(folder, 'tabs.json'), 'utf8'));
    return (raw && Array.isArray(raw.tabs)) ? raw : null;
  } catch { return null; }
});
ipcMain.handle('set-tabs', (_e, data) => {
  const folder = getSaveFolder();
  if (!folder) return { ok: false };
  try {
    fs.writeFileSync(path.join(folder, 'tabs.json'), JSON.stringify(data, null, 2), 'utf8');
    return { ok: true };
  } catch { return { ok: false }; }
});

ipcMain.handle('open-external', (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
  }
});

// Open one library image in its own frameless-ish window (middle-click on a
// card). The psimg:// protocol is registered app-wide, so a bare loadURL shows
// Chromium's built-in image view (zoom/fit for free).
ipcMain.handle('open-image-window', (_event, image) => {
  if (typeof image !== 'string' || !image || image.includes('..') || image.includes('/') || image.includes('\\')) return;
  // Size the window to the image's aspect ratio (fit within ~85% of the work area).
  let width = 1100; let height = 850;
  try {
    const sz = nativeImage.createFromPath(path.join(getSaveFolder(), image)).getSize();
    if (sz.width > 0 && sz.height > 0) {
      const wa = screen.getPrimaryDisplay().workAreaSize;
      const scale = Math.min(1, (wa.width * 0.85) / sz.width, (wa.height * 0.85) / sz.height);
      width = Math.max(320, Math.round(sz.width * scale));
      height = Math.max(240, Math.round(sz.height * scale));
    }
  } catch { /* keep defaults (e.g. webp not decodable by nativeImage) */ }
  const w = new BrowserWindow({
    width, height, useContentSize: true, autoHideMenuBar: true, backgroundColor: '#101113',
    webPreferences: { sandbox: true }
  });
  w.loadURL('psimg://img/' + encodeURIComponent(image));
});

// --- Preferences (language / viewMode / skipDeleteConfirm / sortBy) ---
const PREF_KEYS = ['language', 'viewMode', 'skipDeleteConfirm', 'sortBy', 'imageTileSize', 'cardSize', 'listThumb', 'searchMode', 'theme', 'tileOverlay', 'browseMode', 'posterViewMode', 'posterTileSize', 'posterCardSize'];
const VALID_SORTS = ['date-desc', 'date-asc', 'likes-desc', 'reposts-desc', 'replies-desc', 'captured-desc', 'likes-pct'];

ipcMain.handle('get-prefs', () => {
  const cfg = readConfig();
  return {
    language: cfg.language || 'auto',
    viewMode: ['card', 'tile', 'list'].includes(cfg.viewMode) ? cfg.viewMode : 'card',   // display density
    skipDeleteConfirm: !!cfg.skipDeleteConfirm,
    sortBy: VALID_SORTS.includes(cfg.sortBy) ? cfg.sortBy : 'date-desc',
    imageTileSize: (Number.isFinite(cfg.imageTileSize) ? cfg.imageTileSize : null),   // tile view: edge px
    cardSize: (Number.isFinite(cfg.cardSize) ? cfg.cardSize : null),       // card view: min column px
    listThumb: (Number.isFinite(cfg.listThumb) ? cfg.listThumb : null),    // list view: thumbnail px
    tileOverlay: cfg.tileOverlay !== false,   // was missing → pref never restored on restart
    searchMode: cfg.searchMode === 'fuzzy' ? 'fuzzy' : 'normal',   // 検索方式: 通常 / あいまい
    theme: ['auto', 'light', 'dark'].includes(cfg.theme) ? cfg.theme : 'auto',   // システム / ライト / ダーク
    browseMode: cfg.browseMode === 'posters' ? 'posters' : 'posts',   // ライブラリ / 投稿者（起動時に復元）
    posterViewMode: ['card', 'tile', 'list'].includes(cfg.posterViewMode) ? cfg.posterViewMode : 'card',   // 投稿者グリッドの表示密度
    posterTileSize: (Number.isFinite(cfg.posterTileSize) ? cfg.posterTileSize : null),   // 投稿者タイルの一辺px
    posterCardSize: (Number.isFinite(cfg.posterCardSize) ? cfg.posterCardSize : null)    // 投稿者カードの最小列幅px
  };
});

ipcMain.handle('set-pref', (_e, key, value) => {
  if (!PREF_KEYS.includes(key)) return { ok: false };
  const cfg = readConfig();
  cfg[key] = value;
  writeConfig(cfg);
  return { ok: true };
});

// --- File helpers (all confined to the save folder) ---
function resolveInFolder(name) {
  const folder = getSaveFolder();
  if (!folder || !name) return null;
  const resolved = path.resolve(path.join(folder, path.basename(name)));
  return resolved.startsWith(path.resolve(folder)) ? resolved : null;
}

// Recover the captureId base from a filename. The argument may be the primary
// image (<base>.<ext>, any viewable ext), a video poster (<base>-poster.<ext>),
// or the video itself. Strip the -poster marker first, then any extension.
const VIEWABLE_EXTS = ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'avif', 'svg', 'mp4', 'webm', 'mov', 'm4v'];
function baseOf(name) {
  return path.basename(name || '').replace(/-poster\.[a-z0-9]+$/i, '').replace(/\.[a-z0-9]+$/i, '');
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
  let names;
  try { names = await fs.promises.readdir(trashDir); } catch { return; }
  const cutoff = Date.now() - TRASH_DAYS * 86400000;
  const toPurge = new Set();
  for (const f of names) {
    if (!f.toLowerCase().endsWith('.json')) continue;
    const id = f.slice(0, -5);
    try {
      const rec = JSON.parse(await fs.promises.readFile(path.join(trashDir, f), 'utf8'));
      if (rec.trashedAt && Date.parse(rec.trashedAt) < cutoff) toPurge.add(id);
    } catch { /* corrupt sidecar — skip */ }
  }
  if (!toPurge.size) return;
  for (const f of names) {
    for (const id of toPurge) {
      if (f.startsWith(id + '.') || f.startsWith(id + '-')) {
        try { await fs.promises.unlink(path.join(trashDir, f)); } catch { }
        break;
      }
    }
  }
}

ipcMain.handle('image-data-url', async (_e, image) => {
  const p = resolveInFolder(image);
  if (!p) return null;
  try {
    const buf = await fs.promises.readFile(p);
    return 'data:' + mimeForFile(image) + ';base64,' + buf.toString('base64');
  } catch {
    return null;
  }
});

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
      rec = JSON.parse(await fs.promises.readFile(jsonPath, 'utf8'));
      if (rec.image) targets.add(path.basename(rec.image));
      if (rec.video) targets.add(path.basename(rec.video));
      for (const m of (rec.media || [])) { if (m && m.file) targets.add(path.basename(m.file)); }
    } catch { /* sidecar missing/corrupt — fall back to the disk sweep */ }
  }
  try {
    for (const f of await fs.promises.readdir(folder)) {
      if (f.startsWith(`${base}-media-`) || f.startsWith(`${base}-poster.`)) targets.add(f);
    }
  } catch { /* ignore */ }
  const trashDir = getTrashDir();
  await fs.promises.mkdir(trashDir, { recursive: true });
  for (const name of targets) {
    const src = resolveInFolder(name);
    if (src) {
      try { await fs.promises.rename(src, path.join(trashDir, name)); } catch { /* not found */ }
    }
  }
  // Stamp trashedAt in the trash sidecar so auto-purge knows when to expire it.
  const trashJson = path.join(trashDir, `${base}.json`);
  try {
    const r = JSON.parse(await fs.promises.readFile(trashJson, 'utf8'));
    r.trashedAt = new Date().toISOString();
    await fs.promises.writeFile(trashJson, JSON.stringify(r, null, 2), 'utf8');
  } catch { /* sidecar may not exist — trash still works but won't auto-purge */ }
  return { ok: true };
});

ipcMain.handle('list-trash', async () => {
  const trashDir = getTrashDir();
  if (!trashDir) return [];
  let names;
  try { names = await fs.promises.readdir(trashDir); } catch { return []; }
  const records = [];
  for (const f of names) {
    if (!f.toLowerCase().endsWith('.json')) continue;
    try {
      const rec = JSON.parse(await fs.promises.readFile(path.join(trashDir, f), 'utf8'));
      if (rec) records.push(rec);
    } catch { /* skip corrupt sidecar */ }
  }
  records.sort((a, b) => new Date(b.trashedAt || 0) - new Date(a.trashedAt || 0));
  return records;
});

ipcMain.handle('restore-post', async (_e, image) => {
  const trashDir = getTrashDir();
  const folder = getSaveFolder();
  if (!trashDir || !folder) return { ok: false };
  const base = baseOf(image);
  let names;
  try { names = await fs.promises.readdir(trashDir); } catch { return { ok: false }; }
  for (const f of names) {
    if (f.startsWith(base + '.') || f.startsWith(base + '-')) {
      try { await fs.promises.rename(path.join(trashDir, f), path.join(folder, f)); } catch { }
    }
  }
  // Remove trashedAt from the restored sidecar.
  const jsonPath = path.join(folder, `${base}.json`);
  try {
    const r = JSON.parse(await fs.promises.readFile(jsonPath, 'utf8'));
    delete r.trashedAt;
    await fs.promises.writeFile(jsonPath, JSON.stringify(r, null, 2), 'utf8');
  } catch { }
  return { ok: true };
});

ipcMain.handle('empty-trash', async () => {
  const trashDir = getTrashDir();
  if (!trashDir) return { ok: true };
  try { await fs.promises.rm(trashDir, { recursive: true, force: true }); } catch { }
  return { ok: true };
});

ipcMain.handle('delete-from-trash', async (_e, image) => {
  const trashDir = getTrashDir();
  if (!trashDir) return { ok: false };
  const base = baseOf(image);
  let names;
  try { names = await fs.promises.readdir(trashDir); } catch { return { ok: false }; }
  for (const f of names) {
    if (f.startsWith(base + '.') || f.startsWith(base + '-')) {
      try { await fs.promises.unlink(path.join(trashDir, f)); } catch { }
    }
  }
  return { ok: true };
});

ipcMain.handle('update-tags', async (_e, image, tags, patch) => {
  const base = baseOf(image);
  const jsonPath = resolveInFolder(`${base}.json`);
  if (!jsonPath) return { ok: false };
  try {
    const rec = JSON.parse(await fs.promises.readFile(jsonPath, 'utf8'));
    rec.tags = Array.isArray(tags) ? tags.map(String) : [];
    // Optional extra fields (e.g. the tagging wizard's plain/media flag). Only
    // an allow-listed set is honored so the renderer can't write arbitrary keys.
    if (patch && typeof patch === 'object') {
      if ('userKind' in patch) {
        rec.userKind = (patch.userKind === 'plain' || patch.userKind === 'media') ? patch.userKind : null;
      }
      // Tagging "session" marks a post reviewed even when it gets no tags, so
      // it leaves the untagged queue instead of resurfacing every session.
      if ('tagReviewed' in patch) rec.tagReviewed = !!patch.tagReviewed;
    }
    rec.updatedAt = new Date().toISOString();        // record was modified in Corpus
    await fs.promises.writeFile(jsonPath, JSON.stringify(rec, null, 2), 'utf8');
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle('import-posts', async (_e, posts) => {
  const folder = getSaveFolder();
  if (!folder || !Array.isArray(posts)) return { imported: 0, skipped: 0 };
  fs.mkdirSync(folder, { recursive: true });

  const existing = new Set();
  try {
    for (const f of fs.readdirSync(folder)) {
      if (!f.toLowerCase().endsWith('.json') || f === 'config.json' || f === '.index.json') continue;
      try {
        const r = JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8'));
        if (r.url) existing.add(r.url);
      } catch { /* skip */ }
    }
  } catch { /* empty */ }

  // Avatars are downloaded once per unique URL: a legacy library has many posts
  // per author, so dedup the network fetch and reuse the bytes for each record's
  // own <captureId>-avatar.<ext>. null = a URL we already tried and failed.
  const avatarCache = new Map();
  async function fetchAvatarCached(url) {
    if (avatarCache.has(url)) return avatarCache.get(url);
    let got = null;
    try { got = await fetchStillImage(url, pixivRefererFor(url)); } catch { got = null; }
    avatarCache.set(url, got);
    return got;
  }

  const stamp = Date.now();
  let imported = 0, skipped = 0, seq = 0;
  for (const p of posts) {
    if (!p || typeof p.image !== 'string' || !/^data:image\//.test(p.image)) { skipped++; continue; }
    if (p.url && existing.has(p.url)) { skipped++; continue; }
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
      tags: Array.isArray(p.tags) ? p.tags : []
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
        } catch { /* avatar is best-effort */ }
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
    configCorrupt: configLastCorrupt,
    hasExplicitSaveFolder: typeof cfg.saveFolder === 'string' && !!cfg.saveFolder.trim(),
    hasPointer: !!readSavePointer()
  });
  if (blocked) return { ok: false, blocked, count: 0 };
  let count = 0;
  // Keep app metadata (config + migrated tag groups); wipe sidecars + every
  // viewable media type (incl. jfif/avif/svg/video/-poster), mirroring delete-post.
  const CLEAR_RE = new RegExp('\\.(' + VIEWABLE_EXTS.join('|') + '|json)$', 'i');
  try {
    for (const f of fs.readdirSync(folder)) {
      if (f === 'config.json' || f === '.index.json' || f === 'tag-groups.json' || f === 'tag-types.json' || f === 'ungrouped.json' || f === 'manual-groups.json' || f === 'folders.json' || f === 'collections.json' || f === 'tabs.json' || f === 'poster-favorites.json' || f === 'poster-folders.json' || f === 'poster-tags.json') continue;
      if (CLEAR_RE.test(f)) {
        try { fs.unlinkSync(path.join(folder, f)); count++; } catch { /* skip */ }
      }
    }
  } catch { /* empty */ }
  return { ok: true, count };
});

ipcMain.handle('export-save', async (_e, filename, bytes) => {
  const res = await dialog.showSaveDialog(win, { defaultPath: filename });
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
const archive = require(path.join(__dirname, 'lib-archive'));
let _JSZip = null;
function getJSZip() { return _JSZip || (_JSZip = require(path.join(__dirname, 'vendor', 'jszip.min.js'))); }
function exportStamp() { return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19); }

ipcMain.handle('export-complete', async (_e, mode) => {
  const imagesOnly = mode === 'images';
  let built;
  try {
    built = imagesOnly
      ? await archive.buildImagesZip(getJSZip(), getSaveFolder())
      : await archive.buildCompleteZip(getJSZip(), getSaveFolder());
  } catch (err) { return { saved: false, error: err.message }; }
  if (built.fileCount === 0) return { saved: false, empty: true };
  const res = await dialog.showSaveDialog(win, { defaultPath: `corpus-${imagesOnly ? 'images' : 'export'}-${exportStamp()}.zip` });
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
  try { return await archive.importCompleteZip(getJSZip(), getSaveFolder(), Buffer.from(bytes)); }
  catch (err) { return { ok: false, error: err.message }; }
});

// --- バックアップ / 増分ミラー --------------------------------------------------
// 保存先フォルダ自体をクラウド同期フォルダに置くとライブ書き込み中の同期で壊れやすい。
// ここでは選択した「宛先フォルダ」の中に「写し（remote）」を保持する。
// アセットは immutable（一度書いたら変わらない）→ 宛先に無いファイルだけコピー(O(new))。
// 削除は宛先からも伝播（最新ミラー）。ZIP は手動エクスポート専用に残す。
// 宛先直下にぶちまけない安全策として専用サブフォルダに書く（下記 BACKUP_SUBDIR）。
const BACKUP_SUBDIR = 'Corpus-mirror';
function backupDest(dir) { return path.join(dir, BACKUP_SUBDIR); }
// Named subfolder for a relocated library, so picking a folder never dumps
// sidecars/images flat into it (parallel to BACKUP_SUBDIR's Corpus-mirror).
const LIBRARY_SUBDIR = 'Corpus-library';


const BACKUP_DEFAULTS = {
  dir: null,              // 出力先（保存先フォルダの内外と重複しないこと）
  interval: false,        // 一定間隔
  intervalValue: 1,       // 間隔の数
  intervalUnit: 'day',    // 'day' | 'week' | 'month'
  lastRunAt: null,
  lastResult: null
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
  const c = path.resolve(child), p = path.resolve(parent);
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
  } catch { return { ok: false, error: 'not-writable' }; }
  return { ok: true };
}

// Copy the WHOLE library (sidecars, images, media, internal metadata, .trash)
// from src into dest WITHOUT deleting src. The caller flips config to dest only
// after this succeeds, then removes src — so at every instant a COMPLETE library
// exists and config points at one of them. This is the crash-safe ordering: the
// exact invariant whose violation made the library "disappear" before. Aborts
// before copying anything if a name already exists at dest (never clobbers the
// user's files there); rolls back partial copies on failure (src untouched).
async function copyLibraryInto(src, dest, onProgress) {
  let entries;
  try { entries = await fs.promises.readdir(src); } catch { entries = []; }
  entries = entries.filter((f) => !/\.tmp(-\d+)?$/i.test(f));
  await fs.promises.mkdir(dest, { recursive: true });
  for (const f of entries) {
    if (fs.existsSync(path.join(dest, f))) return { ok: false, error: 'collision', name: f };
  }
  const total = entries.length;
  if (onProgress) onProgress(0, total);
  const copied = [];
  try {
    for (const f of entries) {
      await fs.promises.cp(path.join(src, f), path.join(dest, f), { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
      copied.push(f);
      if (onProgress) onProgress(copied.length, total);
    }
  } catch (e) {
    for (const c of copied) { try { await fs.promises.rm(path.join(dest, c), { recursive: true, force: true }); } catch { /* best-effort */ } }
    return { ok: false, error: 'copy-failed', detail: e && e.message };
  }
  return { ok: true, entries };
}

let backupRunning = false;
async function runBackup(reason) {
  const b = readBackupConfig();
  const src = getSaveFolder();
  if (!src || !b.dir) return { ok: false, error: 'not-configured' };
  if (!validateBackupDir(b.dir).ok) return { ok: false, error: 'overlap' };
  if (backupRunning) return { ok: false, error: 'busy' };
  backupRunning = true;
  if (win && !win.isDestroyed()) win.webContents.send('backup-start');   // sidebar sync icon → syncing
  // written = new files copied; pruned = files deleted (propagated deletions)
  const result = { ok: true, reason: reason || 'manual', fileCount: 0, written: 0, pruned: 0 };
  try {
    const dest = backupDest(b.dir);
    await fs.promises.mkdir(dest, { recursive: true });

    // Collect source files, skipping app-internal and transient entries
    let srcFiles;
    try { srcFiles = await fs.promises.readdir(src); } catch { srcFiles = []; }
    const srcSet = new Set();
    for (const f of srcFiles) {
      if (f === '.index.json' || f === TRASH_SUBDIR) continue;
      if (/\.tmp(-\d+)?$/i.test(f)) continue;
      try {
        const st = await fs.promises.stat(path.join(src, f));
        if (st.isFile()) srcSet.add(f);
      } catch { /* skip inaccessible entries */ }
    }
    result.fileCount = srcSet.size;

    // Collect destination files
    let destFiles;
    try { destFiles = await fs.promises.readdir(dest); } catch { destFiles = []; }
    const destSet = new Set(destFiles.filter(f => !/\.tmp(-\d+)?$/i.test(f)));

    // Copy new files (assets are immutable — existence check only, no mtime compare)
    for (const f of srcSet) {
      if (destSet.has(f)) continue;
      const tmp = path.join(dest, f + '.tmp-' + Date.now());
      try {
        await fs.promises.copyFile(path.join(src, f), tmp);
        await fs.promises.rename(tmp, path.join(dest, f));
        result.written++;
      } catch (e) {
        try { await fs.promises.unlink(tmp); } catch { }
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
          try { await fs.promises.unlink(path.join(dest, f)); result.pruned++; } catch { }
        }
      }
    }
    result.lastGoodCount = nextBaseline(decision.skip, srcSet.size, baseline);
  } catch (err) {
    result.ok = false; result.error = err.message;
  } finally {
    backupRunning = false;
  }
  const at = new Date().toISOString();
  const summary = { fileCount: result.fileCount, written: result.written, pruned: result.pruned,
    reason: result.reason, ok: result.ok, error: result.error || result.firstError || null, at: at,
    pruneSkipped: result.pruneSkipped || null, baselineCount: result.baselineCount || 0,
    lastGoodCount: typeof result.lastGoodCount === 'number' ? result.lastGoodCount : 0 };
  try { writeBackupConfig({ lastRunAt: at, lastResult: summary }); } catch { /* ignore */ }
  if (win && !win.isDestroyed()) win.webContents.send('backup-done', Object.assign({}, result, { at: at }));
  return result;
}

let backupIntervalTimer = null;
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
  if (backupIntervalTimer) { clearInterval(backupIntervalTimer); backupIntervalTimer = null; }
  const b = readBackupConfig();
  if (!b.dir || !b.interval) return;
  backupIntervalTimer = setInterval(() => {
    const cur = readBackupConfig();
    if (!cur.dir || !cur.interval) return;
    const last = cur.lastRunAt ? Date.parse(cur.lastRunAt) : 0;
    if ((Date.now() - last) >= backupIntervalMs(cur)) runBackup('interval');
  }, BACKUP_HEARTBEAT_MS);
}

ipcMain.handle('get-backup', () => readBackupConfig());
ipcMain.handle('set-backup', (_e, patch) => {
  patch = patch || {};
  if ('dir' in patch && patch.dir) {
    const v = validateBackupDir(patch.dir);
    if (!v.ok) return { ok: false, error: v.error, backup: readBackupConfig() };
  }
  const backup = writeBackupConfig(patch);
  armBackupSchedule();
  return { ok: true, backup };
});
ipcMain.handle('pick-backup-dir', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
  const dir = res.filePaths[0];
  const v = validateBackupDir(dir);
  if (!v.ok) return { ok: false, error: v.error };
  const backup = writeBackupConfig({ dir });
  armBackupSchedule();
  return { ok: true, backup };
});
ipcMain.handle('run-backup', () => runBackup('manual'));

// Change where the library lives. Picks a folder, MOVES the existing library
// there (crash-safe: copy → flip config → delete old), then re-points the watcher
// and forces the renderer to resync. The native host reads saveFolder from the
// same config.json, so new captures follow automatically.
ipcMain.handle('pick-save-folder', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
  const chosen = res.filePaths[0];
  // Treat the picked folder as a PARENT and put the library in a named subfolder
  // — never dump sidecars/images flat into a folder that may hold the user's own
  // files. If they re-pick an existing Corpus-library folder, use it as-is (no
  // double nesting).
  const dest = path.basename(chosen).toLowerCase() === LIBRARY_SUBDIR.toLowerCase()
    ? chosen
    : path.join(chosen, LIBRARY_SUBDIR);
  const src = getSaveFolder();
  const v = validateSaveFolder(dest);
  if (!v.ok) return { ok: false, error: v.error };

  const emit = (payload) => { if (win && !win.isDestroyed()) win.webContents.send('save-folder-progress', payload); };

  // 1) Copy the whole library into dest. src stays fully intact. Throttle copy
  //    progress to ~100ms so an 18k-file move doesn't flood IPC.
  let lastEmit = 0;
  const cp = await copyLibraryInto(src, dest, (done, total) => {
    const now = Date.now();
    if (done === 0 || done === total || now - lastEmit >= 100) {
      lastEmit = now;
      emit({ phase: 'copy', done, total, percent: total ? Math.floor((done / total) * 100) : 100 });
    }
  });
  if (!cp.ok) { emit({ phase: 'error', error: cp.error }); return { ok: false, error: cp.error, name: cp.name }; }

  // 2) Flip config to dest — dest is now authoritative AND complete.
  emit({ phase: 'switch' });
  const cfg = readConfig();
  cfg.saveFolder = dest;
  writeConfig(cfg);

  // 3) Remove the old copies (best-effort; data is safe at dest regardless).
  emit({ phase: 'cleanup' });
  for (const f of cp.entries) {
    try { await fs.promises.rm(path.join(src, f), { recursive: true, force: true }); } catch { /* harmless leftover */ }
  }

  // Re-point the watcher and drop the delta baseline so the renderer full-resyncs.
  watchSaveFolder();
  _deltaFolder = null;
  _lastSent = new Map();

  emit({ phase: 'done', moved: cp.entries.length });
  return { ok: true, saveFolder: dest, moved: cp.entries.length };
});

// 任意の画像ファイルをライブラリ画像として取り込む（ユーザー自前の画像でもOK）。
// source:'drag' を付けるので画像閲覧に出る。Corpusのメディアのみエクスポートの取り込みも兼ねる。
const IMPORTABLE_IMG = ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'avif', 'bmp', 'tiff', 'svg'];
const IMPORTABLE_VID = ['mp4', 'webm', 'mov', 'm4v'];
const IMPORTABLE_MEDIA = IMPORTABLE_IMG.concat(IMPORTABLE_VID);
ipcMain.handle('import-images', async () => {
  const folder = getSaveFolder();
  if (!folder) return { imported: 0, skipped: 0, error: 'no-folder' };
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Media', extensions: IMPORTABLE_MEDIA }]
  });
  if (res.canceled || !res.filePaths || !res.filePaths.length) return { imported: 0, skipped: 0, canceled: true };
  fs.mkdirSync(folder, { recursive: true });
  let imported = 0, skipped = 0, seq = 0;
  const stamp = Date.now();
  for (const fp of res.filePaths) {
    try {
      const ext = (path.extname(fp).slice(1) || 'png').toLowerCase();
      if (!IMPORTABLE_MEDIA.includes(ext)) { skipped++; continue; }
      const st = await fs.promises.stat(fp);
      if (!st.isFile()) { skipped++; continue; }
      const isVid = IMPORTABLE_VID.includes(ext);
      const captureId = `drag-${stamp}-${String(seq++).padStart(4, '0')}`;
      const file = `${captureId}.${ext}`;
      const nowIso = new Date().toISOString();
      const mtimeIso = (st.mtime && !isNaN(st.mtime.getTime())) ? st.mtime.toISOString() : nowIso;
      const rec = {
        captureId, source: 'drag', url: null, platform: null,
        title: path.basename(fp, path.extname(fp)) || null, text: null,
        displayName: null, screenName: null, mediaType: isVid ? 'video' : 'image',
        capturedAt: nowIso, date: mtimeIso, updatedAt: nowIso,
        media: [], tags: [], hashtags: []
      };
      if (isVid) rec.video = file; else rec.image = file;
      await fs.promises.copyFile(fp, path.join(folder, file));
      await fs.promises.writeFile(path.join(folder, `${captureId}.json`), JSON.stringify(rec, null, 2), 'utf8');
      imported++;
    } catch { skipped++; }
  }
  return { imported, skipped };
});

// --- Window size/position persistence ---
// The window was fixed at 1100x820 every launch. Save bounds to config.json
// (`windowBounds`) and restore them, clamped to a visible display so a
// disconnected monitor can't reopen the window off-screen.
let _boundsSaveTimer = null;
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
  } catch { /* best-effort */ }
}
function savedWindowBounds() {
  const b = readConfig().windowBounds;
  if (!b || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width < 400 || b.height < 300) return null;
  try {
    const { screen } = require('electron');
    const onScreen = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
    });
    // Off-screen (e.g. monitor unplugged) → keep the size, drop x/y so the OS centers it.
    if (!onScreen || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
      return { width: b.width, height: b.height, isMaximized: !!b.isMaximized };
    }
  } catch { /* screen module unavailable before ready — fall through to use as-is */ }
  return { x: b.x, y: b.y, width: b.width, height: b.height, isMaximized: !!b.isMaximized };
}

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
      backgroundThrottling: false
    }
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
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { theme, ...(smoke ? { smoke: '1' } : {}) } });
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
  try { if (!readConfig().saveFolder) fs.mkdirSync(defaultLibraryDir(), { recursive: true }); } catch { /* ignore */ }
  if (!SMOKE) ensureHostRegistered();
  registerImageProtocol();
  const startMin = !SMOKE && process.env.CORPUS_START_MINIMIZED === '1';
  createWindow(!SMOKE && !startMin);   // start-minimized → create hidden, then show inactive below
  watchSaveFolder();
  // Dev-only: hot-reload the renderer when its source (js/html/css) changes, so
  // iterating on UI/CSS needs no manual reload — and no terminal-spawning reload
  // command from outside. Packaged builds never watch.
  if (!SMOKE && !app.isPackaged) {
    try {
      let _rendererReloadT = null;
      fs.watch(path.join(__dirname, 'renderer'), { recursive: true }, (_e, fn) => {
        if (!fn || !/\.(js|html|css)$/i.test(String(fn))) return;
        clearTimeout(_rendererReloadT);
        _rendererReloadT = setTimeout(() => {
          if (win && !win.isDestroyed()) win.webContents.reloadIgnoringCache();
        }, 180);
      });
    } catch { /* dev watcher is best-effort */ }
  }
  if (!SMOKE) {
    armBackupSchedule();                                  // interval スケジュールを起動
    // 起動時の取り戻し: 前回から間隔以上空いていれば1回だけ実行（閉じている間に逃した分）。
    const bk = readBackupConfig();
    if (bk.dir && bk.interval) {
      const last = bk.lastRunAt ? Date.parse(bk.lastRunAt) : 0;
      if (!last || (Date.now() - last) >= backupIntervalMs(bk)) setTimeout(() => runBackup('startup-overdue'), 4000);
    }
    setTimeout(() => purgeOldTrash(), 6000);   // expire old trash entries on startup
  }

  if (SMOKE) {
    const shot = process.env.CORPUS_SMOKE_SHOT;
    win.webContents.on('console-message', (_e, level, message) => {
      console.log(`[renderer:${level}] ${message}`);
    });
    let done = false;
    const quit = (tag) => { if (done) return; done = true; console.log(tag); app.quit(); };
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (process.env.CORPUS_SMOKE_EVAL) {
        try {
          const r = await win.webContents.executeJavaScript(process.env.CORPUS_SMOKE_EVAL);
          console.log('EVAL_RESULT', JSON.stringify(r));
        } catch (e) { console.log('EVAL_ERR', e.message); }
      }
      if (shot) {
        try {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(shot, img.toPNG());
        } catch (err) {
          console.error('capture failed:', err);
        }
      }
      quit('SMOKE_OK');
    }, 1300));
    setTimeout(() => quit('SMOKE_TIMEOUT'), 9000);
    return;
  }

  // Start minimized when launched on the user's behalf, WITHOUT stealing focus or
  // flashing the taskbar button: show inactive (no focus → no FlashWindowEx), then
  // minimize and explicitly clear any pending attention flash. (A normal launch
  // opens a focused window.)
  if (startMin && win) {
    win.once('ready-to-show', () => {
      win.showInactive();
      win.minimize();
      win.flashFrame(false);
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
