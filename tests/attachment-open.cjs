'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');

test('attachment bridge only opens passive copies automatically and requires a native warning for originals', async () => {
  const handlers = new Map();
  const opened = [];
  let decision = 0;
  const electron = {
    ipcMain: { handle: (name, callback) => handlers.set(name, callback), removeHandler: (name) => handlers.delete(name) },
    shell: { openPath: async (file) => { opened.push({ name: file, content: fs.readFileSync(file).toString() }); return ''; } },
    dialog: { showMessageBox: async (_window, options) => {
      assert.equal(options.defaultId, 0);
      assert.match(options.detail, /cannot disable scripts/);
      return { response: decision };
    } },
  };
  const load = Module._load;
  Module._load = (name, ...args) => name === 'electron' ? electron : load(name, ...args);
  let bridge;
  try { bridge = require('../desktop/attachment-open.cjs'); }
  finally { Module._load = load; }
  const frame = { url: 'http://127.0.0.1:8877/' };
  const window = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  const valid = { sender: window.webContents, senderFrame: frame };
  const token = 'a'.repeat(64);
  const fetchOriginal = global.fetch;
  global.fetch = async (url, options) => {
    assert.match(options.headers.Cookie, /^inkwell_session=/);
    if (url.endsWith('/safe-open')) return new Response('%PDF-passive', { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="inkwell-safe-copy.pdf"' } });
    return new Response('%PDF-original', { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="receipt.pdf"' } });
  };
  const cleanup = bridge(window, { origin: 'http://127.0.0.1:8877', cookie: 'session' });
  try {
    await assert.rejects(handlers.get('inkwell-attachment-open-safe')({ sender: {}, senderFrame: frame }, 1, token), /Untrusted/);
    await assert.rejects(handlers.get('inkwell-attachment-open-safe')(valid, 1, '../../test'), /Untrusted/);
    await handlers.get('inkwell-attachment-open-safe')(valid, 1, token);
    assert.equal(opened.length, 1);
    assert.equal(opened[0].content, '%PDF-passive');
    assert.match(opened[0].name, /\.pdf$/);
    assert.equal((await handlers.get('inkwell-attachment-open-original')(valid, 1, token)).opened, false);
    assert.equal(opened.length, 1);
    decision = 1;
    await handlers.get('inkwell-attachment-open-original')(valid, 1, token);
    assert.equal(opened[1].content, '%PDF-original');
  } finally {
    cleanup();
    global.fetch = fetchOriginal;
  }
  assert.equal(fs.existsSync(opened[0].name), false);
  assert.equal(handlers.size, 0);
});
