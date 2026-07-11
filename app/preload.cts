// Preload bridge — the TypeScript SOURCE of the committed app/preload.js build
// output. The sandbox preload loader does NOT type-strip, so unlike the .mts
// main-process layer this one file is built (islands/build.mjs → Vite lib CJS,
// electron external). .cts because the runtime module format is CJS (same
// convention as the native-host layer).
//
// The exported CorpusPreload type IS the window.corpus contract: the renderer
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
  getTagGroups: (): Promise<any> => ipcRenderer.invoke('get-tag-groups'),
  setTagGroups: (groups: unknown): Promise<any> => ipcRenderer.invoke('set-tag-groups', groups),
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
  getCollections: (): Promise<any> => ipcRenderer.invoke('get-collections'),
  setCollections: (data: unknown): Promise<any> => ipcRenderer.invoke('set-collections', data),
  getTabs: (): Promise<any> => ipcRenderer.invoke('get-tabs'),
  setTabs: (data: unknown): Promise<any> => ipcRenderer.invoke('set-tabs', data),
  openExternal: (url: string): Promise<any> => ipcRenderer.invoke('open-external', url),
  openImageWindow: (image: string): Promise<any> => ipcRenderer.invoke('open-image-window', image),
  showInFolder: (file: string): Promise<any> => ipcRenderer.invoke('show-in-folder', file),
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
  onSaveFolderProgress: (cb: (p: any) => void): void => {
    ipcRenderer.on('save-folder-progress', (_e, p) => cb(p));
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
  setTitleBarOverlay: (opts: unknown): Promise<any> => ipcRenderer.invoke('set-titlebar-overlay', opts),
};

// The full contextBridge IPC surface (window.corpus) — typeof the implementation,
// so there is no hand-maintained mirror to drift.
export type CorpusPreload = typeof api;

contextBridge.exposeInMainWorld('corpus', api);
