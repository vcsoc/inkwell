const { test, expect } = require('@playwright/test');

test('local folders inserted among Outlook siblings keep icon and name indentation', async ({
  page,
}) => {
  await page.route('**/api/accounts', (route) =>
    route.fulfill({
      json: [{ id: 851, name: 'Mailbox', email: 'test@example.org', provider: 'microsoft' }],
    }),
  );
  await page.route('**/api/sync', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/remote-folders', (route) =>
    route.fulfill({
      json: [
        {
          id: 921,
          account_id: 851,
          remote_id: 'parent',
          parent_remote_id: '',
          name: 'Parent',
          path: 'Parent',
          total_count: 0,
        },
        {
          id: 922,
          account_id: 851,
          remote_id: 'sibling',
          parent_remote_id: 'parent',
          name: 'Sibling',
          path: 'Parent / Sibling',
          total_count: 0,
        },
      ],
    }),
  );
  await page.route('**/api/local-folders', (route) =>
    route.fulfill({
      json: [
        { id: 997, name: 'Created', parent: 'remote:921', path: 'Parent / Created' },
        { id: 998, name: 'Nested', parent: 'local-997', path: 'Parent / Created / Nested' },
      ],
    }),
  );
  await page.goto('/');
  await expect(page.locator('[data-view="local-997"]')).toBeAttached();
  const positions = await page.locator('.server-folders').evaluate((root) => {
    const icon = (selector) =>
      root.querySelector(selector).querySelector('.folder-icon').getBoundingClientRect().left;
    const label = (selector) =>
      root.querySelector(selector).querySelector('.folder-name').getBoundingClientRect().left;
    return {
      remote: icon('[data-remote-folder="922"]'),
      local: icon('[data-view="local-997"]'),
      remoteName: label('[data-remote-folder="922"]'),
      localName: label('[data-view="local-997"]'),
    };
  });
  expect(Math.abs(positions.remote - positions.local)).toBeLessThanOrEqual(1);
  expect(Math.abs(positions.remoteName - positions.localName)).toBeLessThanOrEqual(1);
});
