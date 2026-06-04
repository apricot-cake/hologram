'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, protocol } = require('electron');
const fs = require('fs');
const path = require('path');

const { configDir } = require('../native-host/paths');
const installer = require('../native-host/install');

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
    if (f === 'config.json' || f === '.index.json') continue;
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8'));
      if (rec && rec.image) posts.push(rec);
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
    // In Electron, process.execPath is the Electron binary; run the bridge via
    // it in Node mode so end users don't need a separate Node install.
    installer.install({ exe: process.execPath, runAsNode: true });
  } catch (err) {
    console.error('Failed to register native messaging host:', err);
  }
}

// --- Image protocol ---
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

      const data = await fs.promises.readFile(resolved);
      return new Response(data, { headers: { 'content-type': 'image/jpeg' } });
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
  ensureHostRegistered(); // re-write the host manifest with the new allowed origin
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
  return { saveFolder: cfg.saveFolder };
});

ipcMain.handle('list-posts', () => listPosts());

ipcMain.handle('open-external', (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
  }
});

// --- Preferences (language / viewMode / skipDeleteConfirm) ---
const PREF_KEYS = ['language', 'viewMode', 'skipDeleteConfirm'];

ipcMain.handle('get-prefs', () => {
  const cfg = readConfig();
  return {
    language: cfg.language || 'auto',
    viewMode: cfg.viewMode === 'list' ? 'list' : 'grid',
    skipDeleteConfirm: !!cfg.skipDeleteConfirm
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

ipcMain.handle('image-data-url', async (_e, image) => {
  const p = resolveInFolder(image);
  if (!p) return null;
  try {
    const buf = await fs.promises.readFile(p);
    return 'data:image/jpeg;base64,' + buf.toString('base64');
  } catch {
    return null;
  }
});

ipcMain.handle('delete-post', async (_e, image) => {
  if (!getSaveFolder() || !image) return { ok: false };
  const base = path.basename(image).replace(/\.jpe?g$/i, '');
  for (const name of [`${base}.jpg`, `${base}.jpeg`, `${base}.json`]) {
    const f = resolveInFolder(name);
    if (f) {
      try { await fs.promises.unlink(f); } catch { /* may not exist */ }
    }
  }
  return { ok: true };
});

ipcMain.handle('update-tags', async (_e, image, tags) => {
  const base = path.basename(image || '').replace(/\.jpe?g$/i, '');
  const jsonPath = resolveInFolder(`${base}.json`);
  if (!jsonPath) return { ok: false };
  try {
    const rec = JSON.parse(await fs.promises.readFile(jsonPath, 'utf8'));
    rec.tags = Array.isArray(tags) ? tags.map(String) : [];
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
      mediaType: p.mediaType || null,
      lang: p.lang || null,
      isReply: p.isReply || null,
      isQuote: p.isQuote || null,
      isThread: p.isThread || null,
      quotedUrl: p.quotedUrl || null,
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
  try {
    for (const f of fs.readdirSync(folder)) {
      if (f === 'config.json' || f === '.index.json') continue;
      if (/\.(jpe?g|json)$/i.test(f)) {
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
    title: 'Post Snap',
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
// and quits once the renderer has loaded. Run with POSTSNAP_SMOKE=1.
const SMOKE = process.env.POSTSNAP_SMOKE === '1';

app.whenReady().then(() => {
  if (!SMOKE) ensureHostRegistered();
  registerImageProtocol();
  createWindow(!SMOKE);

  if (SMOKE) {
    const shot = process.env.POSTSNAP_SMOKE_SHOT;
    win.webContents.on('console-message', (_e, level, message) => {
      console.log(`[renderer:${level}] ${message}`);
    });
    let done = false;
    const quit = (tag) => { if (done) return; done = true; console.log(tag); app.quit(); };
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (process.env.POSTSNAP_SMOKE_EVAL) {
        try {
          const r = await win.webContents.executeJavaScript(process.env.POSTSNAP_SMOKE_EVAL);
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
