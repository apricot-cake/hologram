'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('postSnap', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  pickSaveFolder: () => ipcRenderer.invoke('pick-save-folder'),
  setExtensionId: (id) => ipcRenderer.invoke('set-extension-id', id),
  listPosts: () => ipcRenderer.invoke('list-posts'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});
