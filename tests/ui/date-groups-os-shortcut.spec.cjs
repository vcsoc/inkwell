const { test, expect } = require('@playwright/test');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path'),
  os = require('node:os');
const { sidebarClick } = require('./helpers.cjs');
test.use({ timezoneId: 'America/New_York' });
const api = (page, url, method = 'GET', body) =>
  page.evaluate(
    async ({ url, method, body }) => {
      const r = await fetch('/api' + url, {
        method,
        headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!r.ok) throw Error(await r.text());
      return r.json();
    },
    { url, method, body },
  );
let original, ids;
test.beforeEach(async ({ page }) => {
  ids = [];
  await page.goto('/');
  original = await api(page, '/preferences');
});
test.afterEach(async ({ page }) => {
  for (const id of ids) {
    await api(page, '/messages/' + id, 'PATCH', { folder: 'trash' });
    await api(page, '/messages/' + id, 'DELETE');
  }
  await api(page, '/preferences', 'PUT', original);
});
test('date grouping persists across folders/reload, supports tables and keeps the reader intact', async ({
  page,
}) => {
  // Keep other tests' sample messages in Older, never in a future date group.
  const year = new Date().getFullYear() + 10;
  await page.clock.setFixedTime(new Date(`${year}-09-17T16:00:00Z`));
  await api(page, '/preferences', 'PUT', {
    ...original,
    layout: 'classic',
    mail_sort: 'subject',
    mail_order: 'desc',
    group_messages_by_date: false,
    quick_filter_visible: true,
  });
  if (!process.env.INKWELL_UI_DATA?.startsWith(path.join(os.tmpdir(), 'inkwell-ui-')))
    throw Error('Unsafe fixture path');
  const db = new DatabaseSync(path.join(process.env.INKWELL_UI_DATA, 'inkwell.db'));
  try {
    for (const folder of ['inbox', 'archive'])
      for (const [i, day] of ['09-17', '09-15', '09-03', '08-20'].entries()) {
        const m = await api(page, '/drafts', 'POST', {
          subject: `Date grouping ${folder} ${i}`,
          body: 'Reader text https://example.org/',
        });
        ids.push(m.id);
        await api(page, '/messages/' + m.id, 'PATCH', { folder });
        db.prepare('UPDATE messages SET date=? WHERE id=?').run(`${year}-${day}T12:00:00Z`, m.id);
      }
  } finally {
    db.close();
  }
  await page.reload();
  await page.locator(`[data-message="${ids[0]}"] .subject`).click();
  await page.getByRole('switch', { name: 'Enable text links', exact: true }).check();
  await page.evaluate(() => (window.savedGroupReader = document.querySelector('#message-preview')));
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/preferences/workspace') && r.request().method() === 'PATCH',
  );
  await page.getByRole('switch', { name: 'Group by date', exact: true }).check();
  await saved;
  await expect(page.locator('.mail-date-heading')).toHaveText([
    'Today',
    'This Week',
    'This Month',
    'Older',
  ]);
  expect(
    await page.evaluate(
      () => window.savedGroupReader === document.querySelector('#message-preview'),
    ),
  ).toBe(true);
  await expect(page.getByRole('switch', { name: 'Enable text links', exact: true })).toBeChecked();
  await expect(page.locator('#quick-sort')).toBeDisabled();
  await page.clock.setFixedTime(new Date(`${year}-09-18T16:00:00Z`));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.mail-date-heading')).toHaveText(['This Week', 'This Month', 'Older']);
  expect(
    await page.evaluate(
      () => window.savedGroupReader === document.querySelector('#message-preview'),
    ),
  ).toBe(true);
  await page.clock.setFixedTime(new Date(`${year}-09-17T16:00:00Z`));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Group by date', exact: true })).toBeChecked();
  await sidebarClick(page, '#navigation [data-view=archive]');
  await expect(page.locator('.mail-date-heading')).toHaveText([
    'Today',
    'This Week',
    'This Month',
    'Older',
  ]);
  await page.locator('#quick-view').selectOption('table');
  await expect(page.locator('.message-table-header')).toBeVisible();
  await expect(page.locator('.mail-date-heading')).toHaveText([
    'Today',
    'This Week',
    'This Month',
    'Older',
  ]);
  await page.locator('#quick-order').selectOption('asc');
  await expect(page.locator('.mail-date-heading')).toHaveText([
    'Older',
    'This Month',
    'This Week',
    'Today',
  ]);
  const off = page.waitForResponse(
    (r) => r.url().endsWith('/api/preferences/workspace') && r.request().method() === 'PATCH',
  );
  await page.getByRole('switch', { name: 'Group by date', exact: true }).uncheck();
  await off;
  await expect(page.locator('.mail-date-heading')).toHaveCount(0);
  await expect(page.locator('#quick-sort')).toHaveValue('subject');
  await expect(page.locator('#quick-sort')).toBeEnabled();
});
test('Omarchy shortcut is explicit, reversible and independent of in-app shortcut saves', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let enabled = false;
    window.inkwellOsShortcut = {
      status: async () => ({ available: true, enabled, active: enabled }),
      enable: async () => {
        enabled = true;
        return { available: true, enabled, active: true };
      },
      disable: async () => {
        enabled = false;
        return { available: true, enabled, active: false };
      },
    };
  });
  await page.reload();
  await page.goto('/#/settings/shortcuts');
  await expect(page.locator('#os-shortcut-toggle')).toHaveText('Enable Super+I');
  await page.locator('#os-shortcut-toggle').click();
  await expect(page.locator('#os-shortcut-status')).toContainText('enabled');
  await page.getByRole('button', { name: 'Save shortcuts', exact: true }).click();
  await expect(page.locator('#os-shortcut-toggle')).toHaveText('Disable Super+I');
  await page.locator('#os-shortcut-toggle').click();
  await expect(page.locator('#os-shortcut-toggle')).toHaveText('Enable Super+I');
});
test('Omarchy shortcut conflicts cannot be overwritten from settings', async ({ page }) => {
  await page.addInitScript(() => {
    window.inkwellOsShortcut = {
      status: async () => ({ available: true, enabled: false, conflict: 'Existing app' }),
    };
  });
  await page.reload();
  await page.goto('/#/settings/shortcuts');
  await expect(page.locator('#os-shortcut-toggle')).toBeDisabled();
  await expect(page.locator('#os-shortcut-status')).toContainText('Existing app');
});
