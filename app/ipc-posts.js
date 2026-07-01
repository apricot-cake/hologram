'use strict';

// Posts IPC handlers, extracted from main.js (mechanical move — logic unchanged).
// list-posts / list-posts-delta are thin wrappers over the core index functions
// (which stay in main.js with the delta bookkeeping); image-data-url reads one file
// from the save folder as a data: URL. Core helpers arrive via ctx.
const { ipcMain } = require('electron');
const fs = require('fs');

function register(ctx) {
  const { listPosts, listPostsDelta, resolveInFolder, mimeForFile } = ctx;

  ipcMain.handle('list-posts', () => listPosts());
  ipcMain.handle('list-posts-delta', (_e, haveBaseline, changedNames) => listPostsDelta(!!haveBaseline, changedNames));

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
}

module.exports = { register };
