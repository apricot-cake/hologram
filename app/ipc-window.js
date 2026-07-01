'use strict';

// Window / shell IPC handlers, extracted from main.js (mechanical move — logic
// unchanged). open-external opens an https URL in the OS browser; open-image-window
// pops one library image into its own window via the psimg:// protocol. Electron
// primitives are re-required here; getSaveFolder + APP_ICON arrive via ctx.
const { ipcMain, shell, BrowserWindow, nativeImage, screen } = require('electron');
const path = require('path');

function register(ctx) {
  const { getSaveFolder, APP_ICON } = ctx;

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
      icon: APP_ICON,
      webPreferences: { sandbox: true }
    });
    w.loadURL('psimg://img/' + encodeURIComponent(image));
  });
}

module.exports = { register };
