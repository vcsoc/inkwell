'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const diagnostics = require('../desktop/diagnostics.cjs');

test('diagnostics are private, structured, bounded and tolerate filesystem failures', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-diagnostics-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const log = diagnostics(path.join(directory, 'logs'));
  log('backend-exit', { code: null, signal: 'SIGKILL' });
  const file = path.join(directory, 'logs/desktop.log');
  const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(entry.event, 'backend-exit');
  assert.equal(entry.signal, 'SIGKILL');
  assert.ok(!Number.isNaN(Date.parse(entry.at)));
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  fs.writeFileSync(file, 'x'.repeat(1024 * 1024 + 1));
  log('rotated');
  assert.ok(fs.existsSync(file + '.previous'));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).event, 'rotated');
  assert.doesNotThrow(() => diagnostics(path.join(file, 'cannot-create'))('event'));
});
