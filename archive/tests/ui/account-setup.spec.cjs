const { test, expect } = require('@playwright/test');
const { settingsSection } = require('./helpers.cjs');

async function openSettings(page) {
  await page.goto('/');
  await expect(page.locator('#page-title')).toContainText('your inbox');
  if (await page.locator('.mobile-tabs').isVisible())
    await page.locator('.mobile-tabs').getByRole('button', { name: 'Settings' }).click();
  else await page.locator('#settings').click();
  await settingsSection(page, 'Mail accounts');
  await page.getByRole('button', { name: 'Connect email' }).click();
}

test('Microsoft setup uses publisher-managed website sign-in without asking for an app ID', async ({
  page,
}) => {
  await openSettings(page);
  const provider = page.getByLabel('Quick setup');
  for (const name of ['outlook', 'microsoft365']) {
    await provider.selectOption(name);
    await expect(page.getByLabel('App password', { exact: true })).not.toBeVisible();
    await expect(page.locator('#microsoft-registration-status')).toContainText('Ready.');
    await expect(page.getByLabel('Microsoft application client ID')).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Sign in with Microsoft', exact: true }),
    ).toBeEnabled();
  }
  await provider.selectOption('gmail');
  await expect(page.getByLabel('SMTP port', { exact: true })).toHaveValue('465');
  await expect(page.getByLabel('SMTP security')).toHaveValue('tls');
  await expect(page.getByRole('button', { name: 'Save account' })).toBeEnabled();
  await page.getByLabel('App password', { exact: true }).fill('an-app-password');
  await expect(page.getByLabel('App password', { exact: true })).toHaveValue('an-app-password');
});

test('Microsoft device code, pending approval and cancellation', async ({ page }) => {
  await openSettings(page);
  await page.getByLabel('Quick setup').selectOption('outlook');
  await page.route('**/api/microsoft/begin', (route) =>
    route.fulfill({
      json: {
        id: 'test-flow',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://www.microsoft.com/link',
        expires_in: 900,
        interval: 1,
      },
    }),
  );
  let polled = false,
    cancelled = false;
  await page.route('**/api/microsoft/test-flow/poll', (route) => {
    polled = true;
    return route.fulfill({ json: { status: 'pending', interval: 1 } });
  });
  await page.route('**/api/microsoft/test-flow', (route) => {
    cancelled = route.request().method() === 'DELETE';
    return route.fulfill({ json: { ok: true } });
  });
  await expect(page.getByLabel('Microsoft application client ID')).not.toBeVisible();
  await page.getByRole('button', { name: 'Sign in with Microsoft', exact: true }).click();
  await expect(page.locator('.device-code')).toHaveText('ABCD-EFGH');
  await expect(page.getByRole('link', { name: 'Open Microsoft sign-in' })).toHaveAttribute(
    'href',
    'https://www.microsoft.com/link',
  );
  await expect.poll(() => polled).toBe(true);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.locator('#discard-confirmation')).toHaveCount(0);
  await expect.poll(() => cancelled).toBe(true);
});

test('completed Microsoft sign-in imports inbox automatically and opens mail', async ({ page }) => {
  await openSettings(page);
  await page.getByLabel('Quick setup').selectOption('outlook');
  await page.route('**/api/microsoft/begin', (route) =>
    route.fulfill({
      json: {
        id: 'completed-flow',
        user_code: 'NEW-CODE',
        verification_uri: 'https://www.microsoft.com/link',
        expires_in: 900,
        interval: 0.01,
      },
    }),
  );
  await page.route('**/api/microsoft/completed-flow/poll', (route) =>
    route.fulfill({ json: { status: 'complete', email: 'person@example.com', account_id: 7 } }),
  );
  let syncCalls = 0;
  await page.route('**/api/sync', (route) => {
    syncCalls += 1;
    return route.fulfill({ json: [{ email: 'person@example.com', added: 200 }] });
  });
  await page.getByRole('button', { name: 'Sign in with Microsoft', exact: true }).click();
  await expect.poll(() => syncCalls).toBe(1);
  await expect(page.locator('#page-title')).toContainText('your inbox');
  await expect(page.locator('#toast')).toContainText('Imported 200 messages');
});

test('quick setup remains selectable after close, Escape and repeated reopen', async ({ page }) => {
  const nativeDialogs = [];
  page.on('dialog', async (dialog) => {
    nativeDialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await openSettings(page);
  for (const closeWithEscape of [false, true, false]) {
    await page.getByLabel('Quick setup').selectOption('icloud');
    await page.getByLabel('Your name').fill('Unsaved name');
    if (closeWithEscape) await page.keyboard.press('Escape');
    else await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(page.locator('#discard-confirmation')).toHaveCount(0);
    await expect(page.locator('#modal')).not.toBeVisible();
    await page.getByRole('button', { name: 'Connect email' }).click();
    await expect(page.getByLabel('Quick setup')).toHaveValue('custom');
    await page.getByLabel('Quick setup').selectOption('microsoft365');
    await expect(page.locator('#microsoft-registration-status')).toContainText('Ready.');
    await expect(page.getByLabel('Microsoft application client ID')).not.toBeVisible();
  }
  expect(nativeDialogs).toEqual([]);
});
