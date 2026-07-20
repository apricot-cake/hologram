'use strict';

// Window / shell IPC handlers, extracted from main.js (mechanical move — logic
// unchanged). open-external opens an https URL in the OS browser; open-image-window
// pops one library image into its own window via the asset:// protocol; drag-out /
// copy-image hand library originals to other apps (#132). Electron primitives are
// re-required here; getSaveFolder + APP_ICON arrive via ctx.
import { ipcMain, shell, BrowserWindow, clipboard, nativeImage, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { isLibraryFileName, libraryFilePaths } from './library-files.mts';

function register(ctx) {
  const { getSaveFolder, APP_ICON } = ctx;
  const libraryPath = (file) => path.join(getSaveFolder(), file);

  ipcMain.handle('open-external', (_event, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });

  // Reveal one library file in the OS file manager (card context menu).
  ipcMain.handle('show-in-folder', (_event, file) => {
    if (!isLibraryFileName(file)) return;
    shell.showItemInFolder(libraryPath(file));
  });

  // Open one library image in its own frameless-ish window (middle-click on a
  // card). The asset:// protocol is registered app-wide, so a bare loadURL shows
  // Chromium's built-in image view (zoom/fit for free).
  ipcMain.handle('open-image-window', (_event, image) => {
    if (!isLibraryFileName(image)) return;
    // Size the window to the image's aspect ratio (fit within ~85% of the work area).
    let width = 1100;
    let height = 850;
    try {
      const sz = nativeImage.createFromPath(libraryPath(image)).getSize();
      if (sz.width > 0 && sz.height > 0) {
        const wa = screen.getPrimaryDisplay().workAreaSize;
        const scale = Math.min(1, (wa.width * 0.85) / sz.width, (wa.height * 0.85) / sz.height);
        width = Math.max(320, Math.round(sz.width * scale));
        height = Math.max(240, Math.round(sz.height * scale));
      }
    } catch {
      /* keep defaults (e.g. webp not decodable by nativeImage) */
    }
    const w = new BrowserWindow({
      width,
      height,
      useContentSize: true,
      autoHideMenuBar: true,
      backgroundColor: '#101113',
      icon: APP_ICON,
      webPreferences: { sandbox: true },
    });
    w.loadURL('asset://img/' + encodeURIComponent(image));
  });

  // Drag cards out to another app (#132): Explorer, PureRef, a chat window —
  // whatever accepts dropped files. `on`, not `handle`: startDrag has to run
  // inside the dragstart the renderer is still holding open, and an invoke
  // round-trip would land after the gesture is already over.
  ipcMain.on('drag-out', (event, files) => {
    // Always the ORIGINALS: the renderer only ever sees asset:// thumbnail URLs,
    // so the names it sends are the sidecar's, and this is where they become real
    // paths (missing files drop out — see library-files.mts).
    const paths = libraryFilePaths(files, getSaveFolder(), fs.existsSync);
    if (!paths.length) return;
    try {
      // `files` is what actually ships; `file` is the pre-multi-file field the
      // type still requires (Electron ignores it when `files` is present).
      event.sender.startDrag({ file: paths[0], files: paths, icon: dragIcon(paths[0]) });
    } catch (e) {
      // A rejected icon (or a drag the OS refuses) must not take the app down —
      // the gesture just doesn't start.
      console.error('drag-out failed', e);
    }
  });

  // startDrag REQUIRES a non-empty icon, so anything nativeImage can't decode
  // (svg, video, a broken file) falls back to the app icon rather than throwing.
  function dragIcon(file) {
    const img = nativeImage.createFromPath(file);
    return (img.isEmpty() ? nativeImage.createFromPath(APP_ICON) : img).resize({ width: 64 });
  }

  // Copy one library image to the clipboard (card menu / Ctrl+C — #132). Returns
  // false when nativeImage can't decode the file (svg, some tiff): writing the
  // empty image would silently WIPE the clipboard, so the renderer reports the
  // failure instead.
  ipcMain.handle('copy-image', (_event, file) => {
    if (!isLibraryFileName(file)) return false;
    const img = nativeImage.createFromPath(libraryPath(file));
    if (img.isEmpty()) return false;
    clipboard.writeImage(img);
    return true;
  });
}

export { register };
