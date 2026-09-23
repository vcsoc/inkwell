const { test, expect } = require('@playwright/test');

async function api(page, path, method = 'GET', body) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch('/api' + path, {
        method,
        headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw Error(await response.text());
      return response.json();
    },
    { path, method, body },
  );
}

test('Rail bell toggles, offers scopes and persists without playing while disabled', async ({
  page,
}, info) => {
  await page.goto('/');
  const original = await api(page, '/preferences');
  try {
    if (info.project.name === 'desktop') {
      await api(page, '/preferences', 'PUT', { ...original, layout: 'classic' });
      await page.reload();
    }
    const bell =
      info.project.name === 'desktop'
        ? page.locator('#notify-bell')
        : page.locator('#notify-bell-top');
    await expect(bell).toHaveAttribute('aria-pressed', 'false');
    await bell.click();
    await expect(bell).toHaveAttribute('aria-pressed', 'true');
    await bell.click({ button: 'right' });
    await page.getByRole('menuitemradio', { name: 'For selected senders only' }).click();
    const settings = await api(page, '/mail-notifications');
    expect(settings.scope).toBe('senders');
    expect(settings.enabled).toBe(true);
    await page.reload();
    await expect(bell).toHaveAttribute('aria-pressed', 'true');
    await bell.click();
    await expect(bell).toHaveAttribute('aria-pressed', 'false');
  } finally {
    await api(page, '/mail-notifications', 'PUT', { enabled: false, scope: 'all', senders: [] });
    await api(page, '/preferences', 'PUT', original);
  }
});

test('Sender bell toggles the exact sender without opening the message', async ({ page }) => {
  await page.route('**/api/messages?*', (route) =>
    route.fulfill({
      json: {
        messages: [
          {
            id: 991,
            sender: 'Friend <friend@example.org>',
            sender_key: 'friend@example.org',
            recipient: 'you@example.org',
            subject: 'Hello',
            preview: '',
            date: new Date().toISOString(),
            folder: 'inbox',
            unread: 1,
            starred: 0,
            flagged: 0,
            tags: '[]',
            demo: 0,
          },
        ],
        total: 1,
      },
    }),
  );
  await page.goto('/');
  const button = page.locator('.message-row .sender-bell').first();
  await expect(button).toBeVisible();
  const sender = await button.getAttribute('data-sender-key');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  expect((await api(page, '/mail-notifications')).senders).toContain(sender);
  await expect(page.locator('.message-row.selected')).toHaveCount(0);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect((await api(page, '/mail-notifications')).senders).not.toContain(sender);
});

test('Sound plays once for a matching batch and not for unmatched senders or old cursors', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    let played = 0;
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      played++;
      return Promise.resolve();
    };
    let settings = {
      enabled: true,
      scope: 'senders',
      senders: ['friend@example.org'],
      latest_id: 0,
    };
    const client = async (path, options) => {
      if (path === '/mail-notifications') {
        if (options) settings = { ...settings, ...options.body };
        return settings;
      }
      const after = Number(new URLSearchParams(path.split('?')[1]).get('after_id'));
      return {
        latest_id: 3,
        messages: after
          ? []
          : [
              { sender: 'other@example.org', folders: ['inbox'] },
              { sender: 'friend@example.org', folders: ['inbox'] },
              { sender: 'friend@example.org', folders: ['local-2'] },
            ],
      };
    };
    try {
      const notifications = InkwellMailNotifications({
        api: client,
        toast() {},
        pinnedFolders: () => ['local-2'],
      });
      await notifications.initialize();
      await notifications.completed();
      await notifications.completed();
      return played;
    } finally {
      HTMLMediaElement.prototype.play = original;
    }
  });
  expect(result).toBe(1);
});
