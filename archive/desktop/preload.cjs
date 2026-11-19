'use strict';
const { contextBridge, ipcRenderer } = require('electron');
let backendState = 'ready';
function renderBackendState(value) {
  const previous = backendState;
  backendState = value;
  if (!document.body) return;
  let banner = document.getElementById('desktop-backend-status');
  if (value === 'ready') {
    banner?.remove();
    if (previous !== 'ready') window.dispatchEvent(new Event('InkwellBackendReady'));
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'desktop-backend-status';
    banner.setAttribute('role', 'status');
    banner.setAttribute('popover', 'manual');
    banner.style.cssText =
      'position:fixed;top:auto;bottom:32px;left:12px;right:12px;margin:0;width:auto;border:0;z-index:100000;padding:10px 14px;background:var(--surface,#fff);color:var(--text,#222);box-shadow:0 4px 24px #0003;border-radius:8px;font:13px sans-serif;display:flex;gap:12px;align-items:center';
    banner.append(document.createElement('span'));
    const retry = document.createElement('button');
    retry.textContent = 'Retry connection';
    retry.addEventListener('click', () => {
      ipcRenderer.invoke('inkwell-backend', 'retry').catch(() => {});
    });
    banner.append(retry);
    document.body.append(banner);
  }
  banner.firstChild.textContent =
    value === 'failed'
      ? 'The mail service could not reconnect. Your open work stays here. Retry the connection.'
      : 'Reconnecting to the mail service. Your open work stays here.';
  banner.lastChild.hidden = value !== 'failed';
  // Modal dialogs make outside DOM inert, even for top-layer popovers.
  const host = Array.from(document.querySelectorAll('dialog[open]')).at(-1) || document.body;
  if (banner.parentNode !== host) host.append(banner);
  banner.hidePopover?.();
  banner.showPopover?.();
}
ipcRenderer.on('inkwell-backend-state', (_event, value) => renderBackendState(value));
window.addEventListener('DOMContentLoaded', () => {
  renderBackendState(backendState);
  ipcRenderer
    .invoke('inkwell-backend', 'status')
    .then(renderBackendState)
    .catch(() => {});
});
contextBridge.exposeInMainWorld('inkwellUpdates', {
  status: () => ipcRenderer.invoke('inkwell-updates', 'status'),
  check: (manual = false) =>
    ipcRenderer.invoke('inkwell-updates', manual ? 'check-manual' : 'check'),
  skip: (version) => ipcRenderer.invoke('inkwell-updates', 'skip', version),
  install: (version) => ipcRenderer.invoke('inkwell-updates', 'install', version),
  onProgress: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('inkwell-update-progress', listener);
    return () => ipcRenderer.removeListener('inkwell-update-progress', listener);
  },
});
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
contextBridge.exposeInMainWorld('inkwellAttachmentOpen', {
  safe: (id, token) => ipcRenderer.invoke('inkwell-attachment-open-safe', id, token),
  original: (id, token) => ipcRenderer.invoke('inkwell-attachment-open-original', id, token),
});
contextBridge.exposeInMainWorld('inkwellFiles', {
  prepare: (ids) => ipcRenderer.invoke('inkwell-prepare-email-files', ids),
  drag: (token) => ipcRenderer.invoke('inkwell-drag-email-files', token),
});
