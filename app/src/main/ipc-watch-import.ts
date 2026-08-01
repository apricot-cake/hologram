'use strict';

import { dialog, ipcMain } from 'electron';
import path from 'node:path';

import { isInside, type WatchImportFolder } from './lib-watch-import.ts';
import type { BrowserWindow } from 'electron';
import type { IpcContext } from './ipc-context.ts';
import type { WatchImportConfig } from './ipc-payloads.ts';

function register(ctx: IpcContext) {
  const { getWatchImportConfig, setWatchImportFolders, getSaveFolder, getWin } = ctx;
  ipcMain.handle('get-watch-import', (): WatchImportConfig => getWatchImportConfig());
  ipcMain.handle('pick-watch-import-folder', async () => {
    const result = await dialog.showOpenDialog(getWin() as BrowserWindow, { properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const folder = path.resolve(result.filePaths[0]);
    if (isInside(folder, getSaveFolder()) || isInside(getSaveFolder(), folder)) return { ok: false, error: 'save-folder-overlap' };
    return { ok: true, path: folder };
  });
  ipcMain.handle('set-watch-import', async (_e, folders: WatchImportFolder[], markExisting?: string[]): Promise<WatchImportConfig> => setWatchImportFolders(folders, markExisting));
}

export { register };
