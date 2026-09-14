const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { settingsSection, readerAction, sidebarClick } = require('./ui/helpers.cjs');
test('Desktop startup, forms, theme and sandbox', { timeout: 15000 }, async (t) => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-desktop-'));
  const initial = new DatabaseSync(path.join(data, 'inkwell.db'));
  initial.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
  initial.prepare('INSERT INTO settings VALUES (?,?)').run(
    'preferences',
    JSON.stringify({
      theme: { background: '#102030', surface: '#1c2834', text: '#eeeeee', dark: true },
    }),
  );
  initial.close();
  let app;
  t.signal.addEventListener(
    'abort',
    () => {
      app?.close().catch(() => {});
    },
    { once: true },
  );
  try {
    app = await electron.launch({
      executablePath: process.env.INKWELL_TEST_EXECUTABLE || undefined,
      args: [
        ...(process.env.INKWELL_TEST_EXECUTABLE ? [] : ['.']),
        `--user-data-dir=${path.join(data, 'electron-profile')}`,
      ],
      env: { ...process.env, INKWELL_DATA_DIR: data },
      timeout: 5000,
    });
    const window = await app.firstWindow({ timeout: 5000 });
    window.setDefaultTimeout(3000);
    window.setDefaultNavigationTimeout(5000);
    await expect(window.locator('#page-title')).toContainText('Your inbox');
    expect(await app.evaluate(({ app }) => app.getName())).toBe('inkwell');
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].getBackgroundColor(),
      ),
    ).toMatch(/(?:ff)?102030$/i);
    await expect(window.locator('body')).toHaveCSS('background-color', 'rgb(16, 32, 48)');
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
      .toBe(true);
    await expect(window.locator('.brand-logo')).toHaveCSS('mask-image', /logo\.png/);
    await expect(window.locator('#modal')).not.toBeVisible();
    await window.getByRole('button', { name: 'Explore demo', exact: true }).click();
    await expect(window.locator('.message-row')).toHaveCount(5);
    await expect(
      window.getByRole('searchbox', { name: 'Search email', exact: true }),
    ).toBeVisible();
    await expect(window.locator('#mail-activity')).toHaveCount(1);
    expect(await window.evaluate(async () => (await fetch('/api/remote-folders')).json())).toEqual(
      [],
    );
    const messageId = Number(
      await window.locator('.message-row').first().getAttribute('data-message'),
    );
    const database = new DatabaseSync(path.join(data, 'inkwell.db'));
    database.exec('PRAGMA busy_timeout=1000');
    database
      .prepare('UPDATE messages SET html_body=? WHERE id=?')
      .run(
        '<h1>Packaged HTML preview</h1><img src="https://images.example.org/pixel.png">',
        messageId,
      );
    database.close();
    await window.locator('.message-row').first().click();
    const email = window.frameLocator('.html-message');
    await expect(email.getByRole('heading', { name: 'Packaged HTML preview' })).toBeVisible();
    await expect(email.locator('[src],script')).toHaveCount(0);
    await email.getByRole('heading', { name: 'Packaged HTML preview' }).click();
    // CDP keyboard injection bypasses Electron's before-input-event; use native input.
    const zoomKey = (key) =>
      app.evaluate(({ BrowserWindow }, keyCode) => {
        const wc = BrowserWindow.getAllWindows()[0].webContents;
        wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['control'] });
        wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['control'] });
      }, key);
    await zoomKey('=');
    await expect(window.locator('html')).toHaveCSS('zoom', '1.1');
    await zoomKey('0');
    await expect(window.locator('html')).toHaveCSS('zoom', '1');
    await app.evaluate(({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: ['control', 'shift'] });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'K', modifiers: ['control', 'shift'] });
    });
    await expect(window.locator('#global-search')).toBeFocused();
    await readerAction(window, 'Not Junk', 'Not Junk');
    await expect(window.locator('#toast')).toContainText('Future imports use rules or Inbox');
    await window.locator('.message-row [data-more]').first().click();
    await expect(window.getByRole('menuitem', { name: 'Reply', exact: true })).toBeVisible();
    await window.getByRole('menuitem', { name: 'File', exact: true }).click();
    await expect(
      window.getByRole('menuitem', { name: 'Move local copy…', exact: true }),
    ).toBeVisible();
    await window.keyboard.press('Escape');
    await window.keyboard.press('Escape');
    if (await window.locator('.mobile-tabs').isVisible()) {
      await window
        .locator('.mobile-tabs')
        .getByRole('button', { name: 'Settings', exact: true })
        .click();
    } else {
      await window.locator('#settings').click();
    }
    await settingsSection(window, 'Mail accounts');
    await app.evaluate(({ shell }) => {
      globalThis.inkwellTestExternalURLs = [];
      shell.openExternal = async (url) => {
        globalThis.inkwellTestExternalURLs.push(url);
      };
    });
    await window.getByRole('link', { name: 'Open Outlook.com webmail' }).click();
    await window.getByRole('link', { name: 'Open Microsoft 365 webmail' }).click();
    await expect
      .poll(() => app.evaluate(() => globalThis.inkwellTestExternalURLs))
      .toEqual(['https://outlook.live.com/mail/', 'https://outlook.office.com/mail/']);
    await window.evaluate(() => {
      window.open('https://example.com/');
      window.open('https://outlook.live.com.evil.example/mail/');
      window.open('https://outlook.live.com/mail/?redirect=https://example.com');
    });
    expect(await app.evaluate(() => globalThis.inkwellTestExternalURLs)).toHaveLength(2);
    expect(app.windows()).toHaveLength(1);
    for (let attempt = 0; attempt < 2; attempt++) {
      await window.getByRole('button', { name: 'Connect email' }).click();
      const provider = window.getByLabel('Quick setup');
      await provider.focus();
      await window.keyboard.press('ArrowDown');
      await window.keyboard.press('Enter');
      await expect(provider).toHaveValue('outlook');
      await expect(
        window.getByRole('button', { name: 'Sign in with Microsoft', exact: true }),
      ).toBeEnabled();
      await expect(window.getByLabel('App password', { exact: true })).not.toBeVisible();
      await window.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await expect(window.locator('#discard-confirmation')).toHaveCount(0);
      await expect(window.locator('#modal')).not.toBeVisible();
    }
    await settingsSection(window, 'Forms');
    await window.getByLabel('Form presentation').selectOption('inline');
    await window.getByRole('button', { name: 'Save form preference' }).click();
    await expect(window.locator('#toast')).toContainText('Form preference saved');
    await settingsSection(window, 'Theme studio');
    await expect(window.locator('#theme-editor input[type=color]')).toHaveCount(0);
    await expect(window.getByLabel('Sidebar text size', { exact: true })).toHaveValue('16');
    expect(
      await window.evaluate(
        () =>
          InkwellThemeFiles.parse(InkwellThemeFiles.stringify(InkwellAppearance.defaults)).theme
            .sidebar_font_size,
      ),
    ).toBe(16);
    await window.getByLabel('Starting palette').selectOption('Midnight');
    await window.getByRole('button', { name: 'Save theme', exact: true }).click();
    await expect(window.locator('#theme-status')).toHaveText('Saved theme');
    await settingsSection(window, 'Mail accounts');
    await window.getByRole('button', { name: 'Connect email' }).click();
    await expect(window.locator('main #modal.inline-form')).toBeVisible();
    expect(await window.locator('#modal').evaluate((el) => el.matches(':modal'))).toBe(false);
    await expect(window.locator('body')).toHaveCSS('background-color', 'rgb(21, 26, 32)');
    const preferences = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
    );
    expect(preferences.nodeIntegration).toBe(false);
    expect(preferences.contextIsolation).toBe(true);
    expect(preferences.sandbox).toBe(true);
    await window.locator('#close-modal').click();
    await sidebarClick(window, '#tag-manager-link');
    await window.getByLabel('Tag name', { exact: true }).fill('Desktop tag manager');
    await window.getByLabel('Choose tag color', { exact: true }).click();
    await window.getByRole('button', { name: 'Set Tag color to #2664a0', exact: true }).click();
    await window.getByRole('button', { name: 'Save tag', exact: true }).click();
    await expect(window.locator('.tag-manager-item .tag-pill')).toHaveCSS(
      'background-color',
      'rgb(38, 100, 160)',
    );
    if (!(await window.locator('#navigation [data-view=archive]').isVisible()))
      await window.locator('#menu').click();
    await window.locator('#navigation [data-view=archive]').click({ button: 'right' });
    await window.getByRole('menuitem', { name: 'New subfolder…', exact: true }).click();
    await window.getByLabel('Folder name', { exact: true }).fill('Desktop subfolder');
    await window.getByRole('button', { name: 'Create subfolder', exact: true }).click();
    await expect(
      window.locator('#navigation [aria-label="Archive / Desktop subfolder"]'),
    ).toBeAttached();
    await sidebarClick(window, '#rule-manager-link');
    await expect(window.locator('#not-junk-senders')).toContainText('@');
    expect(
      await window.evaluate(() => {
        const left = document.querySelector('.rule-list-pane').getBoundingClientRect(),
          right = document.querySelector('#rule-editor').getBoundingClientRect();
        return document.querySelector('.rule-manager').clientWidth > 840
          ? left.right < right.left
          : left.bottom < right.top;
      }),
    ).toBe(true);
    await window.getByRole('button', { name: 'Create auto-tag rule', exact: true }).click();
    await window.getByLabel('Rule name', { exact: true }).fill('Desktop rule');
    await window.getByLabel('Condition 1 value', { exact: true }).fill('@example.com');
    await window
      .getByLabel('Action 1 value', { exact: true })
      .selectOption({ label: 'Desktop tag manager' });
    await window.getByRole('button', { name: 'Save rule', exact: true }).click();
    await expect(window.locator('#rules-list')).toContainText('Desktop rule');
    await expect(window.locator('.rule-entry.active .rule-choice')).toContainText('Desktop rule');
    await expect(window.getByLabel('Rule name', { exact: true })).toHaveValue('Desktop rule');
    await sidebarClick(window, '#navigation [data-view=inbox]');
    await window.locator(`[data-more="${messageId}"]`).click();
    await window.getByRole('menuitem', { name: 'Apply rule…', exact: true }).click();
    await window.getByLabel('Rule name', { exact: true }).fill('Desktop context rule');
    await window.getByLabel('Condition 1 field', { exact: true }).selectOption('tld');
    await expect(window.getByLabel('Condition 1 value', { exact: true })).not.toHaveValue('');
    await window
      .getByLabel('Action 1 value', { exact: true })
      .selectOption({ label: 'Desktop tag manager' });
    await window
      .getByRole('button', { name: 'Save and apply to this message', exact: true })
      .click();
    await expect(window.locator('#toast')).toContainText('saved and applied');
    await sidebarClick(window, '#navigation [data-view=inbox]');
    await expect(window.locator('#search-scope')).toHaveValue('all');
    expect(
      await window.evaluate(
        async (id) =>
          (
            await fetch('/api/messages/' + id, {
              method: 'PATCH',
              headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
              body: JSON.stringify({ tags: ['Desktop tag manager'] }),
            })
          ).status,
        messageId,
      ),
    ).toBe(200);
    await window.locator('#global-search').fill('tag:"DESKTOP TAG MANAGER"');
    await expect(window.locator('.message-row')).toHaveCount(1);
    await expect(window.locator('.message-row .tag-pill')).toHaveText('Desktop tag manager');
    await window.locator('#global-search').fill('');
    await expect(window.locator('.message-row')).toHaveCount(5);
    await window.locator('#quick-view').selectOption('table');
    await expect(window.locator('.message-table-header')).toBeVisible();
    await window.locator('#quick-view').selectOption('cards');
    await window.locator('#heading-compose').click();
    await window.locator('[name=subject]').fill('Desktop close autosave');
    await window.locator('#toggle-cc').click();
    await window.getByLabel('Cc', { exact: true }).fill('copy@example.com');
    await window.locator('#toggle-bcc').click();
    await window.getByLabel('Bcc', { exact: true }).fill('hidden@example.com');
    await window.locator('[name=body]').fill('Latest text immediately before closing');
    const closed = app.waitForEvent('close', { timeout: 5000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
    app = null;
    const saved = new DatabaseSync(path.join(data, 'inkwell.db'));
    expect(
      saved
        .prepare(
          "SELECT body FROM messages WHERE folder='drafts' AND subject='Desktop close autosave'",
        )
        .get().body,
    ).toBe('Latest text immediately before closing');
    expect(
      saved
        .prepare(
          "SELECT cc,bcc FROM messages WHERE folder='drafts' AND subject='Desktop close autosave'",
        )
        .get(),
    ).toMatchObject({ cc: 'copy@example.com', bcc: 'hidden@example.com' });
    saved.close();
    console.log(
      'Desktop smoke test passed: backend, session, forms, themes, sandbox and close-time draft autosave.',
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
});
