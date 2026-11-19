const { test, expect } = require('@playwright/test');

const snapshot = (active) => ({
  id: 1,
  revision: active ? 1 : 2,
  active,
  done: 35,
  total: 35,
  added: 0,
  errors: [],
  pending: 0,
});

test('sync completion clears the logo and footer while a workspace refresh is stalled', async ({
  page,
}) => {
  const heldCounts = [];
  let posts = 0;
  await page.clock.install();
  await page.route('**/api/accounts', (route) =>
    route.fulfill({ json: [{ id: 42, email: 'example@example.test', provider: 'microsoft' }] }),
  );
  await page.route('**/api/sync', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/counts', (route) => {
    if (posts) heldCounts.push(route);
    else return route.continue();
  });
  await page.route('**/api/sync/jobs', (route) => {
    if (route.request().method() === 'POST') {
      posts++;
      return route.fulfill({ json: snapshot(true) });
    }
    return route.fulfill({ json: snapshot(false) });
  });
  await page.goto('/');
  await expect(page.locator('#sync-progress')).toContainText('35/35 folders');
  await expect(page.locator('html')).toHaveAttribute('data-syncing', 'true');
  await expect.poll(() => heldCounts.length).toBeGreaterThan(0);
  await page.clock.fastForward(2200);
  await expect(page.locator('html')).toHaveAttribute('data-syncing', 'false');
  await expect(page.locator('#sync-progress')).toBeHidden();
  expect(posts).toBe(1);
  await Promise.all(heldCounts.map((route) => route.continue()));
});

test('a stalled folder load times out and can be retried without reloading Inkwell', async ({
  page,
}) => {
  let requests = 0;
  await page.addInitScript(() => {
    const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = (ms) => {
      if (ms !== 25000) return nativeTimeout(ms);
      const controller = new AbortController();
      window.addEventListener(
        'trigger-mail-timeout',
        () => {
          controller.abort(new DOMException('Test timeout', 'TimeoutError'));
        },
        { once: true },
      );
      return controller.signal;
    };
  });
  await page.route('**/api/messages?*', (route) => {
    if (new URL(route.request().url()).searchParams.get('folder') !== 'archive')
      return route.continue();
    if (++requests > 1) return route.fulfill({ json: { messages: [], total: 0 } });
  });
  await page.goto('/');
  await expect(page.locator('#message-list')).toBeVisible();
  await page.evaluate(() => (location.hash = '#/archive'));
  await expect.poll(() => requests).toBe(1);
  // Trigger the signal without waiting for the real 25-second deadline.
  await page.evaluate(() => window.dispatchEvent(new Event('trigger-mail-timeout')));
  await expect(page.getByRole('heading', { name: 'Could not load mail' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('#message-list')).toBeVisible();
  await expect.poll(() => requests).toBe(2);
});
