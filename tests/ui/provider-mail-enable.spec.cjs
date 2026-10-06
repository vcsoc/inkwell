const { test, expect } = require('@playwright/test');

test('Enable server changes turns off an explicit local-only choice only after Microsoft consent', async ({
  page,
}) => {
  let enabled = false;
  let consent = false;
  await page.route('**/api/accounts', (route) =>
    route.fulfill({
      json: [{ id: 52, name: 'Test', email: 'test@example.com', provider: 'microsoft' }],
    }),
  );
  await page.route('**/api/provider-sync', (route) => {
    if (route.request().method() === 'PUT') {
      expect(consent).toBe(true);
      expect(route.request().postDataJSON()).toEqual({ local_changes_only: false });
      enabled = true;
    }
    return route.fulfill({
      json: {
        local_changes_only: !enabled,
        explicit_local_only: !enabled,
        authorization_required: consent ? 0 : 1,
        pending: 0,
        failed: 0,
        cancelled: 0,
        completed: 0,
        accounts: [{ id: 52, provider: 'microsoft', ready: consent }],
      },
    });
  });
  await page.route('**/api/microsoft/config', (route) =>
    route.fulfill({ json: { configured: true } }),
  );
  await page.route('**/api/microsoft/begin', (route) =>
    route.fulfill({
      json: {
        id: 'consent',
        user_code: 'TEST',
        verification_uri: 'https://microsoft.com/devicelogin',
        interval: 1,
        expires_in: 900,
      },
    }),
  );
  await page.route('**/api/microsoft/consent/poll', (route) => {
    consent = true;
    return route.fulfill({
      json: { status: 'complete', reauthorized: true, email: 'test@example.com' },
    });
  });
  await page.route('**/api/microsoft/consent', (route) => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/sync', (route) => route.fulfill({ json: [] }));
  await page.goto('/#/settings/mail');
  await expect(page.getByRole('checkbox', { name: /Local changes only/ })).toBeChecked();
  await page.getByRole('button', { name: 'Enable server changes', exact: true }).click();
  expect(enabled).toBe(false);
  await page.getByRole('button', { name: 'Reauthorize Microsoft', exact: true }).click();
  await expect.poll(() => enabled).toBe(true);
});
