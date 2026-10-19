'use strict';
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');

test('backend failures preserve the window and draft; renderer failures reload safely', { timeout: 60000 }, async (t) => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-recovery-'));
  const profile = path.join(data, 'profile');
  const log = path.join(profile, 'logs/desktop.log');
  let app;
  const pageErrors = [];
  t.signal.addEventListener('abort', () => app?.close().catch(() => {}), { once: true });
  try {
    // Execute Python directly in development so killing the child cannot orphan uv's grandchild.
    const shim = path.join(data, 'uv-shim');
    fs.writeFileSync(shim, '#!/bin/sh\nshift 3\nexec ' + JSON.stringify(path.resolve('.venv/bin/python')) + ' "$@"\n', { mode: 0o700 });
    app = await electron.launch({
      executablePath: process.env.INKWELL_TEST_EXECUTABLE || undefined,
      args: [...(process.env.INKWELL_TEST_EXECUTABLE ? [] : ['.']), `--user-data-dir=${profile}`],
      env: { ...process.env, INKWELL_UV: shim, INKWELL_DATA_DIR: data, INKWELL_DOCUMENTS_DIR: path.join(data, 'Documents'), XDG_DATA_HOME: path.join(data, 'xdg') },
      timeout: 10000,
    });
    const window = await app.firstWindow({ timeout: 10000 });
    window.on('pageerror', (error) => pageErrors.push(error.message));
    window.setDefaultTimeout(10000);
    await expect(window.locator('#page-title')).toHaveText('your inbox.');
    const origin = new URL(window.url()).origin;
    await window.locator('#heading-compose').click();
    await window.locator('[name=subject]').fill('Recovery test draft');
    await window.locator('[name=body]').fill('Text kept across service failures');
    await expect(window.locator('#draft-status')).toHaveText('Draft saved automatically.');
    await window.evaluate(() => { window.recoverySentinel = 'same document'; });
    for (let index = 0; index < 6; index++) {
      const previousCookie = await app.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        return (await window.webContents.session.cookies.get({ name: 'inkwell_session' }))[0].value;
      });
      const pid = await app.evaluate(() => {
        const child = process._getActiveHandles().find((handle) => handle.spawnargs?.includes('--port'));
        if (!child) throw Error('Test backend process not found');
        const pid = child.pid;
        child.kill('SIGKILL');
        return pid;
      });
      expect(pid).toBeGreaterThan(0);
      await window.locator('[name=body]').fill(`Latest work during recovery ${index}`);
      if (index === 5) {
        await expect(window.locator('#desktop-backend-status')).toContainText('could not reconnect');
        await window.getByRole('button', { name: 'Retry connection', exact: true }).click();
      }
      await expect.poll(async () => app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].webContents.session.cookies.get({ name: 'inkwell_session' }))[0]?.value), { timeout: 15000 }).not.toBe(previousCookie);
      await expect.poll(() => window.evaluate(async () => (await fetch('/api/preferences')).status)).toBe(200);
      expect(new URL(window.url()).origin).toBe(origin);
      expect(await window.evaluate(() => window.recoverySentinel)).toBe('same document');
      await expect(window.locator('[name=body]')).toHaveValue(`Latest work during recovery ${index}`);
      await expect(window.locator('#desktop-backend-status')).toHaveCount(0);
      await expect(window.locator('#draft-status')).toHaveText('Draft saved automatically.');
      const db = new DatabaseSync(path.join(data, 'inkwell.db'), { readOnly: true });
      try {
        const draft = db.prepare("SELECT id,body FROM messages WHERE folder='drafts' AND subject='Recovery test draft'").get();
        expect(draft.body).toBe(`Latest work during recovery ${index}`);
        if (index === 5) expect(await window.evaluate((id) => window.inkwellFiles.prepare([id]), draft.id)).toMatch(/^[0-9a-f-]{36}$/);
      } finally { db.close(); }
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
    await expect.poll(() => fs.readFileSync(log, 'utf8').includes('renderer-gone')).toBe(true);
    // Playwright retains the crashed target; inspect the replacement renderer via Electron.
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('document.querySelector("#page-title")?.textContent'))).toBe('your inbox.');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('window.recoverySentinel'))).toBeUndefined();
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('fetch("/api/preferences").then(r => r.status)'))).toBe(200);
    const db = new DatabaseSync(path.join(data, 'inkwell.db'), { readOnly: true });
    try {
      expect(db.prepare("SELECT body FROM messages WHERE folder='drafts' AND subject='Recovery test draft'").get().body).toBe('Latest work during recovery 5');
    } finally { db.close(); }
    const entries = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    expect(entries.filter((entry) => entry.event === 'backend-exit' && !entry.expected)).toHaveLength(6);
    expect(entries.filter((entry) => entry.event === 'backend-state' && entry.state === 'ready')).toHaveLength(7);
    expect(entries.some((entry) => entry.event === 'renderer-gone')).toBe(true);
    expect(fs.readFileSync(log, 'utf8')).not.toContain('Latest work during recovery');
  } catch (error) {
    if (fs.existsSync(log)) console.error(fs.readFileSync(log, 'utf8'));
    if (app) console.error(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ url: w.webContents.getURL(), loading: w.webContents.isLoading(), crashed: w.webContents.isCrashed() }))));
    console.error('Renderer errors:', pageErrors);
    throw error;
  } finally {
    if (app) {
      // A failed test may leave an offline editor whose close guard cannot flush.
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.destroy())).catch(() => {});
      await app.close().catch(() => {});
    }
    fs.rmSync(data, { recursive: true, force: true });
  }
});
