'use strict';

// Config / preferences / tabs IPC handlers, extracted from main.js (mechanical move —
// logic unchanged). These touch config.json (get-config/set-extension-id/get-prefs/
// set-pref), the tabs.json org file (get/set-tabs), the window title-bar overlay, and
// static build info (app-info). Core helpers arrive via ctx; the pref key/sort
// allow-lists live here (used only by these handlers).
import { ipcMain, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// --- Preferences (language / viewMode / skipDeleteConfirm / sortBy) ---
const PREF_KEYS = ['language', 'viewMode', 'skipDeleteConfirm', 'sortBy', 'imageTileSize', 'cardSize', 'listThumb', 'theme', 'tileOverlay', 'browseMode', 'posterViewMode', 'posterTileSize', 'posterCardSize', 'sidebarOpen'];
const VALID_SORTS = ['date-desc', 'date-asc', 'likes-desc', 'reposts-desc', 'replies-desc', 'captured-desc', 'likes-pct'];

// Chrome extension ids are exactly 32 chars of a–p. The id crosses a trust
// boundary (IPC arg → native-messaging manifest allowed_origins), so anything
// else is coerced to '' — same handling as an empty id (see install.js).
const VALID_EXT_ID = /^[a-p]{32}$/;

function register(ctx) {
  const { readConfig, writeConfig, getSaveFolder, readOrgJsonSync, writeOrgJsonSync, installer, getWin } = ctx;

  ipcMain.handle('get-config', () => {
    const cfg = readConfig();
    return { saveFolder: getSaveFolder(), extensionId: cfg.extensionId || null };
  });

  ipcMain.handle('set-extension-id', (_event, id) => {
    const cfg = readConfig();
    const trimmed = typeof id === 'string' ? id.trim() : '';
    cfg.extensionId = VALID_EXT_ID.test(trimmed) ? trimmed : '';
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

  // Window controls. The min/max/close buttons are drawn by the app (renderer DOM), not by
  // the OS overlay, so the window commands they used to carry natively come over IPC now.
  // See the AppShell WindowControls island for why they are app-drawn.
  ipcMain.handle('window-control', (_e, action) => {
    const win = getWin();
    if (!win) return null;
    if (action === 'minimize') win.minimize();
    else if (action === 'toggle-maximize') {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === 'close') win.close();
    return win.isMaximized();
  });

  // The maximize button's glyph follows the real window state, which changes without us
  // (snap, double-click on the drag strip, Win+Up, the taskbar). Push it instead of making
  // the renderer poll.
  ipcMain.handle('window-is-maximized', () => {
    const win = getWin();
    return !!win && win.isMaximized();
  });

  ipcMain.handle('get-tabs', () => {
    const folder = getSaveFolder();
    if (!folder) return null;
    const { value: raw } = readOrgJsonSync(path.join(folder, 'tabs.json'));
    return raw && Array.isArray(raw.tabs) ? raw : null;
  });
  ipcMain.handle('set-tabs', (_e, data) => {
    const folder = getSaveFolder();
    if (!folder) return { ok: false };
    try {
      writeOrgJsonSync(path.join(folder, 'tabs.json'), data);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // Build/version info for the settings "About" panel. app.getVersion() reads the
  // loaded app's package.json (1.1.0), so it is correct in dev and packaged alike.
  ipcMain.handle('app-info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
  }));

  ipcMain.handle('get-prefs', () => {
    const cfg = readConfig();
    return {
      language: cfg.language || 'auto',
      viewMode: ['card', 'tile', 'list'].includes(cfg.viewMode) ? cfg.viewMode : 'card', // display density
      skipDeleteConfirm: !!cfg.skipDeleteConfirm,
      sortBy: VALID_SORTS.includes(cfg.sortBy) ? cfg.sortBy : 'date-desc',
      imageTileSize: Number.isFinite(cfg.imageTileSize) ? cfg.imageTileSize : null, // tile view: edge px
      cardSize: Number.isFinite(cfg.cardSize) ? cfg.cardSize : null, // card view: min column px
      listThumb: Number.isFinite(cfg.listThumb) ? cfg.listThumb : null, // list view: thumbnail px
      tileOverlay: cfg.tileOverlay !== false, // was missing → pref never restored on restart
      theme: ['auto', 'light', 'dark'].includes(cfg.theme) ? cfg.theme : 'auto', // システム / ライト / ダーク
      browseMode: cfg.browseMode === 'posters' ? 'posters' : 'posts', // ライブラリ / 投稿者（起動時に復元）
      posterViewMode: ['card', 'tile', 'list'].includes(cfg.posterViewMode) ? cfg.posterViewMode : 'card', // 投稿者グリッドの表示密度
      posterTileSize: Number.isFinite(cfg.posterTileSize) ? cfg.posterTileSize : null, // 投稿者タイルの一辺px
      posterCardSize: Number.isFinite(cfg.posterCardSize) ? cfg.posterCardSize : null, // 投稿者カードの最小列幅px
      sidebarOpen: typeof cfg.sidebarOpen === 'boolean' ? cfg.sidebarOpen : null, // sidebar expanded/collapsed; null = never toggled
    };
  });

  ipcMain.handle('set-pref', (_e, key, value) => {
    if (!PREF_KEYS.includes(key)) return { ok: false };
    const cfg = readConfig();
    cfg[key] = value;
    writeConfig(cfg);
    return { ok: true };
  });
}

export { register };
