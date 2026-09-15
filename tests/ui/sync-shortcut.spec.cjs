const { test, expect } = require('@playwright/test');
let calls, hold, queued, fail;
test.beforeEach(async ({ page }) => {
  calls = [];
  hold = false;
  queued = [];
  fail = false;
  await page.route('**/api/accounts', (r) =>
    r.fulfill({
      json: [{ id: 990, email: 'sync@example.org', name: 'Sync test', provider: 'microsoft' }],
    }),
  );
  await page.route('**/api/remote-folders', (r) =>
    r.fulfill({
      json: [
        {
          id: 991,
          account_id: 990,
          remote_id: 'folder',
          parent_remote_id: '',
          name: 'Shortcut folder',
          path: 'Shortcut folder',
        },
      ],
    }),
  );
  await page.route(/\/api\/(sync|remote-folders\/991\/sync)$/, (r) => {
    calls.push(r.request().url());
    if (hold) {
      queued.push(r);
      return;
    }
    return r.fulfill(
      fail
        ? { status: 503, json: { detail: 'Temporary sync failure' } }
        : {
            json: r.request().url().endsWith('/api/sync')
              ? [{ email: 'sync@example.org', added: 0 }]
              : { added: 0 },
          },
    );
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-busy', 'false');
  calls = [];
});
test('F9 triggers a fresh sync, ignores repeats and overlap, and recovers after errors', async ({
  page,
}) => {
  hold = true;
  await page.getByRole('searchbox', { name: 'Search email', exact: true }).focus();
  await page.keyboard.press('F9');
  await expect.poll(() => calls.length).toBe(1);
  await expect(page.locator('#sync')).toBeDisabled();
  await page.keyboard.press('F9');
  await page.evaluate(() =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F9', repeat: true, bubbles: true }),
    ),
  );
  expect(calls).toHaveLength(1);
  hold = false;
  await queued.pop().fulfill({ json: [{ email: 'sync@example.org', added: 1 }] });
  await expect(page.locator('#sync')).toBeEnabled();
  fail = true;
  await page.keyboard.press('F9');
  await expect(page.locator('#toast')).toContainText('Temporary sync failure');
  await expect(page.locator('#sync')).toBeEnabled();
  fail = false;
  await page.keyboard.press('F9');
  await expect.poll(() => calls.length).toBe(3);
  await expect(page.locator('#sync')).toBeEnabled();
  await page.keyboard.press('Control+F9');
  expect(calls).toHaveLength(3);
});
test('F9 uses the open server folder rather than an unrelated inbox', async ({ page }) => {
  await page.goto('/#/remote/991');
  await expect(page.locator('#page-title')).toContainText('Shortcut folder');
  await expect(page.locator('html')).toHaveAttribute('data-busy', 'false');
  calls = [];
  await page.keyboard.press('F9');
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toContain('/remote-folders/991/sync');
  await expect(page.locator('#sync')).toBeEnabled();
});
test('F9 works while typing without closing or replacing a draft', async ({ page }) => {
  await page.keyboard.press('c');
  await page.locator('#compose-form [name=account_id]').selectOption('');
  const subject = page.locator('#compose-form [name=subject]');
  await subject.fill('F9 draft safety');
  await subject.press('F9');
  await expect.poll(() => calls.length).toBe(1);
  await expect(page.locator('#sync')).toBeEnabled();
  await expect(subject).toHaveValue('F9 draft safety');
  await expect(subject).toBeFocused();
  await page.locator('#delete-draft').click();
  await expect(page.locator('#compose-form')).not.toBeVisible();
});
test('A delayed F9 cannot replace a newly opened settings page', async ({ page }) => {
  hold = true;
  await page.keyboard.press('F9');
  await expect.poll(() => queued.length).toBe(1);
  await page.evaluate(() => (location.hash = '/settings/layout'));
  await expect(page.locator('#page-title')).toContainText('Layout');
  hold = false;
  await queued.pop().fulfill({ json: [{ email: 'sync@example.org', added: 0 }] });
  await expect(page.locator('#sync')).toBeEnabled();
  await expect(page.locator('#page-title')).toContainText('Layout');
});
