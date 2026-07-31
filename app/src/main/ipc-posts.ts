'use strict';

// Posts IPC handlers, extracted from main.js (mechanical move — logic unchanged).
// list-posts / list-posts-delta are thin wrappers over the core index functions
// (which stay in main.js with the delta bookkeeping); image-data-url reads one file
// from the save folder as a data: URL. Core helpers arrive via ctx.
//
// The ugoira pair (#506) sits here for the reason image-data-url does: each is a
// read of ONE file out of the save folder, through the same containment check.
// What they are not is a second copy of the archive machinery — the zip stays on
// disk and only the requested frame crosses this boundary (ADR 0015).
import { ipcMain } from 'electron';
import fs from 'node:fs';
import { readUgoiraFrame, ugoiraFramesPresent } from './lib-archive.ts';
import type { IpcContext } from './ipc-context.ts';

function register(ctx: IpcContext) {
  const { listPosts, listPostsDelta, resolveInFolder, mimeForFile } = ctx;

  ipcMain.handle('list-posts', () => listPosts());
  ipcMain.handle('list-posts-delta', (_e, haveBaseline) => listPostsDelta(!!haveBaseline));

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

  // Only a .zip inside the save folder reaches a ZIP reader through this door:
  // ugoira is the one media kind the library stores as an archive.
  const ugoiraPath = (file: unknown) => (typeof file === 'string' && /\.zip$/i.test(file) ? resolveInFolder(file) : null);

  // Asked once before playback starts — see ugoiraFramesPresent for why the
  // answer is all-or-nothing.
  ipcMain.handle('ugoira-frames-present', async (_e, file, names) => {
    const p = ugoiraPath(file);
    if (!p) return false;
    try {
      return await ugoiraFramesPresent(p, Array.isArray(names) ? names.filter((n) => typeof n === 'string') : []);
    } catch {
      return false;
    }
  });

  // One frame's bytes, or null. The renderer wraps them in a Blob it can decode;
  // nothing is base64'd on the way (that inflation is what made the old
  // whole-archive data: URL expensive).
  ipcMain.handle('ugoira-frame', async (_e, file, name) => {
    const p = ugoiraPath(file);
    if (!p) return null;
    try {
      return await readUgoiraFrame(p, typeof name === 'string' ? name : '');
    } catch {
      return null;
    }
  });
}

export { register };
