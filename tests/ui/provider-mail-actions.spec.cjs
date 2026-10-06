const { test, expect } = require('@playwright/test');
const { selectEmailMenuAction } = require('./helpers.cjs');

const readonly = {
  local_changes_only: true,
  explicit_local_only: false,
  authorization_required: 1,
  calendar_account_id: null,
  completed: 0,
  pending: 0,
  failed: 0,
  cancelled: 0,
  last_error: '',
  accounts: [{ id: 42, email: 'test@example.com', provider: 'microsoft', ready: false }],
};

test('read-only Microsoft access is visible and Enable server changes opens same-account consent', async ({
  page,
}) => {
  await page.route('**/api/provider-sync', (route) => route.fulfill({ json: readonly }));
  await page.route('**/api/accounts', (route) =>
    route.fulfill({
      json: [{ id: 42, name: 'Test mailbox', email: 'test@example.com', provider: 'microsoft' }],
    }),
  );
  await page.route('**/api/microsoft/config', (route) =>
    route.fulfill({ json: { configured: true } }),
  );
  await page.route('**/api/microsoft/begin', (route) => {
    expect(route.request().postDataJSON().account_id).toBe(42);
    return route.fulfill({
      json: {
        id: 'test-consent',
        user_code: 'TEST-CODE',
        verification_uri: 'https://microsoft.com/devicelogin',
        interval: 30,
        expires_in: 900,
      },
    });
  });
  await page.route('**/api/microsoft/test-consent/poll', (route) =>
    route.fulfill({ json: { status: 'pending', interval: 30 } }),
  );
  await page.route('**/api/microsoft/test-consent', (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.goto('/#/settings/mail');
  await expect(page.locator('#provider-write-progress')).toContainText('write access');
  await expect(page.locator('#provider-write-progress a')).toHaveAttribute(
    'href',
    '#/settings/mail',
  );
  await expect(page.locator('#provider-sync-settings')).toContainText(
    'blocked until authorization',
  );
  await page.getByRole('button', { name: 'Enable server changes', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Reauthorize Microsoft', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reauthorize Microsoft', exact: true }).click();
  await expect(page.locator('#microsoft-progress')).toContainText('TEST-CODE');
});

test('mail filing confirms queued server writes rather than claiming server mail is unchanged', async ({
  page,
}) => {
  const message = {
    id: 9042,
    sender: 'test@example.com',
    recipient: 'me@example.com',
    subject: 'Server filing fixture',
    preview: 'Message preview',
    body: 'Message body',
    date: '2099-01-01T12:00:00Z',
    folder: 'inbox',
    unread: 0,
    starred: 0,
    flagged: 0,
    tags: [],
    account_id: 42,
    remote_id: 'server-message',
  };
  await page.route('**/api/messages?*', (route) =>
    route.fulfill({ json: { total: 1, messages: [message] } }),
  );
  await page.route('**/api/messages/9042', (route) => route.fulfill({ json: message }));
  await page.goto('/');
  await expect(page.locator('.message-row').first()).toBeVisible();
  await page.route('**/api/messages/move', (route) =>
    route.fulfill({ json: { moved: 1, provider_queued: 1 } }),
  );
  await page.locator('.message-row [data-more]').first().click();
  await selectEmailMenuAction(page, 'Move email…');
  await page.getByLabel('Destination', { exact: true }).selectOption('archive');
  await page.getByRole('button', { name: 'Move email', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('queued for server sync');
  await expect(page.locator('#toast')).not.toContainText('Server mail is unchanged');
});
