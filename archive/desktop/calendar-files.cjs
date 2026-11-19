'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const LIMIT = 2000000;
module.exports = () => {
  const queue = [];
  let notify = () => {};
  const enqueue = (files, cwd = process.cwd()) => {
    if (!files.length) return;
    if (files.length > 10 || queue.length + files.length > 10) {
      if (queue.length < 11) queue.push({ error: 'Open at most 10 calendar files at a time.' });
    } else
      for (const value of files) {
        try {
          let file = value;
          if (file.startsWith('file:')) file = fileURLToPath(file);
          if (
            typeof file !== 'string' ||
            !/\.ics$/i.test(file) ||
            file.includes('\0') ||
            /^[a-z][a-z0-9+.-]*:/i.test(file)
          )
            throw Error('Choose a local .ics file.');
          queue.push({ path: path.resolve(cwd, file) });
        } catch {
          queue.push({ error: 'Only local .ics calendar files can be opened with Inkwell.' });
        }
      }
    notify();
  };
  const argumentsFrom = (argv, cwd) => {
    const index = argv.indexOf('--open-calendar');
    if (index >= 0) enqueue(argv.slice(index + 1), cwd);
  };
  const next = async () => {
    const item = queue.shift();
    if (!item || item.error) return item || null;
    let handle;
    try {
      handle = await fs.promises.open(item.path, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > LIMIT)
        throw Error('Choose a regular .ics file under 2 MB.');
      const buffer = Buffer.alloc(LIMIT + 1);
      let count = 0;
      while (count < buffer.length) {
        const { bytesRead } = await handle.read(buffer, count, buffer.length - count, null);
        if (!bytesRead) break;
        count += bytesRead;
      }
      if (count > LIMIT) throw Error('Calendar file exceeds 2 MB.');
      const content = buffer.subarray(0, count).toString('utf8');
      if (!content.trimStart().toUpperCase().startsWith('BEGIN:VCALENDAR'))
        throw Error('This is not a UTF-8 ICS calendar file.');
      return { filename: path.basename(item.path), content };
    } catch (error) {
      return { error: error.code ? 'Could not read the selected calendar file.' : error.message };
    } finally {
      await handle?.close();
    }
  };
  const attach = (window, origin, ipcMain) => {
    notify = () => {
      if (
        !window.isDestroyed() &&
        window.webContents.getURL().startsWith(origin + '/') &&
        !window.webContents.isLoadingMainFrame()
      ) {
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        window.webContents.send('inkwell-calendar-files-ready');
      }
    };
    const handler = (event) => {
      const url = new URL(event.senderFrame?.url || 'about:blank');
      if (
        window.isDestroyed() ||
        event.sender !== window.webContents ||
        event.senderFrame?.frameTreeNodeId !== window.webContents.mainFrame.frameTreeNodeId ||
        url.origin !== origin ||
        url.pathname !== '/'
      )
        throw Error('Untrusted calendar file request');
      return next();
    };
    ipcMain.handle('inkwell-calendar-next', handler);
    window.webContents.on('did-finish-load', () => {
      if (queue.length) notify();
    });
    window.once('closed', () => {
      notify = () => {};
      ipcMain.removeHandler('inkwell-calendar-next');
    });
  };
  return { enqueue, argumentsFrom, next, attach };
};
