const { test, expect } = require('@playwright/test');
let original, prefix, ids;
async function api(page, url, method = 'GET', body) {
  return page.evaluate(
    async ({ url, method, body }) => {
      const response = await fetch('/api' + url, {
        method,
        headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw Error(await response.text());
      return response.json();
    },
    { url, method, body },
  );
}
async function tag(page, name, color = '#2664a0') {
  return (await api(page, '/tags', 'POST', { name: prefix + name, color })).id;
}
async function message(page, subject, tags = [], unread = true, starred = false) {
  const id = (
    await api(page, '/drafts', 'POST', { subject: prefix + subject, body: 'Local tag test body' })
  ).id;
  ids.push(id);
  await api(page, '/messages/' + id, 'PATCH', {
    folder: 'inbox',
    tags: tags.map((t) => prefix + t),
    unread,
    starred,
  });
  return id;
}
test.beforeEach(async ({ page }) => {
  prefix = 'Tags ' + Date.now() + ' ';
  ids = [];
  await page.goto('/');
  original = await api(page, '/preferences');
  await api(page, '/preferences', 'PUT', {
    ...original,
    layout: 'classic',
    form_mode: 'popup',
    ui_zoom: 100,
    mail_view: 'cards',
    mail_sort: 'date',
    mail_order: 'desc',
    quick_filter_visible: true,
    quick_filter_pinned: false,
  });
  await page.reload();
});
test.afterEach(async ({ page }) => {
  for (const id of ids) {
    await api(page, '/messages/' + id, 'PATCH', { folder: 'trash' });
    await api(page, '/messages/' + id, 'DELETE');
  }
  const tags = (await api(page, '/tags')).filter((t) => t.name.startsWith(prefix));
  if (tags.length) await api(page, '/tags/delete', 'POST', { ids: tags.map((t) => t.id) });
  await api(page, '/preferences', 'PUT', original);
});
test('Tag Manager creates and edits colors with local controls and appears above Settings', async ({
  page,
}, info) => {
  await page.goto('/#/tags');
  await expect(page.locator('#tag-manager')).toBeVisible();
  expect(
    await page
      .locator('#tag-manager-link')
      .evaluate((el) => !!el.nextElementSibling?.matches('#settings')),
  ).toBe(true);
  await page.getByRole('button', { name: 'Create tag', exact: true }).click();
  await page.getByLabel('Tag name', { exact: true }).fill(prefix + 'Project');
  await page.getByLabel('Tag color', { exact: true }).fill('#ffdc60');
  await page.getByRole('button', { name: 'Save tag', exact: true }).click();
  const name = prefix + 'Project';
  await expect(
    page.getByRole('button', { name: 'Show messages tagged ' + name, exact: true }),
  ).toBeVisible();
  let entry = (await api(page, '/tags')).find((t) => t.name === name);
  await expect(page.locator(`[data-tag-id="${entry.id}"] .tag-pill`)).toHaveCSS(
    '--tag-bg',
    '#ffdc60',
  );
  await page.locator(`[data-edit-tag="${entry.id}"]`).click();
  await page.getByLabel('Tag name', { exact: true }).fill(prefix + 'Renamed');
  await page.getByLabel('Tag color', { exact: true }).fill('#2664a0');
  await expect(page.locator('#tag-editor input[type=color]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save tag', exact: true }).click();
  await expect(page.locator(`[data-tag-id="${entry.id}"] .tag-pill`)).toHaveCSS(
    '--tag-bg',
    '#2664a0',
  );
  await page.locator('#tag-search').fill(prefix);
  await page.locator('#tag-usage').selectOption('unused');
  await expect(page.locator('.tag-manager-item')).toHaveCount(1);
  await page.screenshot({
    path: `test-results/${info.project.name}-tag-manager.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
test('Tag directory uses full-width grouped columns and compact names', async ({ page }, info) => {
  for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta']) await tag(page, name);
  await page.goto('/#/tags');
  await page.locator('#tag-search').fill(prefix);
  await expect(page.locator('.tag-letter-grid .tag-manager-item')).toHaveCount(6);
  const layout = await page.locator('.tag-letter-grid').evaluate((el) => ({
    columns: getComputedStyle(el).gridTemplateColumns.split(' ').length,
    width: el.getBoundingClientRect().width,
    manager: document.querySelector('#tag-manager').getBoundingClientRect().width,
  }));
  expect(layout.width).toBeGreaterThan(layout.manager * 0.95);
  if (info.project.name === 'desktop') expect(layout.columns).toBeGreaterThan(1);
  await expect(page.locator('.tag-manager-name .tag-pill').first()).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({
    path: `test-results/${info.project.name}-tag-directory.png`,
    fullPage: true,
  });
});
test('multi-select merge and delete update message labels without deleting messages', async ({
  page,
}) => {
  const first = await message(page, 'Message', ['Alpha', 'Beta']);
  await page.goto('/#/tags');
  await page.locator('#tag-search').fill(prefix);
  await page.locator('#select-all-tags').check();
  await page.locator('#merge-tags input').fill(prefix + 'Combined');
  await page.getByRole('button', { name: 'Replace / merge selected', exact: true }).click();
  await expect(page.locator('.tag-manager-item')).toHaveCount(1);
  await expect(page.locator('.tag-manager-count')).toHaveText('1');
  expect(JSON.parse((await api(page, '/messages/' + first)).tags)).toEqual([prefix + 'Combined']);
  await page.locator('#select-all-tags').check();
  await page.locator('#delete-tags').click();
  await expect(page.locator('.tag-manager-item')).toHaveCount(0);
  expect((await api(page, '/messages/' + first)).body).toBe('Local tag test body');
  expect((await api(page, '/messages/' + first)).tags).toBe('[]');
});
test('opening a tag filters all cached folders exactly, not a subject substring', async ({
  page,
}) => {
  const id = await message(page, 'Match', ['Project']);
  await api(page, '/messages/' + id, 'PATCH', { folder: 'archive' });
  await message(page, 'Project but untagged');
  await page.goto('/#/tags');
  await page.locator('#tag-search').fill(prefix);
  await page
    .getByRole('button', { name: 'Show messages tagged ' + prefix + 'Project', exact: true })
    .click();
  await expect(page.locator('.message-row')).toHaveCount(1);
  await expect(page.locator(`[data-message="${id}"]`)).toBeVisible();
  await expect(page.locator('#search-scope')).toHaveValue('all');
});
test('quick filters combine and clear, sorting and table view persist', async ({ page }) => {
  await message(page, 'Zulu', ['Blue'], true, true);
  await message(page, 'Alpha', [], false, false);
  await message(page, 'Bravo', ['Blue'], false, true);
  await page.reload();
  await page.locator('#global-search').fill(prefix.trim());
  await expect(page.locator('.message-row')).toHaveCount(3);
  await page.locator('[data-filter=unread]').click();
  await expect(page.locator('.message-row')).toHaveCount(1);
  await page.locator('[data-filter=all]').click();
  await page.locator('#quick-starred').click();
  await expect(page.locator('.message-row')).toHaveCount(2);
  await page.locator('#quick-tag-state').selectOption('untagged');
  await expect(page.locator('.message-row')).toHaveCount(0);
  await page.locator('#clear-quick-filter').click();
  await expect(page.locator('.message-row')).toHaveCount(3);
  await page.locator('#quick-sort').selectOption('subject');
  await page.locator('#quick-order').selectOption('asc');
  await expect(page.locator('.message-row .subject').first()).toContainText(prefix + 'Alpha');
  await page.locator('#quick-view').selectOption('table');
  await expect(page.locator('.message-table-header')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await expect.poll(async () => (await api(page, '/preferences')).mail_view).toBe('table');
  await page.reload();
  await expect(page.locator('#quick-view')).toHaveValue('table');
  await expect(page.locator('#quick-sort')).toHaveValue('subject');
});
test('bulk tag assignment displays colored pills and can remove them again', async ({ page }) => {
  const tagId = await tag(page, 'Color', '#ffdc60');
  const id = await message(page, 'Assign');
  await page.reload();
  await page.locator(`[data-message="${id}"] .select-message`).check();
  await page.locator('#selection-tag').selectOption(String(tagId));
  await page.locator('#add-selected-tag').click();
  await expect(page.locator(`[data-message="${id}"] .tag-pill`)).toHaveCSS(
    'background-color',
    'rgb(255, 220, 96)',
  );
  await expect(page.locator(`[data-message="${id}"] .tag-pill`)).toHaveCSS('color', 'rgb(0, 0, 0)');
  await page.locator('#selection-tag').selectOption(String(tagId));
  await page.locator('#remove-selected-tag').click();
  await expect(page.locator(`[data-message="${id}"] .tag-pill`)).toHaveCount(0);
});
test('pin keeps filters between folders and the shortcut focuses the one mail search', async ({
  page,
}) => {
  await message(page, 'Pinned', [], true, true);
  await page.reload();
  await page.locator('#quick-starred').click();
  await page.locator('#quick-pin').check();
  await page.evaluate(() => document.querySelector('#navigation [data-view=archive]').click());
  await expect(page.locator('#quick-starred')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#quick-pin').uncheck();
  await page.evaluate(() => document.querySelector('#navigation [data-view=inbox]').click());
  await expect(page.locator('#quick-starred')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#quick-filter-toggle').click();
  await expect(page.locator('#quick-filter')).not.toBeVisible();
  await page.keyboard.press('Control+Shift+K');
  await expect(page.locator('#global-search')).toBeFocused();
  await expect(page.locator('#quick-filter')).toBeVisible();
});
