const { test, expect } = require('@playwright/test');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path'),
  os = require('node:os');
const { sidebarClick, selectEmailMenuAction } = require('./helpers.cjs');
let original, ids, folders, prefix;
async function api(page, url, method = 'GET', body) {
  return page.evaluate(
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
}
test.beforeEach(async ({ page }) => {
  ids = [];
  folders = [];
  prefix = 'Controls' + Date.now();
  await page.goto('/');
  original = await api(page, '/preferences');
  await api(page, '/preferences', 'PUT', {
    ...original,
    layout: 'classic',
    form_mode: 'popup',
    mail_view: 'cards',
  });
  if (!process.env.INKWELL_UI_DATA?.startsWith(path.join(os.tmpdir(), 'inkwell-ui-')))
    throw Error('Unsafe fixture path');
  for (let i = 1; i <= 3; i++) {
    const m = await api(page, '/drafts', 'POST', {
      subject: prefix + ' ' + i,
      body: 'Reader content',
    });
    ids.push(m.id);
    await api(page, '/messages/' + m.id, 'PATCH', { folder: 'inbox' });
    const db = new DatabaseSync(path.join(process.env.INKWELL_UI_DATA, 'inkwell.db'));
    db.prepare('UPDATE messages SET date=?,html_body=? WHERE id=?').run(
      `2090-05-0${i}T12:00:00Z`,
      '<p>Private preview</p>',
      m.id,
    );
    db.close();
  }
  await page.reload();
});
test.afterEach(async ({ page }) => {
  for (const id of ids) {
    await api(page, '/messages/' + id, 'PATCH', { folder: 'trash' });
    await api(page, '/messages/' + id, 'DELETE');
  }
  for (const id of folders.reverse()) await api(page, '/local-folders/' + id, 'DELETE');
  await api(page, '/preferences', 'PUT', original);
});
test('Inclusive date filters clear independently and retain text and the reader', async ({
  page,
}) => {
  await page.locator('#global-search').fill(prefix);
  await expect(page.locator('.message-row')).toHaveCount(3);
  await page.locator(`[data-message="${ids[0]}"]`).click();
  const frame = page.locator('#reader iframe');
  await expect(frame).toBeVisible();
  await frame.evaluate((e) => (e.dataset.retained = 'yes'));
  await page.locator('#search-date-from').fill('2090-05-02');
  await expect(page.locator('.message-row')).toHaveCount(2);
  await page.locator('#search-date-to').fill('2090-05-02');
  await expect(page.locator('.message-row')).toHaveCount(1);
  await page.locator('#clear-date-from').click();
  await expect(page.locator('.message-row')).toHaveCount(2);
  await page.locator('#clear-date-to').click();
  await expect(page.locator('.message-row')).toHaveCount(3);
  await expect(page.locator('#global-search')).toHaveValue(prefix);
  await expect(frame).toHaveAttribute('data-retained', 'yes');
  await page.locator('#search-date-from').fill('2090-05-03');
  await expect(page.locator('.message-row')).toHaveCount(1);
  await page.locator('#search-date-to').fill('2090-05-02');
  await expect(page.locator('#toast')).toContainText('previous filter is unchanged');
  await expect(page.locator('.message-row')).toHaveCount(1);
  await page.locator('#clear-date-to').click();
  await expect(page.locator('#search-date-to')).toHaveValue('');
});
test('Flagging highlights the entire row, survives reload and remains separate from stars', async ({
  page,
}) => {
  await page.locator('#global-search').fill(prefix);
  const row = page.locator(`[data-message="${ids[0]}"]`);
  await expect(row).toBeVisible();
  const normal = await row.evaluate((e) => getComputedStyle(e).backgroundColor);
  await row.getByRole('button', { name: 'Flag message', exact: true }).click();
  await expect(row).toHaveClass(/flagged-message/);
  expect(await row.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(normal);
  await row.locator('.star-button').click();
  expect((await api(page, '/messages/' + ids[0])).flagged).toBe(1);
  await api(page, '/preferences/workspace', 'PATCH', { mail_view: 'table' });
  await page.reload();
  await page.locator('#global-search').fill(prefix);
  await expect(row).toHaveClass(/flagged-message/);
  await row.locator('.message-more').click();
  await selectEmailMenuAction(page, 'Unflag message (local)');
  await expect(row).not.toHaveClass(/flagged-message/);
  expect((await api(page, '/messages/' + ids[0])).starred).toBe(1);
});
test('Folder double-click toggles once and arrows retain keyboard tree controls', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'mobile', 'Touch users retain the disclosure control.');
  const parent = await api(page, '/local-folders', 'POST', { name: prefix });
  folders.push(parent.id);
  const child = await api(page, '/local-folders', 'POST', {
    name: prefix + ' child',
    parent: 'local-' + parent.id,
  });
  folders.push(child.id);
  await page.reload();
  const branch = page.locator(`[data-local-branch="local-${parent.id}"]`),
    button = branch.locator(':scope > summary button');
  await sidebarClick(page, `[data-view="local-${parent.id}"]`);
  await expect(branch).toHaveAttribute('open', '');
  await button.dblclick();
  await expect(branch).not.toHaveAttribute('open');
  await button.dblclick();
  await expect(branch).toHaveAttribute('open', '');
  await button.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(branch).not.toHaveAttribute('open');
  await page.keyboard.press('ArrowRight');
  await expect(branch).toHaveAttribute('open', '');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator(`[data-view="local-${child.id}"]`)).toBeFocused();
});
test('Shortcuts save, survive reload, ignore typing and reset to defaults', async ({ page }) => {
  await page.goto('/#/settings/shortcuts');
  await page.locator('[data-shortcut-capture="sync"]').press('F8');
  await page.locator('[data-shortcut-capture="compose"]').press('Control+Shift+M');
  await page.getByRole('button', { name: 'Save shortcuts', exact: true }).click();
  await expect(page.locator('#shortcut-status')).toContainText('saved');
  await page.reload();
  await expect(page.locator('[data-shortcut-capture="sync"]')).toHaveValue('F8');
  await sidebarClick(page, '#navigation [data-view="inbox"]');
  await page.locator('#page-title').focus();
  await page.keyboard.press('c');
  await expect(page.locator('#compose-form')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+M');
  const subject = page.locator('#compose-form [name=subject]');
  await subject.fill(prefix + ' keyboard draft');
  await subject.press('ArrowLeft');
  await expect(subject).toBeFocused();
  await page.locator('#close-modal').click();
  const drafts = await api(page, '/messages?folder=drafts&q=' + encodeURIComponent(prefix));
  ids.push(...drafts.map((d) => d.id));
  await page.goto('/#/settings/shortcuts');
  await page.getByRole('button', { name: 'Reset defaults', exact: true }).click();
  await expect(page.locator('#shortcut-status')).toContainText('saved');
  expect((await api(page, '/preferences')).shortcuts.sync).toBe('F9');
});
test('Arrow keys navigate messages without an extra sidebar compose button or page overflow', async ({
  page,
}) => {
  await expect(page.locator('#compose')).toHaveCount(0);
  await expect(page.locator('#heading-compose')).toBeVisible();
  await page.locator('#global-search').fill(prefix);
  await expect(page.locator('.message-row')).toHaveCount(3);
  await page.locator('#page-title').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#reader h2')).toContainText(prefix + ' 3');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#reader h2')).toContainText(prefix + ' 2');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#reader h2')).toContainText(prefix + ' 3');
  await page.locator('#global-search').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#global-search')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});
