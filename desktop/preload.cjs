'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('inkwellOsShortcut', {
  status: () => ipcRenderer.invoke('inkwell-os-shortcut', 'status'),
  enable: () => ipcRenderer.invoke('inkwell-os-shortcut', 'enable'),
  disable: () => ipcRenderer.invoke('inkwell-os-shortcut', 'disable'),
});
contextBridge.exposeInMainWorld('inkwellCalendarFiles', {
  next: () => ipcRenderer.invoke('inkwell-calendar-next'),
});
ipcRenderer.on('inkwell-calendar-files-ready', () =>
  window.dispatchEvent(new Event('InkwellCalendarFilesReady')),
);
contextBridge.exposeInMainWorld('inkwellShortcuts', {
  configure: (values) => ipcRenderer.send('inkwell-configure-shortcuts', values),
  capture: (value) => ipcRenderer.send('inkwell-shortcut-capture', value),
});
contextBridge.exposeInMainWorld('inkwellFiles', {
  prepare: (ids) => ipcRenderer.invoke('inkwell-prepare-email-files', ids),
  drag: (token) => ipcRenderer.invoke('inkwell-drag-email-files', token),
});
