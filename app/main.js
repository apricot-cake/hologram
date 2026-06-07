'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, protocol, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

// native-host/ lives outside app/. In dev it's a sibling dir; when packaged it
// is bundled as an extraResource under resources/native-host.
const nativeHostDir = app.isPackaged
  ? path.join(process.resourcesPath, 'native-host')
  : path.join(__dirname, '..', 'native-host');
const { configDir } = require(path.join(nativeHostDir, 'paths'));
const installer = require(path.join(nativeHostDir, 'install'));

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
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(cfg) {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

function getSaveFolder() {
  const folder = readConfig().saveFolder;
  return (typeof folder === 'string' && folder.trim()) ? folder : null;
}

// Watch the save folder and tell the renderer to refresh when files change
// (e.g. a new capture arrives, or dummy data is injected). Debounced because a
// single capture writes both a .jpg and a .json.
let folderWatcher = null;
let watchDebounce = null;
function watchSaveFolder() {
  if (folderWatcher) {
    try { folderWatcher.close(); } catch { /* already closed */ }
    folderWatcher = null;
  }
  const folder = getSaveFolder();
  if (!folder) return;
  try {
    folderWatcher = fs.watch(folder, (_event, filename) => {
      if (filename && !/\.(jpe?g|jfif|png|webp|gif|json)$/i.test(filename)) return;
      clearTimeout(watchDebounce);
      watchDebounce = setTimeout(() => {
        if (win && !win.isDestroyed()) win.webContents.send('posts-changed');
      }, 400);
    });
  } catch (err) {
    console.error('Failed to watch save folder:', err);
  }
}

// --- Posts (scan sidecars) ---
function listPosts() {
  const folder = getSaveFolder();
  if (!folder) return { saveFolder: null, posts: [] };

  let files;
  try {
    files = fs.readdirSync(folder);
  } catch {
    return { saveFolder: folder, posts: [] };
  }

  const posts = [];
  for (const f of files) {
    if (!f.toLowerCase().endsWith('.json')) continue;
    if (f === 'config.json' || f === '.index.json' || f === 'tag-groups.json') continue;
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8'));
      // Keep records with an image, a (poster-less) video, or downloaded media.
      if (rec && (rec.image || rec.video || (Array.isArray(rec.media) && rec.media.length))) posts.push(rec);
    } catch {
      // Skip corrupt/partial sidecar.
    }
  }
  posts.sort((a, b) => new Date(b.capturedAt || 0) - new Date(a.capturedAt || 0));
  return { saveFolder: folder, posts };
}

// --- Native host registration (idempotent, on each launch) ---
function ensureHostRegistered() {
  try {
    // Don't clobber an existing registration: the launcher may have been written
    // with a node binary on an ASCII path, whereas process.execPath here is the
    // Electron binary (possibly under a non-ASCII path that cmd.exe would mangle
    // in a .bat). Only do a full install when nothing is registered yet.
    if (fs.existsSync(installer.manifestPath())) return;
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
  const key = `${name}.${Math.round(st.mtimeMs)}.w${w}.jpg`.replace(/[^\w.\-]/g, '_');
  const cachePath = path.join(thumbCacheDir(), key);
  try { return await fs.promises.readFile(cachePath); } catch { /* cache miss */ }
  try {
    let img = nativeImage.createFromPath(resolved);
    if (img.isEmpty()) return null;
    if (img.getSize().width > w) img = img.resize({ width: w, quality: 'good' });
    const buf = img.toJPEG(78);
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
      if (!name) return new Response('Not found', { status: 404 });

      const filePath = path.join(folder, name);
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(folder))) {
        return new Response('Forbidden', { status: 403 });
      }

      const w = parseInt(url.searchParams.get('w') || '', 10);
      if (Number.isFinite(w) && w >= 64 && w <= 720) {
        const thumb = await getThumbnail(resolved, name, w);
        if (thumb) return new Response(thumb, { headers: { 'content-type': 'image/jpeg' } });
        // fall through to the original if thumbnailing failed
      }

      const data = await fs.promises.readFile(resolved);
      return new Response(data, { headers: { 'content-type': mimeForFile(name) } });
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

ipcMain.handle('pick-save-folder', async () => {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || !res.filePaths[0]) {
    return { saveFolder: getSaveFolder() };
  }
  const cfg = readConfig();
  cfg.saveFolder = res.filePaths[0];
  writeConfig(cfg);
  watchSaveFolder();
  return { saveFolder: cfg.saveFolder };
});

ipcMain.handle('list-posts', () => listPosts());

// Tag groups (migrated from Eagle's library metadata) live alongside the
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

ipcMain.handle('open-external', (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
  }
});

// --- Preferences (language / viewMode / skipDeleteConfirm / sortBy) ---
const PREF_KEYS = ['language', 'viewMode', 'skipDeleteConfirm', 'sortBy'];
const VALID_SORTS = ['date-desc', 'date-asc', 'likes-desc', 'reposts-desc', 'replies-desc', 'captured-desc'];

ipcMain.handle('get-prefs', () => {
  const cfg = readConfig();
  return {
    language: cfg.language || 'auto',
    viewMode: cfg.viewMode === 'list' ? 'list' : 'grid',
    skipDeleteConfirm: !!cfg.skipDeleteConfirm,
    sortBy: VALID_SORTS.includes(cfg.sortBy) ? cfg.sortBy : 'date-desc'
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
  // The arg may be a screenshot jpg, an illustration of any ext, or a video
  // poster — baseOf() recovers <captureId>. Delete the sidecar, the primary of
  // any viewable ext, the video poster, and original-media files.
  const base = baseOf(image);
  const targets = new Set([`${base}.json`]);
  for (const e of VIEWABLE_EXTS) targets.add(`${base}.${e}`);
  // Exact names from the sidecar (image / video / media), then sweep the disk for
  // <base>-media-* and <base>-poster.* (covers a missing/partial sidecar). The
  // anchors prevent matching a different post whose id is a prefix.
  const jsonPath = resolveInFolder(`${base}.json`);
  if (jsonPath) {
    try {
      const rec = JSON.parse(await fs.promises.readFile(jsonPath, 'utf8'));
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
  for (const name of targets) {
    const f = resolveInFolder(name);
    if (f) {
      try { await fs.promises.unlink(f); } catch { /* may not exist */ }
    }
  }
  return { ok: true };
});

ipcMain.handle('update-tags', async (_e, image, tags) => {
  const base = baseOf(image);
  const jsonPath = resolveInFolder(`${base}.json`);
  if (!jsonPath) return { ok: false };
  try {
    const rec = JSON.parse(await fs.promises.readFile(jsonPath, 'utf8'));
    rec.tags = Array.isArray(tags) ? tags.map(String) : [];
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
  let count = 0;
  // Keep app metadata (config + migrated tag groups); wipe sidecars + every
  // viewable media type (incl. jfif/avif/svg/video/-poster), mirroring delete-post.
  const CLEAR_RE = new RegExp('\\.(' + VIEWABLE_EXTS.join('|') + '|json)$', 'i');
  try {
    for (const f of fs.readdirSync(folder)) {
      if (f === 'config.json' || f === '.index.json' || f === 'tag-groups.json') continue;
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

// --- Window ---
function createWindow(show = true) {
  win = new BrowserWindow({
    width: 1100,
    height: 820,
    show,
    backgroundColor: '#0f1419',
    title: 'Corpus',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
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
  if (!SMOKE) ensureHostRegistered();
  registerImageProtocol();
  createWindow(!SMOKE);
  watchSaveFolder();

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
    }, 900));
    setTimeout(() => quit('SMOKE_TIMEOUT'), 9000);
    return;
  }

  // Start minimized when launched on the user's behalf (env-gated; a normal
  // user launch still opens a focused window).
  if (process.env.CORPUS_START_MINIMIZED === '1' && win) win.minimize();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
