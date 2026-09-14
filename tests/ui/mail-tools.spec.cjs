const { test, expect } = require('@playwright/test');
const { selectEmailMenuAction } = require('./helpers.cjs');

async function demo(page) {
  await page.goto('/');
  await page.evaluate(() => fetch('/api/demo', { method: 'POST', headers: { 'X-Inkwell': '1' } }));
  await page.reload();
  await expect(page.locator('.message-row').first()).toBeVisible();
}
async function menu(page, id) {
  await page.locator(`[data-message="${id}"] [data-more]`).click();
}

test('activity strip accounts for overlapping requests and clears after failure', async ({
  page,
}) => {
  await demo(page);
  const waiting = [];
  await page.route('**/api/messages?**', (route) => {
    waiting.push(route);
  });
  await page.getByRole('searchbox', { name: 'Search email', exact: true }).fill('first');
  await page.getByRole('button', { name: 'Run email search' }).click();
  await expect.poll(() => waiting.length).toBe(1);
  await expect(page.locator('#mail-activity')).toHaveCSS('opacity', '1');
  await page.getByRole('searchbox', { name: 'Search email', exact: true }).fill('second');
  await page.getByRole('button', { name: 'Run email search' }).click();
  await expect.poll(() => waiting.length).toBe(2);
  await waiting[0].fulfill({ json: [] });
  await expect(page.locator('#mail-activity')).toHaveCSS('opacity', '1');
  await waiting[1].fulfill({ status: 503, json: { detail: 'Test network failure' } });
  await expect(page.locator('#toast')).toContainText('Test network failure');
  await expect(page.locator('#mail-activity')).toHaveCSS('opacity', '0');
});

test('server hierarchy, deep links and top search scopes work on desktop and mobile', async ({
  page,
}) => {
  const account = {
    id: 771,
    name: 'Folder test',
    email: 'folders@example.com',
    provider: 'microsoft',
  };
  const folders = [
    {
      id: 810,
      account_id: 771,
      remote_id: 'root',
      parent_remote_id: '',
      name: 'Inbox',
      path: 'Server Inbox',
      well_known: 'inbox',
      total_count: 10,
      unread_count: 2,
    },
    {
      id: 811,
      account_id: 771,
      remote_id: 'child',
      parent_remote_id: 'root',
      name: 'Projects <test>',
      path: 'Inbox / Projects <test>',
      total_count: 7,
      unread_count: 1,
    },
  ];
  await page.route('**/api/accounts', (r) => r.fulfill({ json: [account] }));
  await page.route('**/api/remote-folders', (r) => r.fulfill({ json: folders }));
  await page.route('**/api/remote-folders/*/sync', (r) => r.fulfill({ json: { added: 0 } }));
  await page.route('**/api/sync', (r) => r.fulfill({ json: [] }));
  const urls = [];
  await page.route('**/api/messages?**', (r) => {
    urls.push(new URL(r.request().url()));
    return r.fulfill({ json: [] });
  });
  await page.goto('/#/remote/810');
  await expect(page.locator('#page-title')).toHaveText('Inbox.');
  if (await page.locator('#menu').isVisible()) await page.locator('#menu').click();
  const child = page
    .locator('#navigation')
    .getByRole('button', { name: 'Inbox / Projects <test>', exact: true });
  await expect(child).toBeVisible();
  await expect(page.locator('.folder-children')).toContainText('Projects <test>');
  await child.click();
  await expect(page).toHaveURL(/#\/remote\/811$/);
  await expect(page.locator('#page-title')).toHaveText('Projects <test>.');
  for (const scope of ['folder', 'subfolders', 'all']) {
    await page.getByRole('searchbox', { name: 'Search email', exact: true }).fill('needle');
    await page.getByLabel('Search scope', { exact: true }).selectOption(scope);
    await page.getByRole('button', { name: 'Run email search' }).click();
    await expect.poll(() => urls.at(-1)?.searchParams.get('scope')).toBe(scope);
    expect(urls.at(-1).searchParams.get('remote_folder_id')).toBe('811');
    expect(urls.at(-1).searchParams.get('q')).toBe('needle');
  }
  await page.reload();
  await expect(page.locator('#page-title')).toHaveText('Projects <test>.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('message menu supports reply, forward, address and text export without sending', async ({
  page,
}) => {
  await demo(page);
  const id = await page.locator('.message-row').first().getAttribute('data-message');
  for (const action of ['Reply', 'Forward']) {
    await menu(page, id);
    await selectEmailMenuAction(page, action);
    await expect(page.locator('#compose-form')).toBeVisible();
    await expect(page.locator('#compose-form input[name=subject]')).toHaveValue(
      action === 'Reply' ? /^Re:/ : /^Fwd:/,
    );
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(page.locator('#modal')).not.toBeVisible();
  }
  await menu(page, id);
  await selectEmailMenuAction(page, 'Copy sender address…');
  await expect(page.getByRole('textbox', { name: 'Sender address', exact: true })).toHaveAttribute(
    'readonly',
    '',
  );
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await menu(page, id);
  const download = page.waitForEvent('download');
  await selectEmailMenuAction(page, 'Save message as text…');
  expect((await download).suggestedFilename()).toBe(`inkwell-message-${id}.txt`);
});

test('local menu state and move actions work and preserve originals on cleanup', async ({
  page,
}) => {
  await demo(page);
  const id = await page.locator('.message-row').first().getAttribute('data-message');
  const original = await page.evaluate(
    async (id) => (await fetch('/api/messages/' + id)).json(),
    id,
  );
  try {
    for (const action of [
      'Mark read (local)',
      'Mark unread (local)',
      'Star (local)',
      'Remove star (local)',
    ]) {
      await menu(page, id);
      const patched = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/messages/' + id) && response.request().method() === 'PATCH',
      );
      await selectEmailMenuAction(page, action);
      await patched;
      await expect(page.locator('#toast')).toContainText('Server mail is unchanged');
      const message = await page.evaluate(
        async (id) => (await fetch('/api/messages/' + id)).json(),
        id,
      );
      if (action === 'Mark read (local)') expect(message.unread).toBe(0);
      if (action === 'Mark unread (local)') expect(message.unread).toBe(1);
      if (action === 'Star (local)') expect(message.starred).toBe(1);
      if (action === 'Remove star (local)') expect(message.starred).toBe(0);
    }
    await menu(page, id);
    await selectEmailMenuAction(page, 'Move local copy…');
    await page.getByLabel('Local destination').selectOption('archive');
    await page.getByRole('button', { name: 'Move local copy', exact: true }).click();
    await expect(page.locator(`[data-message="${id}"]`)).toHaveCount(0);
  } finally {
    await page.evaluate(
      ({ id, original }) =>
        fetch('/api/messages/' + id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-Inkwell': '1' },
          body: JSON.stringify({
            folder: original.folder,
            unread: !!original.unread,
            starred: !!original.starred,
          }),
        }),
      { id, original },
    );
  }
});
