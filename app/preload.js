'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('corpus', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  pickSaveFolder: () => ipcRenderer.invoke('pick-save-folder'),
  setExtensionId: (id) => ipcRenderer.invoke('set-extension-id', id),
  listPosts: () => ipcRenderer.invoke('list-posts'),
  getTagGroups: () => ipcRenderer.invoke('get-tag-groups'),
  getUngrouped: () => ipcRenderer.invoke('get-ungrouped'),
  setUngrouped: (keys) => ipcRenderer.invoke('set-ungrouped', keys),
  getManualGroups: () => ipcRenderer.invoke('get-manual-groups'),
  setManualGroups: (groups) => ipcRenderer.invoke('set-manual-groups', groups),
  getFolders: () => ipcRenderer.invoke('get-folders'),
  setFolders: (data) => ipcRenderer.invoke('set-folders', data),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openImageWindow: (image) => ipcRenderer.invoke('open-image-window', image),
  getPrefs: () => ipcRenderer.invoke('get-prefs'),
  setPref: (key, value) => ipcRenderer.invoke('set-pref', key, value),
  imageDataUrl: (image) => ipcRenderer.invoke('image-data-url', image),
  deletePost: (image) => ipcRenderer.invoke('delete-post', image),
  updateTags: (image, tags) => ipcRenderer.invoke('update-tags', image, tags),
  importPosts: (posts) => ipcRenderer.invoke('import-posts', posts),
  clearAll: () => ipcRenderer.invoke('clear-all'),
  exportSave: (filename, bytes) => ipcRenderer.invoke('export-save', filename, bytes),
  exportComplete: () => ipcRenderer.invoke('export-complete'),
  importComplete: (bytes) => ipcRenderer.invoke('import-complete', bytes),
  getBackup: () => ipcRenderer.invoke('get-backup'),
  setBackup: (patch) => ipcRenderer.invoke('set-backup', patch),
  pickBackupDir: () => ipcRenderer.invoke('pick-backup-dir'),
  runBackup: () => ipcRenderer.invoke('run-backup'),
  importImages: () => ipcRenderer.invoke('import-images'),
  onBackupDone: (cb) => ipcRenderer.on('backup-done', cb),
  onPostsChanged: (cb) => ipcRenderer.on('posts-changed', cb)
});
