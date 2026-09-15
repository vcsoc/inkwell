'use strict';
const { ipcMain, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
module.exports = (window, { origin, cookie, directory, iconPath }) => {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const jobs = new Map();
  let busy = false;
  const allowed = (e) => {
    try {
      return (
        !window.isDestroyed() &&
        e.sender === window.webContents &&
        e.senderFrame === window.webContents.mainFrame &&
        new URL(e.senderFrame.url).origin === origin &&
        new URL(e.senderFrame.url).pathname === '/'
      );
    } catch {
      return false;
    }
  };
  ipcMain.handle('inkwell-prepare-email-files', async (e, ids) => {
    if (!allowed(e)) throw Error('Untrusted export request');
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 50 ||
      ids.some((id) => !Number.isSafeInteger(id) || id < 1)
    )
      throw Error('Select 1–50 messages to export');
    if (busy) throw Error('An email export is preparing; try dragging again');
    busy = true;
    const token = randomUUID(),
      folder = path.join(directory, token),
      files = [];
    try {
      fs.mkdirSync(folder, { mode: 0o700 });
      let size = 0;
      for (const id of new Set(ids)) {
        const response = await fetch(origin + '/api/messages/' + id + '/eml', {
          headers: { Cookie: 'inkwell_session=' + cookie, Origin: origin },
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw Error('Could not export a selected message');
        if (Number(response.headers.get('content-length')) > 8 * 1024 * 1024)
          throw Error('Email export is too large');
        const data = Buffer.from(await response.arrayBuffer());
        size += data.length;
        if (size > 64 * 1024 * 1024) throw Error('Select fewer messages for this export');
        const name =
          response.headers
            .get('content-disposition')
            ?.match(/filename="([a-zA-Z0-9 _.-]+\.eml)"/)?.[1] || 'message-' + id + '.eml';
        const file = path.join(folder, path.basename(name));
        fs.writeFileSync(file, data, { mode: 0o600, flag: 'wx' });
        files.push(file);
      }
      jobs.set(token, files);
      return token;
    } catch (error) {
      fs.rmSync(folder, { recursive: true, force: true });
      throw error;
    } finally {
      busy = false;
    }
  });
  ipcMain.handle('inkwell-drag-email-files', (e, token) => {
    if (!allowed(e)) throw Error('Untrusted export request');
    if (typeof token !== 'string' || !jobs.has(token)) throw Error('Export expired; drag again');
    const files = jobs.get(token);
    if (!files.every((file) => fs.existsSync(file))) throw Error('Export expired; drag again');
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 });
    e.sender.startDrag({ files, icon });
  });
  return () => {
    ipcMain.removeHandler('inkwell-prepare-email-files');
    ipcMain.removeHandler('inkwell-drag-email-files');
    fs.rmSync(directory, { recursive: true, force: true });
  };
};
