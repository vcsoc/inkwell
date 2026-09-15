'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('inkwellFiles', {
  prepare: (ids) => ipcRenderer.invoke('inkwell-prepare-email-files', ids),
  drag: (token) => ipcRenderer.invoke('inkwell-drag-email-files', token),
});
