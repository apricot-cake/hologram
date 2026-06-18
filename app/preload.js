'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('corpus', {
  getConfig: () => ipcRenderer.invoke('get-config'),
setExtensionId: (id) => ipcRenderer.invoke('set-extension-id', id),
  listPosts: () => ipcRenderer.invoke('list-posts'),
  // Delta refresh: pass true once a full snapshot is held; main returns either a
  // full { full:true, posts:[] } or an incremental { full:false, added, removed }.
  listPostsDelta: (haveBaseline, changedNames) => ipcRenderer.invoke('list-posts-delta', haveBaseline, changedNames),
  getTagGroups: () => ipcRenderer.invoke('get-tag-groups'),
  setTagGroups: (groups) => ipcRenderer.invoke('set-tag-groups', groups),
  getUngrouped: () => ipcRenderer.invoke('get-ungrouped'),
  setUngrouped: (keys) => ipcRenderer.invoke('set-ungrouped', keys),
  getPosterFavorites: () => ipcRenderer.invoke('get-poster-favorites'),
  setPosterFavorites: (keys) => ipcRenderer.invoke('set-poster-favorites', keys),
  getPosterFolders: () => ipcRenderer.invoke('get-poster-folders'),
  setPosterFolders: (data) => ipcRenderer.invoke('set-poster-folders', data),
  getManualGroups: () => ipcRenderer.invoke('get-manual-groups'),
  setManualGroups: (groups) => ipcRenderer.invoke('set-manual-groups', groups),
  getFolders: () => ipcRenderer.invoke('get-folders'),
  setFolders: (data) => ipcRenderer.invoke('set-folders', data),
  getTabs: () => ipcRenderer.invoke('get-tabs'),
  setTabs: (data) => ipcRenderer.invoke('set-tabs', data),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openImageWindow: (image) => ipcRenderer.invoke('open-image-window', image),
  getPrefs: () => ipcRenderer.invoke('get-prefs'),
  setPref: (key, value) => ipcRenderer.invoke('set-pref', key, value),
  imageDataUrl: (image) => ipcRenderer.invoke('image-data-url', image),
  deletePost: (image) => ipcRenderer.invoke('delete-post', image),
  updateTags: (image, tags, patch) => ipcRenderer.invoke('update-tags', image, tags, patch),
  importPosts: (posts) => ipcRenderer.invoke('import-posts', posts),
  clearAll: () => ipcRenderer.invoke('clear-all'),
  exportSave: (filename, bytes) => ipcRenderer.invoke('export-save', filename, bytes),
  exportComplete: (mode) => ipcRenderer.invoke('export-complete', mode),
  importComplete: (bytes) => ipcRenderer.invoke('import-complete', bytes),
  getBackup: () => ipcRenderer.invoke('get-backup'),
  setBackup: (patch) => ipcRenderer.invoke('set-backup', patch),
  pickBackupDir: () => ipcRenderer.invoke('pick-backup-dir'),
  runBackup: () => ipcRenderer.invoke('run-backup'),
  importImages: () => ipcRenderer.invoke('import-images'),
  onBackupDone: (cb) => ipcRenderer.on('backup-done', cb),
  // cb receives the changed-sidecar hint (null | [] | [names…]); the raw IPC
  // event is not forwarded.
  listTrash: () => ipcRenderer.invoke('list-trash'),
  restorePost: (image) => ipcRenderer.invoke('restore-post', image),
  emptyTrash: () => ipcRenderer.invoke('empty-trash'),
  deleteFromTrash: (image) => ipcRenderer.invoke('delete-from-trash', image),
  onPostsChanged: (cb) => ipcRenderer.on('posts-changed', (_e, names) => cb(names)),
  setTitleBarOverlay: (opts) => ipcRenderer.invoke('set-titlebar-overlay', opts)
});
