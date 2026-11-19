const { test, expect } = require('@playwright/test');
const { sidebarClick } = require('./helpers.cjs');
let account, prefix;
async function api(page, url, method = 'GET', body) {
  return page.evaluate(
    async ({ url, method, body }) => {
      const r = await fetch('/api' + url, {
        method,
        headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!r.ok) throw Error(await r.text());
      return r.json();
    },
    { url, method, body },
  );
}
test.beforeEach(async ({ page }) => {
  prefix = 'Sender' + Date.now();
  await page.route('**/api/sync', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/sync/jobs*', (r) =>
    r.fulfill({
      json: { id: 0, active: false, errors: [], revision: 0, done: 0, total: 0, added: 0 },
    }),
  );
  await page.goto('/');
  account = (
    await api(page, '/accounts', 'POST', {
      name: prefix,
      email: prefix + '@example.org',
      username: 'login@example.org',
      password: 'test-only',
      imap_host: 'example.invalid',
      smtp_host: 'example.invalid',
    })
  ).id;
  await api(page, `/accounts/${account}/senders`, 'PUT', {
    default_from: 'alias@example.org',
    additional_addresses: ['alias@example.org'],
  });
  await page.reload();
});
test.afterEach(async ({ page }) => {
  if (await page.locator('#compose-form').isVisible()) await page.locator('#close-modal').click();
  const drafts = await api(page, '/messages?folder=drafts&q=' + prefix);
  for (const d of drafts) {
    await api(page, '/messages/' + d.id, 'PATCH', { folder: 'trash' });
    await api(page, '/messages/' + d.id, 'DELETE');
  }
  await api(page, '/accounts/' + account, 'DELETE');
});
test('Default From is selected, explicit choice is submitted and a draft retains it', async ({
  page,
}) => {
  await page.locator('#heading-compose').click();
  await page.locator('#compose-form [name=account_id]').selectOption(String(account));
  const from = page.locator('#compose-form [name=from_address]');
  await expect(from).toHaveValue('alias@example.org');
  await from.selectOption(prefix + '@example.org');
  await page.locator('#compose-form [name=subject]').fill(prefix + ' draft');
  await page.locator('#compose-form [name=recipient]').fill('recipient@example.org');
  await page.locator('#close-modal').click();
  const drafts = await api(page, '/messages?folder=drafts&q=' + prefix);
  expect(drafts[0].sender).toBe(prefix + '@example.org');
  await sidebarClick(page, '#navigation [data-view=drafts]');
  await page.locator(`[data-message="${drafts[0].id}"]`).click();
  await expect(from).toHaveValue(prefix + '@example.org');
  let sent;
  await page.route('**/api/send', async (r) => {
    sent = r.request().postDataJSON();
    await r.fulfill({ json: { id: 999999 } });
  });
  await page.locator('#compose-form button[type=submit]').click();
  await expect.poll(() => sent?.from_address).toBe(prefix + '@example.org');
  await expect(page.locator('#compose-form')).not.toBeVisible();
});
test('Mail settings save a preselected default without sending or changing the account address', async ({
  page,
}) => {
  await page.goto('/#/settings/mail');
  await page.locator(`[data-sending-addresses="${account}"]`).click();
  const panel = page.locator('#sending-address-settings');
  await expect(panel.locator('[name=default_from]')).toHaveValue('alias@example.org');
  await panel.locator('[name=aliases]').fill('alias@example.org\nsecond@example.org');
  await panel.locator('[name=default_from]').selectOption('second@example.org');
  await panel.getByRole('button', { name: 'Save sending addresses', exact: true }).click();
  await expect(panel.locator('[role=status]')).toContainText('saved');
  expect((await api(page, '/accounts')).find((a) => a.id === account).email).toBe(
    prefix + '@example.org',
  );
  await sidebarClick(page, '#navigation [data-view=inbox]');
  await page.locator('#heading-compose').click();
  await page.locator('#compose-form [name=account_id]').selectOption(String(account));
  await expect(page.locator('#compose-form [name=from_address]')).toHaveValue('second@example.org');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});
