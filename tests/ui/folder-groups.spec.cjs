const { test, expect } = require('@playwright/test');
test('Pinned folder shortcuts persist, show paths and counts, and use open icons when selected', async ({
  page,
}) => {
  await page.goto('/');
  const id = await page.evaluate(async () => {
    const response = await fetch('/api/local-folders', {
      method: 'POST',
      headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Pinned test', parent: 'inbox' }),
    });
    return (await response.json()).id;
  });
  const key = 'local-' + id;
  try {
    await page.reload();
    if (await page.locator('#menu').isVisible()) await page.locator('#menu').click();
    const original = page.locator(`#navigation .nav-item[data-view="${key}"]:not(.pinned-link)`);
    await original.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Pin folder', exact: true }).click();
    const pinned = page.locator(`#navigation .pinned-link[data-view="${key}"]`);
    await expect(pinned).toContainText('Pinned test (Inbox \\ Pinned test)');
    await expect(pinned.locator('.pinned-count')).toHaveText('0');
    await pinned.click();
    await expect(pinned).toHaveClass(/active/);
    await expect(pinned.locator('.folder-open')).toHaveCSS('display', 'block');
    await expect(pinned.locator('.folder-closed')).toHaveCSS('display', 'none');
    await page.reload();
    if (await page.locator('#menu').isVisible()) await page.locator('#menu').click();
    await expect(page.locator(`#navigation .pinned-link[data-view="${key}"]`)).toBeVisible();
    await page.locator(`#navigation .pinned-link[data-view="${key}"]`).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Unpin folder', exact: true }).click();
    await expect(page.locator(`#navigation .pinned-link[data-view="${key}"]`)).toHaveCount(0);
  } finally {
    await page.evaluate(async (id) => {
      await fetch('/api/local-folders/' + id, { method: 'DELETE', headers: { 'X-Inkwell': '1' } });
    }, id);
  }
});
test('Deep Outlook folders fit the sidebar and classic app shortcuts sit above Settings', async ({
  page,
}, info) => {
  await page.route('**/api/accounts', (r) =>
    r.fulfill({
      json: [{ id: 850, name: 'Nested', provider: 'microsoft', email: 'nested@example.org' }],
    }),
  );
  await page.route('**/api/sync', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/remote-folders', (r) =>
    r.fulfill({
      json: Array.from({ length: 24 }, (_, i) => ({
        id: 900 + i,
        account_id: 850,
        remote_id: 'f' + i,
        parent_remote_id: i ? 'f' + (i - 1) : '',
        name: 'A long folder name at level ' + i,
        path: 'Nested / ' + i,
        unread_count: 23,
        total_count: 50,
      })),
    }),
  );
  await page.goto('/');
  const original = await page.evaluate(async () => await (await fetch('/api/preferences')).json());
  const prefs = (value) =>
    page.evaluate(async (value) => {
      await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
    }, value);
  try {
    await prefs({ ...original, layout: 'classic' });
    await page.reload();
    await expect(page.locator('[data-remote-folder="911"]')).toBeAttached();
    if (await page.locator('#menu').isVisible()) await page.locator('#menu').click();
    await expect(page.locator('#navigation')).not.toContainText('Cached views');
    await expect(page.locator('#navigation')).not.toContainText('Local folders · top level');
    await expect(page.locator('#navigation')).not.toContainText('inkwell · local mail');
    const brand = await page.locator('.sidebar .brand').boundingBox();
    await page.locator('#navigation').evaluate((e) => (e.scrollTop = e.scrollHeight));
    await expect(page.locator('.sidebar .brand')).toBeInViewport();
    expect((await page.locator('.sidebar .brand').boundingBox()).y).toBe(brand.y);
    const overflow = await page.locator('.sidebar').evaluate((e) => ({
      width: e.scrollWidth,
      client: e.clientWidth,
      children: [...e.children].map((c) => ({
        id: c.id,
        class: c.className,
        right: c.getBoundingClientRect().right,
        parent: e.getBoundingClientRect().right,
        width: c.scrollWidth,
      })),
    }));
    expect(overflow.width, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.client + 1);
    await page.locator('#navigation').evaluate((e) => (e.scrollTop = 0));
    const geometry = await page.locator('.server-folders').evaluate((group) => {
      const box = group.getBoundingClientRect();
      return [...group.querySelectorAll('.remote-folder')].map((row) => {
        const r = row.getBoundingClientRect(),
          label = row.querySelector('.folder-name').getBoundingClientRect();
        return {
          fits: r.left >= box.left && r.right <= box.right + 1,
          width: label.width,
          left: label.left,
        };
      });
    });
    expect(geometry.every((r) => r.fits && r.width > 40)).toBe(true);
    expect(geometry[1].left).toBeGreaterThan(geometry[0].left);
    if (info.project.name === 'desktop') {
      const rail = page.locator('.app-rail');
      const rules = rail.getByRole('button', { name: 'Rule Manager', exact: true }),
        tags = rail.getByRole('button', { name: 'Tag Manager', exact: true }),
        settings = rail.getByRole('button', { name: 'Settings', exact: true });
      expect((await rules.boundingBox()).y).toBeLessThan((await tags.boundingBox()).y);
      expect((await tags.boundingBox()).y).toBeLessThan((await settings.boundingBox()).y);
      await rules.click();
      await expect(page.locator('#page-title')).toContainText('rule manager');
      await tags.click();
      await expect(page.locator('#page-title')).toContainText('tag manager');
    }
  } finally {
    await prefs(original);
  }
});
test('Local Inbox and editable Drafts are above a clearly labelled Outlook tree', async ({
  page,
}, info) => {
  await page.route('**/api/accounts', (r) =>
    r.fulfill({
      json: [
        { id: 801, provider: 'microsoft', name: 'Folder test', email: 'folder-test@example.com' },
      ],
    }),
  );
  await page.route('**/api/sync', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/remote-folders', (r) =>
    r.fulfill({
      json: [
        {
          id: 802,
          account_id: 801,
          remote_id: 'inbox-id',
          parent_remote_id: '',
          name: 'Inbox',
          path: 'Inbox',
          well_known: 'inbox',
          total_count: 100,
          unread_count: 20,
        },
        {
          id: 803,
          account_id: 801,
          remote_id: 'drafts-id',
          parent_remote_id: '',
          name: 'Drafts',
          path: 'Drafts',
          well_known: 'drafts',
          total_count: 1,
          unread_count: 0,
        },
      ],
    }),
  );
  await page.goto('/');
  await expect(page.locator('[data-remote-folder="802"]')).toBeAttached();
  if (await page.locator('#menu').isVisible()) await page.locator('#menu').click();
  const localDraft = page.locator('#navigation [data-view=drafts]'),
    server = page.locator('.server-folders');
  await expect(page.locator('.folder-group-heading')).toHaveCount(0);
  await expect(server).toContainText('Outlook');
  await expect(server).not.toContainText('folder-test@example.com');
  await expect(page.locator('.folder-account-heading')).toHaveAttribute(
    'title',
    'folder-test@example.com',
  );
  await expect(server).not.toContainText('counts from server');
  await expect(localDraft).toHaveAttribute('title', 'Editable drafts saved locally in inkwell');
  const localBox = await localDraft.boundingBox(),
    remoteBox = await page.locator('[data-remote-folder="802"]').boundingBox();
  expect(localBox.y).toBeLessThan(remoteBox.y);
  await page.screenshot({
    path: 'test-results/' + info.project.name + '-separate-folder-groups.png',
  });
  await page.locator('.folder-account-heading').click();
  await expect(page.locator('[data-remote-folder="803"]')).not.toBeVisible();
  await expect(localDraft).toBeVisible();
});
