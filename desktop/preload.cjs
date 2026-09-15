'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('inkwellShortcuts', {
  configure: (values) => ipcRenderer.send('inkwell-configure-shortcuts', values),
  capture: (value) => ipcRenderer.send('inkwell-shortcut-capture', value),
});
contextBridge.exposeInMainWorld('inkwellFiles', {
  prepare: (ids) => ipcRenderer.invoke('inkwell-prepare-email-files', ids),
  drag: (token) => ipcRenderer.invoke('inkwell-drag-email-files', token),
});
