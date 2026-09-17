const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
let id;
let otherId;
const api = (page, url, method = 'GET', body) =>
  page.evaluate(
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
const file = (key, name, inline = false) => ({
  id: key.repeat(64),
  name,
  size: 5,
  inline,
  kind: 'file',
  cached_only: false,
  downloadable: true,
  content_type: 'application/pdf',
});
const groups = () => [
  {
    key: 'root',
    subject: 'Selected subject',
    sender: 'sender@example.org',
    date: '2099-01-02T10:00:00Z',
    selected: true,
    cached_only: false,
    checked: true,
    files: [file('a', 'Report.pdf'), file('b', 'logo.png', true)],
  },
  {
    key: 'old',
    subject: 'Earlier thread message',
    sender: 'earlier@example.org',
    date: '2099-01-01T10:00:00Z',
    selected: false,
    cached_only: false,
    checked: true,
    files: [file('c', 'Earlier.pdf')],
  },
];
const state = (value = {}) => ({
  groups: [],
  connected: true,
  complete: false,
  pending: 1,
  scope: 'thread',
  error: '',
  ...value,
});
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  id = (
    await api(page, '/drafts', 'POST', {
      subject: 'Attachments ' + Date.now(),
      body: 'Mail body https://example.org/ safe text',
    })
  ).id;
  await api(page, '/messages/' + id, 'PATCH', { folder: 'inbox' });
  await page.reload();
});
test.afterEach(async ({ page }) => {
  for (const messageId of [id, otherId].filter(Boolean)) {
    await api(page, '/messages/' + messageId, 'PATCH', { folder: 'trash' });
    await api(page, '/messages/' + messageId, 'DELETE');
  }
  otherId = undefined;
});

test('top reader shows full-thread files, separate inline parts, safe downloads and retains reader permissions', async ({
  page,
}, info) => {
  let release,
    downloads = 0,
    binaryRequests = 0;
  page.on('download', () => downloads++);
  const gate = new Promise((resolve) => (release = resolve));
  await page.route(`**/api/messages/${id}/attachments`, (r) => r.fulfill({ json: state() }));
  await page.route(`**/api/messages/${id}/attachments/continue`, async (r) => {
    await gate;
    await r.fulfill({ json: state({ groups: groups(), complete: true, pending: 0 }) });
  });
  await page.route(`**/api/messages/${id}/attachments/refresh`, async (r) => {
    await gate;
    await r.fulfill({ json: state({ groups: groups().slice(0, 1) }) });
  });
  await page.route(`**/api/messages/${id}/attachments/*/download`, (r) => {
    binaryRequests++;
    return r.fulfill({ contentType: 'application/octet-stream', body: Buffer.from('%PDF!') });
  });
  await page.locator(`[data-message="${id}"] .subject`).click();
  const root = page.locator('#message-attachments');
  await expect(root).toContainText('Checking attachments');
  await page.getByRole('switch', { name: 'Enable text links', exact: true }).check();
  await expect(page.locator('.message-body a')).toHaveCount(1);
  await page.evaluate(() => (window.attachmentReader = document.querySelector('.message-body')));
  release();
  await expect(root).toContainText('Earlier.pdf');
  const counter = root.locator('[data-attachment-info]');
  await expect(counter).toHaveAttribute('title', /Earlier thread message/);
  await expect(counter).toHaveAttribute('title', /Entire Outlook conversation/);
  await expect(root).not.toContainText('Attachment check complete.');
  await expect(root).not.toContainText('Files are saved only');
  await counter.click();
  await expect(root.locator('.attachment-tooltip')).toContainText('Entire Outlook conversation');
  await page.keyboard.press('Escape');
  await expect(page.locator(`[data-message="${id}"] .message-paperclip`)).toHaveAttribute(
    'data-attachment-state',
    'yes',
  );
  await expect(page.getByRole('switch', { name: 'Enable text links', exact: true })).toBeChecked();
  expect(
    await page.evaluate(() => window.attachmentReader === document.querySelector('.message-body')),
  ).toBe(true);
  expect(
    await root.evaluate(
      (el) =>
        !!(
          el.compareDocumentPosition(document.querySelector('#message-preview')) &
          Node.DOCUMENT_POSITION_FOLLOWING
        ),
    ),
  ).toBe(true);
  expect(binaryRequests).toBe(0);
  expect(downloads).toBe(0);
  await expect(root.getByText('logo.png', { exact: true })).not.toBeVisible();
  await root.locator('summary').click();
  await expect(root.getByText('logo.png', { exact: true })).toBeVisible();
  const pending = page.waitForEvent('download');
  await root.getByRole('button', { name: 'Download Earlier.pdf', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('Earlier.pdf');
  expect(fs.readFileSync(await download.path(), 'utf8')).toBe('%PDF!');
  expect(binaryRequests).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({
    path: `test-results/${info.project.name}-thread-attachments.png`,
    fullPage: true,
  });
});

test('offline cached attachment metadata never claims there are no files', async ({ page }) => {
  const cached = groups();
  for (const g of cached)
    for (const f of g.files) {
      f.cached_only = true;
      f.downloadable = false;
    }
  await page.route(`**/api/messages/${id}/attachments`, (r) =>
    r.fulfill({
      json: state({
        groups: cached,
        connected: false,
        error: 'Account disconnected; cached metadata only.',
      }),
    }),
  );
  await page.locator(`[data-message="${id}"] .subject`).click();
  const root = page.locator('#message-attachments');
  await expect(root).toContainText('Earlier.pdf');
  await expect(root).toContainText('Account disconnected');
  await expect(root).not.toContainText('No attachments found');
  await expect(
    root.getByRole('button', { name: 'Download Report.pdf', exact: true }),
  ).toBeDisabled();
});

test('filenames are text-safe and late attachment results cannot replace another reader', async ({
  page,
}) => {
  otherId = (
    await api(page, '/drafts', 'POST', {
      subject: 'Other attachment reader',
      body: 'Other reader body',
    })
  ).id;
  await api(page, '/messages/' + otherId, 'PATCH', { folder: 'inbox' });
  await page.reload();
  const unsafe = '<img src=x onerror=alert(1)>.pdf',
    cached = groups();
  cached[0].files = [file('a', unsafe)];
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  await page.route(`**/api/messages/${id}/attachments`, (r) =>
    r.fulfill({ json: state({ groups: cached }) }),
  );
  await page.route(`**/api/messages/${id}/attachments/continue`, async (r) => {
    await gate;
    await r.fulfill({ json: state({ groups: cached, complete: true, pending: 0 }) });
  });
  try {
    await page.locator(`[data-message="${id}"] .subject`).click();
    await expect(
      page.locator('#message-attachments').getByText(unsafe, { exact: true }),
    ).toBeVisible();
    await expect(page.locator('#message-attachments img')).toHaveCount(0);
    await page.locator('#reader-back').click();
    await page.locator(`[data-message="${otherId}"] .subject`).click();
    release();
    await expect(page.locator('.message-body')).toContainText('Other reader body');
    await expect(page.locator('#message-attachments')).not.toContainText(unsafe);
    await expect(
      page.getByRole('switch', { name: 'Enable text links', exact: true }),
    ).not.toBeChecked();
  } finally {
    release();
  }
});
