'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const supervisor = require('../desktop/backend-supervisor.cjs');

async function until(predicate) {
  const end = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > end) throw Error('Condition did not become true');
    await delay(2);
  }
}
function harness(t, overrides = {}) {
  const children = [], states = [], logs = [], spawns = [];
  let authentications = 0;
  const service = supervisor({
    command: 'backend', args: ['--port', '12345'], options: { env: { INKWELL_ACCESS_KEY: 'private' } },
    probe: async () => true,
    authenticate: async () => { authentications++; },
    onState: (state) => states.push(state), log: (event, details) => logs.push({ event, ...details }),
    pollMs: 1, retryMs: 1, startupMs: 30,
    spawnProcess: (...args) => {
      spawns.push(args);
      const child = new EventEmitter();
      Object.assign(child, { pid: children.length + 100, exitCode: null, signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter() });
      child.exit = (code = null, signal = 'SIGKILL') => {
        child.exitCode = code; child.signalCode = signal; child.emit('exit', code, signal);
      };
      child.kill = (signal) => { child.exit(null, signal); return true; };
      children.push(child);
      return child;
    },
    ...overrides,
  });
  t.after(() => service.stop());
  return { service, children, states, logs, spawns, authentications: () => authentications };
}

test('unexpected backend exit reconnects and authenticates without changing port or key', async (t) => {
  const h = harness(t);
  await h.service.start();
  h.children[0].exit();
  await until(() => h.states.filter((s) => s === 'ready').length === 2);
  assert.equal(h.authentications(), 2);
  assert.deepEqual(h.spawns[0], h.spawns[1]);
  assert.deepEqual(h.states, ['ready', 'reconnecting', 'ready']);
});

test('a clean but unexpected exit also reconnects', async (t) => {
  const h = harness(t);
  await h.service.start();
  h.children[0].exit(0, null);
  await until(() => h.children.length === 2);
  await until(() => h.authentications() === 2);
});

test('failed authentication terminates that process before another attempt', async (t) => {
  let calls = 0;
  const h = harness(t, { authenticate: async () => { if (++calls === 2) throw Error('private detail'); } });
  await h.service.start();
  h.children[0].exit();
  await until(() => h.states.filter((s) => s === 'ready').length === 2);
  assert.equal(h.children.length, 3);
  assert.equal(h.children[1].signalCode, 'SIGTERM');
  assert.ok(!JSON.stringify(h.logs).includes('private detail'));
});

test('crash loops are bounded and explicit Retry starts a fresh recovery budget', async (t) => {
  let fail = false;
  const h = harness(t, { maxAttempts: 2, authenticate: async () => { if (fail) throw Error('bad'); } });
  await h.service.start();
  fail = true;
  h.children[0].exit();
  await until(() => h.states.at(-1) === 'failed');
  assert.equal(h.children.length, 3);
  await delay(15);
  assert.equal(h.children.length, 3);
  fail = false;
  await h.service.retry();
  assert.equal(h.states.at(-1), 'ready');
  assert.equal(h.children.length, 4);
});

test('repeated immediate deaths cannot bypass the crash-loop budget', async (t) => {
  const h = harness(t, { maxAttempts: 2 });
  await h.service.start();
  h.children[0].exit();
  await until(() => h.states.filter((s) => s === 'ready').length === 2);
  h.children[1].exit();
  await until(() => h.states.filter((s) => s === 'ready').length === 3);
  h.children[2].exit();
  await until(() => h.states.at(-1) === 'failed');
  assert.equal(h.children.length, 3);
});

test('quit cancels a queued reconnect and never restarts the service', async (t) => {
  const h = harness(t, { retryMs: 20 });
  await h.service.start();
  h.children[0].exit();
  await h.service.stop();
  await delay(35);
  assert.equal(h.children.length, 1);
  await h.service.retry();
  assert.equal(h.children.length, 1);
});

test('startup timeout terminates the backend instead of leaving an orphan', async (t) => {
  const h = harness(t, { probe: async () => false, startupMs: 8 });
  await assert.rejects(h.service.start(), /timed out/);
  assert.equal(h.children[0].signalCode, 'SIGTERM');
});

test('spawn errors are reported and do not cause unhandled error events', async (t) => {
  const h = harness(t, { spawnProcess: () => {
    const child = new EventEmitter();
    Object.assign(child, { pid: undefined, exitCode: null, signalCode: null });
    queueMicrotask(() => child.emit('error', Object.assign(Error('missing'), { code: 'ENOENT' })));
    return child;
  } });
  await assert.rejects(h.service.start(), /ENOENT/);
});

test('backend diagnostics retain exception types but exclude request URLs and private values', async (t) => {
  const h = harness(t);
  await h.service.start();
  h.children[0].stderr.emit('data', Buffer.from('GET /api/search?q=private-mail 200\nValueErr'));
  h.children[0].stderr.emit('data', Buffer.from('or: secret-token\nRuntimeError: secret-message\n'));
  assert.deepEqual(h.logs.filter((entry) => entry.event === 'backend-exception'), [
    { event: 'backend-exception', type: 'ValueError' },
    { event: 'backend-exception', type: 'RuntimeError' },
  ]);
  assert.ok(!JSON.stringify(h.logs).includes('secret'));
  assert.ok(!JSON.stringify(h.logs).includes('private-mail'));
});
