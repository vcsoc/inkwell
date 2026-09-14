const { test, expect } = require('@playwright/test');
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
  await expect(page.locator('.folder-group-heading')).toHaveText('inkwell · local mail');
  await expect(server).toContainText('Outlook');
  await expect(server).not.toContainText('folder-test@example.com');
  await expect(page.locator('.folder-account-heading')).toHaveAttribute(
    'title',
    'folder-test@example.com',
  );
  await expect(server).toContainText('counts from server');
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
