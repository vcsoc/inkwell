'use strict';
const { ipcMain, shell, dialog } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

module.exports = (window, { origin, cookie }) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-attachment-'));
  fs.chmodSync(directory, 0o700);
  const passiveExtensions = new Set([
    'pdf',
    'docx',
    'txt',
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'bmp',
  ]);
  const safeExtensions = new Set([
    'pdf',
    'doc',
    'docx',
    'odt',
    'rtf',
    'txt',
    'md',
    'mdx',
    'csv',
    'tsv',
    'xls',
    'xlsx',
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'bmp',
    'svg',
    'html',
    'htm',
    'xml',
    'json',
    'yaml',
    'yml',
    'log',
    'eml',
  ]);
  const allowed = (event) => {
    try {
      const frame = event.senderFrame;
      const url = new URL(frame.url);
      return (
        !window.isDestroyed() &&
        event.sender === window.webContents &&
        frame === window.webContents.mainFrame &&
        url.origin === origin &&
        url.pathname === '/'
      );
    } catch {
      return false;
    }
  };
  async function fetchAttachment(event, id, token, safe) {
    if (
      !allowed(event) ||
      !Number.isSafeInteger(id) ||
      id < 1 ||
      typeof token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(token)
    )
      throw Error('Untrusted attachment open request');
    const url = `${origin}/api/messages/${id}/attachments/${token}/${safe ? 'safe-open' : 'download'}`;
    const response = await fetch(url, {
      headers: { Cookie: `inkwell_session=${cookie}`, Origin: origin, 'X-Inkwell': '1' },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw Error('Attachment is not available for safe opening; refresh the attachment list');
    const limit = safe ? 25_000_000 : 50_000_000;
    if (Number(response.headers.get('content-length')) > limit)
      throw Error('Attachment is too large to open');
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) {
        await response.body.cancel().catch(() => {});
        throw Error('Attachment is too large to open');
      }
      chunks.push(Buffer.from(chunk));
    }
    const data = Buffer.concat(chunks);
    const disposition = response.headers.get('content-disposition') || '';
    const name = disposition.match(/filename="([a-zA-Z0-9 _.-]{1,240})"/)?.[1] || '';
    if (safe) {
      const extension = path.extname(name).slice(1).toLowerCase();
      if (
        !passiveExtensions.has(extension) ||
        !name.startsWith('inkwell-safe-copy.') ||
        !response.headers.get('content-type')?.startsWith('application/octet-stream') ||
        (extension === 'pdf' && data.subarray(0, 4).toString() !== '%PDF') ||
        (extension === 'docx' && data.subarray(0, 2).toString() !== 'PK')
      )
        throw Error('Safe copy did not return passive content');
    }
    return { data, name };
  }
  async function open(event, id, token, safe) {
    const { data, name } = await fetchAttachment(event, id, token, safe);
    const extension = path.extname(name).slice(1).toLowerCase();
    if (!safeExtensions.has(extension))
      throw Error('Opening this file type with the system app is blocked');
    if (!safe) {
      const choice = await dialog.showMessageBox(window, {
        type: 'warning',
        title: 'Open original attachment?',
        message:
          'Your system app may run scripts, macros or active content in the original attachment.',
        detail:
          'Inkwell cannot disable scripts inside other applications. Open only if you trust the sender and have reviewed the safe preview. The original is never opened automatically.',
        buttons: ['Cancel', 'Open original with scripts enabled'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (choice.response !== 1) return { opened: false };
    }
    const file = path.join(directory, `${randomUUID()}.${extension}`);
    fs.writeFileSync(file, data, { mode: 0o600, flag: 'wx' });
    fs.chmodSync(file, 0o400);
    const failure = await shell.openPath(file);
    if (failure) throw Error('The default application could not open this attachment');
    return { opened: true, safe };
  }
  ipcMain.handle('inkwell-attachment-open-safe', (event, id, token) =>
    open(event, id, token, true),
  );
  ipcMain.handle('inkwell-attachment-open-original', (event, id, token) =>
    open(event, id, token, false),
  );
  return () => {
    ipcMain.removeHandler('inkwell-attachment-open-safe');
    ipcMain.removeHandler('inkwell-attachment-open-original');
    fs.rmSync(directory, { recursive: true, force: true });
  };
};
