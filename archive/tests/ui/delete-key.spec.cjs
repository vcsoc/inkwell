const { test, expect } = require('@playwright/test');
const { sidebarClick } = require('./helpers.cjs');
let prefix, ids;
async function api(page, path, method = 'GET', body) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const r = await fetch('/api' + path, {
        method,
        headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!r.ok) throw Error(await r.text());
      return r.json();
    },
    { path, method, body },
  );
}
test.beforeEach(async ({ page }) => {
  prefix = 'Delete key ' + Date.now();
  ids = [];
  await page.goto('/');
  for (const suffix of ['One', 'Two']) {
    const r = await api(page, '/drafts', 'POST', {
      subject: prefix + ' ' + suffix,
      body: 'Local test',
    });
    ids.push(r.id);
    await api(page, '/messages/' + r.id, 'PATCH', { folder: 'inbox' });
  }
  await page.reload();
  await expect(page.locator(`[data-message="${ids[0]}"]`)).toBeVisible();
});
test.afterEach(async ({ page }) => {
  await page.unroute('**/api/messages/trash-selection');
  const rows = await api(page, '/messages?scope=all&q=' + encodeURIComponent(prefix));
  if (rows.length) {
    await api(page, '/messages/trash-selection', 'POST', { ids: rows.map((r) => r.id) });
    await api(page, '/messages/trash-selection', 'POST', {
      ids: rows.map((r) => r.id),
      permanent: true,
    });
  }
});
for (const modifier of ['Control', 'Meta'])
  test(`${modifier}-click includes the highlighted message in the Delete batch`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile',
      'Ctrl-click requires the side-by-side mail list and reader.',
    );
    await page.locator(`[data-message="${ids[0]}"] .subject`).click();
    await page.locator(`[data-message="${ids[1]}"] .subject`).click({ modifiers: [modifier] });
    for (const id of ids)
      await expect(page.locator(`[data-message="${id}"] .select-message`)).toBeChecked();
    await expect(page.locator('#selection-count')).toHaveText('2 selected');
    await page.keyboard.press('Delete');
    for (const id of ids)
      await expect.poll(async () => (await api(page, '/messages/' + id)).folder).toBe('trash');
  });
test('Explicitly unchecking the first message excludes it from Delete', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'mobile',
    'Ctrl-click requires the side-by-side mail list and reader.',
  );
  await page.locator(`[data-message="${ids[0]}"] .subject`).click();
  await page.locator(`[data-message="${ids[1]}"] .subject`).click({ modifiers: ['Control'] });
  await page.locator(`[data-message="${ids[0]}"] .select-message`).uncheck();
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await api(page, '/messages/' + ids[1])).folder).toBe('trash');
  expect((await api(page, '/messages/' + ids[0])).folder).toBe('inbox');
});
test('Delete trashes checked messages, then permanently removes them from local Trash', async ({
  page,
}) => {
  for (const id of ids) await page.locator(`[data-message="${id}"] .select-message`).check();
  await page.keyboard.press('Delete');
  await expect(page.locator(`[data-message="${ids[0]}"]`)).toHaveCount(0);
  for (const id of ids) expect((await api(page, '/messages/' + id)).folder).toBe('trash');
  await sidebarClick(page, '#navigation [data-view=trash]');
  for (const id of ids) await page.locator(`[data-message="${id}"] .select-message`).check();
  await expect(page.locator('#delete-selected')).toHaveText('Delete permanently');
  await page.keyboard.press('Delete');
  await expect(page.locator(`[data-message="${ids[0]}"]`)).toHaveCount(0);
  expect(await api(page, '/messages?scope=all&q=' + encodeURIComponent(prefix))).toHaveLength(0);
});
test('Delete works on the highlighted reader message and ignores repeated keydown', async ({
  page,
}) => {
  await page.locator(`[data-message="${ids[0]}"] .subject`).click();
  await expect(page.locator('#reader')).toContainText(prefix + ' One');
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await api(page, '/messages/' + ids[0])).folder).toBe('trash');
  await page.locator(`[data-message="${ids[1]}"] .select-message`).check();
  await page
    .locator(`[data-message="${ids[1]}"] .select-message`)
    .dispatchEvent('keydown', { key: 'Delete', repeat: true });
  expect((await api(page, '/messages/' + ids[1])).folder).toBe('inbox');
});
test('Delete edits search and compose text, and never deletes mail while folder navigation has focus', async ({
  page,
}) => {
  await page.locator(`[data-message="${ids[0]}"] .select-message`).check();
  const search = page.locator('#global-search');
  await search.fill('x');
  await search.press('Home');
  await search.press('Delete');
  await expect(search).toHaveValue('');
  await sidebarClick(page, '#navigation [data-view=inbox]');
  await page.locator(`[data-message="${ids[0]}"] .select-message`).check();
  if (!(await page.locator('#navigation [data-view=inbox]').isVisible()))
    await page.locator('#menu').click();
  await page.locator('#navigation [data-view=inbox]').focus();
  await page.keyboard.press('Delete');
  expect((await api(page, '/messages/' + ids[0])).folder).toBe('inbox');
  await sidebarClick(page, '#navigation [data-view=inbox]');
  await page.locator('#heading-compose').click();
  await page.getByLabel('Subject', { exact: true }).fill(prefix + ' Draft');
  await page.getByLabel('Subject', { exact: true }).press('Home');
  await page.keyboard.press('Delete');
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue(
    (prefix + ' Draft').slice(1),
  );
  await page.getByLabel('Subject', { exact: true }).fill(prefix + ' Draft');
  await page.locator('#close-modal').click();
  expect((await api(page, '/messages/' + ids[0])).folder).toBe('inbox');
});
test('A delayed Delete refreshes the list without replacing a newly opened reader', async ({
  page,
}) => {
  let capture;
  const waiting = new Promise((resolve) => (capture = resolve));
  await page.route('**/api/messages/trash-selection', (r) => capture(r));
  await page.locator(`[data-message="${ids[0]}"] .select-message`).check();
  await page.keyboard.press('Delete');
  const request = await waiting;
  await page.locator(`[data-message="${ids[1]}"] .subject`).click();
  await expect(page.locator('#reader')).toContainText(prefix + ' Two');
  await page.evaluate(() => (window.keptReader = document.querySelector('#reader')));
  await request.continue();
  await page.unroute('**/api/messages/trash-selection');
  await expect(page.locator(`[data-message="${ids[0]}"]`)).toHaveCount(0);
  await expect(page.locator('#reader')).toContainText(prefix + ' Two');
  expect(await page.evaluate(() => window.keptReader === document.querySelector('#reader'))).toBe(
    true,
  );
});
test('Mixed-folder selections go to Trash without permanently deleting existing Trash copies', async ({
  page,
}) => {
  await api(page, '/messages/trash-selection', 'POST', { ids: [ids[0]] });
  await page.locator('#global-search').fill(prefix);
  await expect(page.locator(`[data-message="${ids[0]}"]`)).toBeVisible();
  for (const id of ids) await page.locator(`[data-message="${id}"] .select-message`).check();
  await page.keyboard.press('Delete');
  await expect(page.locator('#toast')).toContainText('moved to Trash');
  for (const id of ids) expect((await api(page, '/messages/' + id)).folder).toBe('trash');
});
