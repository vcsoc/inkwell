const { test, expect } = require('@playwright/test');

test('publisher-configured Microsoft sign-in never asks for an application ID', async ({
  page,
}) => {
  await page.route('**/api/microsoft/config', (route) =>
    route.fulfill({ json: { configured: true } }),
  );
  let body;
  await page.route('**/api/microsoft/begin', (route) => {
    body = route.request().postDataJSON();
    return route.fulfill({
      json: { id: 'publisher-flow', user_code: 'TEST-CODE', expires_in: 900, interval: 300 },
    });
  });
  await page.route('**/api/microsoft/publisher-flow', (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.goto('/#/settings/mail');
  await page.getByRole('button', { name: 'Connect email' }).click();
  for (const provider of ['outlook', 'microsoft365']) {
    await page.getByLabel('Quick setup').selectOption(provider);
    await expect(page.locator('#microsoft-registration-status')).toContainText('Ready.');
    await expect(page.getByLabel('Microsoft application client ID')).not.toBeVisible();
    await expect(page.getByLabel('App password', { exact: true })).not.toBeVisible();
    await page.getByRole('button', { name: 'Sign in with Microsoft', exact: true }).click();
    await expect(page.locator('.device-code')).toHaveText('TEST-CODE');
    expect(body).toEqual({ account_type: provider === 'outlook' ? 'consumer' : 'organization' });
  }
  await page.getByLabel('Quick setup').selectOption('gmail');
  await expect(page.getByLabel('App password', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save account', exact: true })).toBeEnabled();
});

test('unconfigured builds accurately explain missing publisher registration', async ({ page }) => {
  await page.route('**/api/microsoft/config', (route) =>
    route.fulfill({ json: { configured: false } }),
  );
  await page.goto('/#/settings/mail');
  await page.getByRole('button', { name: 'Connect email' }).click();
  await page.getByLabel('Quick setup').selectOption('outlook');
  await expect(page.locator('#microsoft-registration-status')).toContainText(
    'Publisher setup incomplete',
  );
  await expect(page.getByLabel('Microsoft application client ID')).toBeVisible();
});
