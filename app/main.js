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
    let done = false;
    const quit = (tag) => { if (done) return; done = true; console.log(tag); app.quit(); };
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
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
