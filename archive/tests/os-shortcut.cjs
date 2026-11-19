const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const create = require('../desktop/os-shortcut.cjs');
async function fixture(t, options = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'inkwell-shortcut-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const file = path.join(home, '.config/hypr/bindings.lua');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.mkdir(path.join(home, 'omarchy/default/hypr'), { recursive: true });
  await fs.mkdir(path.join(home, '.local/bin'), { recursive: true });
  await fs.writeFile(path.join(home, '.local/bin/inkwell'), '#!/bin/sh\n', { mode: 0o700 });
  const original = '-- Keep my settings\no.bind("SUPER + B", "Browser", "browser")\n';
  await fs.writeFile(file, original);
  let reloads = 0;
  const run = async (cmd, args) => {
    assert.equal(cmd, 'hyprctl');
    const text = await fs.readFile(file, 'utf8');
    if (args[0] === 'binds')
      return {
        stdout: JSON.stringify(
          options.conflict
            ? [{ modmask: 64, key: 'I', description: 'Another app' }]
            : text.includes(create.BLOCK)
              ? [{ modmask: 64, key: 'I', description: 'Inkwell (Super+I)' }]
              : [],
        ),
      };
    if (args[0] === 'reload') {
      reloads++;
      if (options.concurrent) await fs.appendFile(file, '-- Concurrent user edit\n');
      return { stdout: 'ok' };
    }
    return {
      stdout: options.fail && reloads && text.includes(create.BLOCK) ? 'Invalid config' : '',
    };
  };
  return {
    home,
    file,
    original,
    service: create({ home, run, omarchy: path.join(home, 'omarchy'), session: 'test' }),
  };
}
test(
  'opt-in binding backs up, validates, is idempotent and removes only its own block',
  { timeout: 2000 },
  async (t) => {
    const { file, original, service } = await fixture(t);
    assert.deepEqual(await service.status(), {
      available: true,
      enabled: false,
      active: false,
      conflict: null,
    });
    const result = await service.change(true);
    assert.ok(result.enabled && result.active);
    assert.equal(await fs.readFile(result.backup, 'utf8'), original);
    assert.equal(await fs.readFile(file, 'utf8'), original + create.BLOCK);
    await service.change(true);
    assert.equal(await fs.readFile(file, 'utf8'), original + create.BLOCK);
    await fs.appendFile(file, '-- Later personal setting\n');
    await service.change(false);
    assert.equal(await fs.readFile(file, 'utf8'), original + '-- Later personal setting\n');
  },
);
test(
  'symlinked bindings are never replaced or followed for edits',
  { timeout: 2000 },
  async (t) => {
    const { file, original, service } = await fixture(t);
    const target = file + '.original';
    await fs.rename(file, target);
    await fs.symlink(target, file);
    await assert.rejects(service.change(true), /regular user/);
    assert.equal(await fs.readFile(target, 'utf8'), original);
    assert.ok((await fs.lstat(file)).isSymbolicLink());
  },
);
test('conflicting bindings are not overwritten', { timeout: 2000 }, async (t) => {
  const { file, original, service } = await fixture(t, { conflict: true });
  assert.equal((await service.status()).conflict, 'Another app');
  await assert.rejects(service.change(true), /already assigned/);
  assert.equal(await fs.readFile(file, 'utf8'), original);
});
test('failed reload validation restores previous bindings', { timeout: 2000 }, async (t) => {
  const { file, original, service } = await fixture(t, { fail: true });
  await assert.rejects(service.change(true), /Previous bindings restored/);
  assert.equal(await fs.readFile(file, 'utf8'), original);
});
test(
  'edited managed blocks and concurrent external changes are preserved',
  { timeout: 2000 },
  async (t) => {
    const { file, service } = await fixture(t, { fail: true, concurrent: true });
    await assert.rejects(service.change(true), /no rollback was forced/);
    assert.ok((await fs.readFile(file, 'utf8')).includes('Concurrent user edit'));
    await fs.writeFile(file, create.BLOCK.replace('SUPER + I', 'SUPER + O'));
    assert.equal((await service.status()).available, false);
    await assert.rejects(service.change(false), /edited/);
  },
);
