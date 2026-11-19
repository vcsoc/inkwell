// Real, non-mocked inference against a source or frozen backend; isolated mail workspace.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
test('local translation runtime produces a real French translation without a model service', { timeout: 200000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-translation-runtime-'));
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const executable = process.env.INKWELL_TEST_SERVER;
  const backend = spawn(executable || 'uv', executable ? ['--port', String(port)] : ['run', '--frozen', 'python', '-m', 'inkwell', '--port', String(port)], {
    detached: true,
    env: { ...process.env, INKWELL_DATA_DIR: directory, INKWELL_DOCUMENTS_DIR: path.join(directory, 'Documents'), INKWELL_ACCESS_KEY: '', INKWELL_HOSTS: '' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let diagnostics = '';
  backend.stderr.on('data', (bytes) => { diagnostics = (diagnostics + bytes.toString()).slice(-4000); });
  t.after(async () => {
    try { process.kill(-backend.pid, 'SIGTERM'); } catch { /* Already stopped. */ }
    if (backend.exitCode === null) await new Promise((resolve) => { backend.once('exit', resolve); setTimeout(resolve, 3000); });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + port;
  let index;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (backend.exitCode !== null) throw Error('Backend exited: ' + diagnostics);
    try { index = await fetch(base, { signal: AbortSignal.timeout(500) }); if (index.ok) break; } catch { /* Starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(index?.ok, diagnostics);
  const cookie = index.headers.get('set-cookie').split(';')[0];
  const headers = { Cookie: cookie, Origin: base, 'X-Inkwell': '1', 'Content-Type': 'application/json' };
  const state = await (await fetch(base + '/api/translation', { headers })).json();
  if (!state.ready) return t.skip('Install the local model/runtime to run real inference. No download is automatic.');
  const start = Date.now();
  const response = await fetch(base + '/api/translation', { method: 'POST', headers, body: JSON.stringify({ text: 'Good morning. Thank you for your email.', language: 'fr' }), signal: AbortSignal.timeout(185000) });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.local, true); assert.equal(result.language, 'fr');
  assert.match(result.translation, /Bonjour/i); assert.match(result.translation, /Merci/i);
  assert.match(result.model, /Qwen3/);
  console.log(`Real local inference: ${result.translation} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
});
