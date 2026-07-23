// Preload bridge — the TypeScript SOURCE of the committed app/preload.js build
// output. The sandbox preload loader does NOT type-strip, so unlike the .mts
// main-process layer this one file is built (islands/build.mjs → Vite lib CJS,
// electron external). .cts because the runtime module format is CJS (same
// convention as the native-host layer).
//
// The exported HologramPreload type IS the window.hologram contract: the renderer
// program aliases it in islands/types/globals.d.ts (via the electron-shim paths
// mapping — see that file), so the type can never drift from what the bridge
// actually exposes. This file itself is type-checked against the REAL electron
// types by tsconfig.main.json.
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  getConfig: (): Promise<any> => ipcRenderer.invoke('get-config'),
  setExtensionId: (id: string): Promise<any> => ipcRenderer.invoke('set-extension-id', id),
  listPosts: (): Promise<any[]> => ipcRenderer.invoke('list-posts'),
  // Delta refresh: pass true once a full snapshot is held; main returns either a
  // full { full:true, posts:[] } or an incremental { full:false, added, removed }.
  listPostsDelta: (haveBaseline: boolean, changedNames?: string[] | null): Promise<any> => ipcRenderer.invoke('list-posts-delta', haveBaseline, changedNames),
  getTagTypes: (): Promise<any> => ipcRenderer.invoke('get-tag-types'),
  setTagTypes: (types: unknown, labels?: unknown): Promise<any> => ipcRenderer.invoke('set-tag-types', types, labels),
  getUngrouped: (): Promise<any> => ipcRenderer.invoke('get-ungrouped'),
  setUngrouped: (keys: unknown): Promise<any> => ipcRenderer.invoke('set-ungrouped', keys),
  getPosterFolders: (): Promise<any> => ipcRenderer.invoke('get-poster-folders'),
  setPosterFolders: (data: unknown): Promise<any> => ipcRenderer.invoke('set-poster-folders', data),
  getPosterTags: (): Promise<any> => ipcRenderer.invoke('get-poster-tags'),
  setPosterTags: (data: unknown): Promise<any> => ipcRenderer.invoke('set-poster-tags', data),
  getManualGroups: (): Promise<any> => ipcRenderer.invoke('get-manual-groups'),
  setManualGroups: (groups: unknown): Promise<any> => ipcRenderer.invoke('set-manual-groups', groups),
  getFolders: (): Promise<any> => ipcRenderer.invoke('get-folders'),
  setFolders: (data: unknown): Promise<any> => ipcRenderer.invoke('set-folders', data),
  getTabs: (): Promise<any> => ipcRenderer.invoke('get-tabs'),
  setTabs: (data: unknown): Promise<any> => ipcRenderer.invoke('set-tabs', data),
  openExternal: (url: string): Promise<any> => ipcRenderer.invoke('open-external', url),
  openImageWindow: (image: string): Promise<any> => ipcRenderer.invoke('open-image-window', image),
  showInFolder: (file: string): Promise<any> => ipcRenderer.invoke('show-in-folder', file),
  // send, not invoke: the OS drag has to start inside the dragstart the renderer
  // is still holding open — a promise round-trip lands after the gesture is over.
  dragOut: (files: string[]): void => ipcRenderer.send('drag-out', files),
  // false = nativeImage couldn't decode it (svg/tiff) and the clipboard was left alone.
  copyImage: (file: string): Promise<boolean> => ipcRenderer.invoke('copy-image', file),
  getAppInfo: (): Promise<any> => ipcRenderer.invoke('app-info'),
  getPrefs: (): Promise<any> => ipcRenderer.invoke('get-prefs'),
  setPref: (key: string, value: unknown): Promise<any> => ipcRenderer.invoke('set-pref', key, value),
  imageDataUrl: (image: string): Promise<string | null> => ipcRenderer.invoke('image-data-url', image),
  deletePost: (image: string): Promise<any> => ipcRenderer.invoke('delete-post', image),
  updateTags: (image: string, tags: unknown, patch?: unknown): Promise<any> => ipcRenderer.invoke('update-tags', image, tags, patch),
  importPosts: (posts: unknown): Promise<any> => ipcRenderer.invoke('import-posts', posts),
  clearAll: (): Promise<any> => ipcRenderer.invoke('clear-all'),
  exportSave: (filename: string, bytes: Uint8Array | ArrayBuffer): Promise<any> => ipcRenderer.invoke('export-save', filename, bytes),
  exportComplete: (mode?: string): Promise<any> => ipcRenderer.invoke('export-complete', mode),
  importComplete: (bytes: Uint8Array | ArrayBuffer): Promise<any> => ipcRenderer.invoke('import-complete', bytes),
  pickSaveFolder: (): Promise<any> => ipcRenderer.invoke('pick-save-folder'),
  moveSaveFolder: (dest: string): Promise<any> => ipcRenderer.invoke('move-save-folder', dest),
  onSaveFolderProgress: (cb: (p: any) => void): void => {
    ipcRenderer.on('save-folder-progress', (_e, p) => cb(p));
  },
  // Returns an unsubscribe (unlike onSaveFolderProgress) so an export can attach for its
  // duration and detach when done, without piling listeners up across repeated exports.
  onExportProgress: (cb: (p: any) => void): (() => void) => {
    const h = (_e: unknown, p: any) => cb(p);
    ipcRenderer.on('export-progress', h);
    return () => ipcRenderer.removeListener('export-progress', h);
  },
  getBackup: (): Promise<any> => ipcRenderer.invoke('get-backup'),
  setBackup: (patch: unknown): Promise<any> => ipcRenderer.invoke('set-backup', patch),
  pickBackupDir: (): Promise<any> => ipcRenderer.invoke('pick-backup-dir'),
  runBackup: (): Promise<any> => ipcRenderer.invoke('run-backup'),
  importImages: (): Promise<any> => ipcRenderer.invoke('import-images'),
  onBackupStart: (cb: (...args: any[]) => void): void => {
    ipcRenderer.on('backup-start', cb);
  },
  onBackupDone: (cb: (...args: any[]) => void): void => {
    ipcRenderer.on('backup-done', cb);
  },
  listTrash: (): Promise<any[]> => ipcRenderer.invoke('list-trash'),
  restorePost: (image: string): Promise<any> => ipcRenderer.invoke('restore-post', image),
  emptyTrash: (): Promise<any> => ipcRenderer.invoke('empty-trash'),
  deleteFromTrash: (image: string): Promise<any> => ipcRenderer.invoke('delete-from-trash', image),
  // cb receives the changed-sidecar hint (null | [] | [names…]); the raw IPC
  // event is not forwarded.
  onPostsChanged: (cb: (names: string[] | null) => void): void => {
    ipcRenderer.on('posts-changed', (_e, names) => cb(names));
  },
  // Window controls (min/max/close are app-drawn — see the WindowControls island).
  windowControl: (action: 'minimize' | 'toggle-maximize' | 'close'): Promise<boolean | null> => ipcRenderer.invoke('window-control', action),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('window-is-maximized'),
  // cb receives the new maximized state; the raw IPC event is not forwarded.
  onWindowMaximizedChanged: (cb: (maximized: boolean) => void): void => {
    ipcRenderer.on('window-maximized-changed', (_e, maximized) => cb(maximized));
  },
};

// The full contextBridge IPC surface (window.hologram) — typeof the implementation,
// so there is no hand-maintained mirror to drift.
export type HologramPreload = typeof api;

contextBridge.exposeInMainWorld('hologram', api);
