'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createUpdater, newer, trustedAsset, installed } = require('../desktop/updates.cjs');

const repo = 'https://github.com/vcsoc/inkwell/releases/download/v0.1.6/';
test('version ordering, trusted assets and managed-install requirement', async () => {
  assert.equal(newer('0.1.6', '0.1.5'), true);
  assert.equal(newer('0.1.5', '0.1.6'), false);
  assert.equal(newer('0.2.0', '0.1.99'), true);
  assert.equal(newer('0.1.6-rc.1', '0.1.5'), false);
  assert.throws(() => trustedAsset({ name: 'bad', size: 4, browser_download_url: 'https://evil.test/' }, 'bad', '0.1.6'));
  assert.equal(installed('/tmp', '/tmp/inkwell', true), false);
});

async function fixture(t, corrupt = false, canRestart = true) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'inkwell-updates-test-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const root = path.join(home, '.local/opt/inkwell');
  const executable = path.join(root, 'releases', 'old', 'inkwell');
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.writeFile(path.join(root, '.inkwell-managed'), 'Inkwell user installation v1\n');
  await fs.writeFile(executable, 'binary');
  const name = 'inkwell-0.1.6-linux-x64.run';
  const payload = Buffer.from('test installer data');
  const sum = createHash('sha256').update(payload).digest('hex');
  const assets = [name, 'SHA256SUMS'].map((asset) => ({ name: asset, size: asset === name ? payload.length : 120, browser_download_url: repo + asset }));
  let executions = 0, restarts = 0;
  const progress = [];
  const updater = createUpdater({
    version: '0.1.5', home, executable, packaged: true,
    userData: path.join(home, 'data'), emit: (value) => progress.push(value),
    beforeRestart: async () => canRestart, restart: () => restarts++,
    request: async (url) => {
      if (url.endsWith('/latest')) return new Response(JSON.stringify({ tag_name: 'v0.1.6', draft: false, prerelease: false, assets }));
      if (url.endsWith('SHA256SUMS')) return new Response(`${corrupt ? '0'.repeat(64) : sum}  ${name}\n`);
      if (url.endsWith(name)) return new Response(payload, { headers: { 'Content-Length': String(payload.length) } });
      throw Error('Unexpected URL ' + url);
    },
    runInstaller: async (file, onProgress) => {
      assert.deepEqual(await fs.readFile(file), payload);
      onProgress(60, 'Application extracted');
      executions++;
    },
  });
  return { updater, progress, executions: () => executions, restarts: () => restarts, home };
}

test('checks releases, respects a skipped version across starts, verifies and restarts', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.updater.check(), { status: 'available', version: '0.1.6', size: 19 });
  assert.deepEqual(await f.updater.skip('0.1.6'), { status: 'skipped', version: '0.1.6' });
  assert.equal((await f.updater.check()).status, 'skipped');
  assert.equal((await f.updater.check(true)).status, 'available');
  assert.equal((await f.updater.install('0.1.6')).status, 'restarting');
  assert.equal(f.executions(), 1);
  assert.equal(f.restarts(), 1);
  assert(f.progress.some((p) => p.phase === 'download' && p.percent === 100));
  assert(f.progress.some((p) => p.phase === 'install' && p.percent === 60));
});

test('a failed draft flush keeps the installed update but never closes the app', async (t) => {
  const f = await fixture(t, false, false);
  await f.updater.check();
  assert.equal((await f.updater.install('0.1.6')).status, 'restart-needed');
  assert.equal(f.executions(), 1);
  assert.equal(f.restarts(), 0);
});

test('rejects a mismatched checksum without executing the installer', async (t) => {
  const f = await fixture(t, true);
  await f.updater.check();
  await assert.rejects(f.updater.install('0.1.6'), /checksum/);
  assert.equal(f.executions(), 0);
  assert.equal(f.restarts(), 0);
});
