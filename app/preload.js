'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('corpus', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  pickSaveFolder: () => ipcRenderer.invoke('pick-save-folder'),
  setExtensionId: (id) => ipcRenderer.invoke('set-extension-id', id),
  listPosts: () => ipcRenderer.invoke('list-posts'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getPrefs: () => ipcRenderer.invoke('get-prefs'),
  setPref: (key, value) => ipcRenderer.invoke('set-pref', key, value),
  imageDataUrl: (image) => ipcRenderer.invoke('image-data-url', image),
  deletePost: (image) => ipcRenderer.invoke('delete-post', image),
  updateTags: (image, tags) => ipcRenderer.invoke('update-tags', image, tags),
  importPosts: (posts) => ipcRenderer.invoke('import-posts', posts),
  clearAll: () => ipcRenderer.invoke('clear-all'),
  exportSave: (filename, bytes) => ipcRenderer.invoke('export-save', filename, bytes),
  onPostsChanged: (cb) => ipcRenderer.on('posts-changed', cb)
});
