'use strict';

// Window / shell IPC handlers, extracted from main.js (mechanical move — logic
// unchanged). open-external opens an https URL in the OS browser; open-image-window
// pops one library image into its own window via the asset:// protocol; drag-out /
// copy-image hand library originals to other apps (#132). Electron primitives are
// re-required here; getSaveFolder + APP_ICON arrive via ctx.
import { ipcMain, shell, BrowserWindow, clipboard, nativeImage, screen } from 'electron';
import fs from 'node:fs';
import { isViewerImageName, libraryFilePath, libraryFilePaths } from './library-files.ts';
import { isOpenAllowed } from './lib-open-gate.ts';
import type { IpcContext } from './ipc-context.ts';

function register(ctx: IpcContext) {
  const { getSaveFolder, APP_ICON } = ctx;
  // Every handler below hands a library file to something OUTSIDE the app, so
  // they all resolve through the one export gate (library-files.ts) rather than
  // joining a path themselves.
  const exportPath = (file: unknown) => libraryFilePath(file, getSaveFolder());

  ipcMain.handle('open-external', (_event, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });

  // Reveal one library file in the OS file manager (card context menu).
  ipcMain.handle('show-in-folder', (_event, file) => {
    const p = exportPath(file);
    if (p) shell.showItemInFolder(p);
  });

  // "開く" on a collected-item card (#236, assetClass:'file'): hand the file to
  // its OS default app ONLY when the allowlist (extension + magic bytes for
  // the formats that carry one, lib-open-gate.ts) says yes at THIS moment —
  // not what importLocalFile decided when the file was collected, since it
  // could have been swapped on disk since. Anything else degrades to reveal-
  // in-folder rather than refusing outright (the button never promises more
  // than that either — see records.ts's fileOpenLabel). Returns which one it
  // did, so the renderer can tell the user which happened.
  ipcMain.handle('open-post-file', async (_event, file): Promise<{ opened: boolean }> => {
    const p = exportPath(file);
    if (!p) return { opened: false };
    if (await isOpenAllowed(p)) {
      shell.openPath(p);
      return { opened: true };
    }
    shell.showItemInFolder(p);
    return { opened: false };
  });

  // Open one library image in its own frameless-ish window (middle-click on a
  // card). The asset:// protocol is registered app-wide, so a bare loadURL shows
  // Chromium's built-in image view (zoom/fit for free).
  //
  // Raster only (isViewerImageName, #215): what this window really does is turn
  // a library file into a TOP-LEVEL document on the library's own origin, and
  // for an SVG that document is a scripted one. Returns false when refused, the
  // same shape copy-image already uses for "this file isn't showable".
  ipcMain.handle('open-image-window', (_event, image) => {
    if (!isViewerImageName(image)) return false;
    const source = exportPath(image);
    if (!source) return false;
    // Size the window to the image's aspect ratio (fit within ~85% of the work area).
    let width = 1100;
    let height = 850;
    try {
      const sz = nativeImage.createFromPath(source).getSize();
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
      // Headless harness runs (HOLOGRAM_SMOKE=1) create every window hidden, the
      // main one included — a verification run must never take over the screen
      // the developer is using. The window still loads and runs its document, so
      // the asset:// hardening above is testable end to end.
      show: process.env.HOLOGRAM_SMOKE !== '1',
      useContentSize: true,
      autoHideMenuBar: true,
      backgroundColor: '#101113',
      icon: APP_ICON,
      webPreferences: { sandbox: true },
    });
    w.loadURL('asset://img/' + encodeURIComponent(image));
    return true;
  });

  // Drag cards out to another app (#132): Explorer, PureRef, a chat window —
  // whatever accepts dropped files. `on`, not `handle`: startDrag has to run
  // inside the dragstart the renderer is still holding open, and an invoke
  // round-trip would land after the gesture is already over.
  ipcMain.on('drag-out', (event, files) => {
    // Always the ORIGINALS: the renderer only ever sees asset:// thumbnail URLs,
    // so the names it sends are the sidecar's, and this is where they become real
    // paths (missing files drop out — see library-files.ts).
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
  function dragIcon(file: string) {
    const img = nativeImage.createFromPath(file);
    return (img.isEmpty() ? nativeImage.createFromPath(APP_ICON) : img).resize({ width: 64 });
  }

  // Copy one library image to the clipboard (card menu / Ctrl+C — #132). Returns
  // false when nativeImage can't decode the file (svg, some tiff): writing the
  // empty image would silently WIPE the clipboard, so the renderer reports the
  // failure instead.
  ipcMain.handle('copy-image', (_event, file) => {
    const p = exportPath(file);
    if (!p) return false;
    const img = nativeImage.createFromPath(p);
    if (img.isEmpty()) return false;
    clipboard.writeImage(img);
    return true;
  });

  // Copy selected text to the clipboard (selection context menu — #167). The
  // renderer has no built-in Copy row to lean on (the window runs removeMenu(),
  // which takes Chromium's own context menu with it), so the write goes through
  // main exactly like copy-image above rather than through navigator.clipboard —
  // one clipboard route for the app, no secure-context/permission surprises.
  // Empty writes are refused: they would silently WIPE whatever was there.
  ipcMain.handle('copy-text', (_event, text) => {
    if (typeof text !== 'string' || !text) return false;
    clipboard.writeText(text);
    return true;
  });
}

export { register };
