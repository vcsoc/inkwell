const { test, expect } = require('@playwright/test');
let prefix;
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
async function showSidebar(page, target) {
  await expect(page.locator(target)).toBeAttached();
  if (!(await page.locator(target).isVisible())) await page.locator('#menu').click();
}
test.beforeEach(async ({ page }) => {
  prefix = 'Folder menu ' + Date.now();
  await page.goto('/');
  await expect(page.locator('#navigation [data-view=inbox]')).toBeAttached();
});
test.afterEach(async ({ page }) => {
  const all = await api(page, '/local-folders');
  for (const f of all.filter((f) => f.name.startsWith(prefix)).sort((a, b) => b.id - a.id))
    await api(page, '/local-folders/' + f.id, 'DELETE');
});
test('Right-click creates nested local folders under Inbox and a local folder, surviving reload', async ({
  page,
}) => {
  let parent = 'inbox';
  for (const suffix of ['Parent', 'Child']) {
    const selector = `#navigation [data-view="${parent}"]`;
    await showSidebar(page, selector);
    await page.locator(selector).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New subfolder…', exact: true }).click();
    await expect(page.locator('#subfolder-form')).toContainText('No server folders');
    await page.getByLabel('Folder name', { exact: true }).fill(prefix + ' ' + suffix);
    await page.getByRole('button', { name: 'Create subfolder', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('Local subfolder created');
    const created = (await api(page, '/local-folders')).find(
      (f) => f.name === prefix + ' ' + suffix,
    );
    expect(created.parent).toBe(parent);
    const child = `#navigation [data-local-branch="${parent}"] [data-view="local-${created.id}"]`;
    await showSidebar(page, child);
    await expect(page.locator(child)).toBeVisible();
    parent = 'local-' + created.id;
  }
  await page.reload();
  const selector = `#navigation [data-view="${parent}"]`;
  await showSidebar(page, selector);
  await page.locator(selector).click();
  await expect(page.locator('#page-title')).toContainText(prefix + ' Child');
});
test('Keyboard folder menu restores focus, rejects sibling duplicates and supports cancel', async ({
  page,
}) => {
  const selector = '#navigation [data-view=archive]';
  await showSidebar(page, selector);
  const folder = page.locator(selector);
  await folder.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu', { name: 'Folder actions', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(folder).toBeFocused();
  await api(page, '/local-folders', 'POST', { name: prefix, parent: 'archive' });
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('Enter');
  await page.getByLabel('Folder name', { exact: true }).fill(prefix);
  await page.getByRole('button', { name: 'Create subfolder', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('already has that name');
  await expect(page.getByLabel('Folder name', { exact: true })).toHaveValue(prefix);
  await page.locator('#close-modal').click();
  await expect(page.locator('#subfolder-form')).not.toBeVisible();
  expect((await api(page, '/local-folders')).filter((f) => f.name === prefix)).toHaveLength(1);
});
test('Server-folder context creates a local child and keeps the server tree outside Inbox summary', async ({
  page,
}) => {
  await api(page, '/local-folders', 'POST', { name: prefix + ' Inbox child', parent: 'inbox' });
  const local = await api(page, '/local-folders');
  await page.route('**/api/accounts', (r) =>
    r.fulfill({
      json: [{ id: 71, email: 'folders@example.com', name: 'Test', provider: 'microsoft' }],
    }),
  );
  await page.route('**/api/remote-folders', (r) =>
    r.fulfill({
      json: [
        {
          id: 72,
          account_id: 71,
          remote_id: 'remote-parent',
          parent_remote_id: '',
          name: 'Server work',
          path: 'Server work',
          total_count: 0,
        },
      ],
    }),
  );
  await page.route('**/api/sync', (r) => r.fulfill({ json: [] }));
  const writes = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') writes.push(new URL(r.url()).pathname);
  });
  await page.route('**/api/local-folders', async (r) => {
    if (r.request().method() === 'POST') {
      const body = r.request().postDataJSON();
      expect(body.parent).toBe('remote:72');
      local.push({
        id: 900000,
        name: body.name,
        parent: body.parent,
        path: 'Server work / ' + body.name,
      });
      return r.fulfill({ json: { id: 900000 } });
    }
    return r.fulfill({ json: local });
  });
  const startupSync = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/sync');
  const startupBackground = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/sync/jobs',
  );
  await page.reload();
  await startupSync;
  await startupBackground;
  writes.length = 0;
  const selector = '#navigation [data-remote-folder="72"]';
  await showSidebar(page, selector);
  await expect(page.locator('[data-local-branch="inbox"] > summary .server-folders')).toHaveCount(
    0,
  );
  await page.locator(selector).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New subfolder…' }).click();
  await page.getByLabel('Folder name', { exact: true }).fill(prefix + ' Remote child');
  await page.getByRole('button', { name: 'Create subfolder', exact: true }).click();
  await expect(page.locator('[data-folder-branch="72"] [data-view="local-900000"]')).toBeAttached();
  expect(writes).toEqual(['/api/local-folders']);
});
test('Creating a subfolder updates an open rule editor without losing its edits', async ({
  page,
}) => {
  await page.goto('/#/rules');
  await page.locator('#create-rule').click();
  await page.getByLabel('Rule name', { exact: true }).fill(prefix + ' Unsaved rule');
  await page.getByLabel('Condition 1 value', { exact: true }).fill('Keep this condition');
  const selector = '#navigation [data-view=archive]';
  await showSidebar(page, selector);
  await page.locator(selector).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New subfolder…' }).click();
  await page.getByLabel('Folder name', { exact: true }).fill(prefix + ' Destination');
  await page.getByRole('button', { name: 'Create subfolder', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Local subfolder created.');
  if (await page.locator('#sidebar').evaluate((el) => el.classList.contains('open'))) {
    await page.locator('#navigation [data-view=archive]').focus();
    await page.keyboard.press('Escape');
  }
  await page.getByLabel('Action 1 value', { exact: true }).fill(prefix + ' Destination');
  await expect(
    page
      .getByRole('listbox')
      .getByRole('option')
      .filter({ hasText: prefix + ' Destination' }),
  ).toHaveCount(1);
  await page.getByLabel('Action 1 value', { exact: true }).press('Enter');
  await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(prefix + ' Unsaved rule');
  await expect(page.getByLabel('Condition 1 value', { exact: true })).toHaveValue(
    'Keep this condition',
  );
});
test('Touch hold opens the folder menu without following the folder', async ({ page }) => {
  const selector = '#navigation [data-view=archive]';
  await showSidebar(page, selector);
  const folder = page.locator(selector),
    url = page.url();
  const box = await folder.boundingBox();
  await folder.dispatchEvent('pointerdown', {
    pointerType: 'touch',
    clientX: box.x + 20,
    clientY: box.y + 20,
  });
  await expect(page.getByRole('menu', { name: 'Folder actions', exact: true })).toBeVisible();
  await folder.dispatchEvent('pointerup', { pointerType: 'touch' });
  await folder.dispatchEvent('click');
  expect(page.url()).toBe(url);
  await page.keyboard.press('Escape');
  await expect(folder).toBeFocused();
});
