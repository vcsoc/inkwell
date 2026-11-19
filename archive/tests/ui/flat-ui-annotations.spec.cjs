const { test, expect } = require('@playwright/test');
let original;
async function api(page, path, method = 'GET', body) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch('/api' + path, {
        method,
        headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw Error(await response.text());
      return response.json();
    },
    { path, method, body },
  );
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  original = await api(page, '/preferences');
  await api(page, '/demo', 'POST');
  await api(page, '/preferences', 'PUT', {
    ...original,
    layout: 'classic',
    mail_view: 'cards',
    quick_filter_visible: true,
    preview_mode: 'html',
  });
  await page.reload();
});
test.afterEach(async ({ page }) => {
  await api(page, '/preferences', 'PUT', original);
});
test('Flat message rows use only soft separators and the view icon toggles directly and persists', async ({
  page,
}, info) => {
  const row = page.locator('.message-row').first();
  await expect(row).toBeVisible();
  await expect(row).toHaveCSS('border-top-width', '0px');
  await expect(row).toHaveCSS('border-left-width', '0px');
  await expect(row).toHaveCSS('border-bottom-width', '1px');
  await expect(row).toHaveCSS('border-radius', '0px');
  const toggle = page.getByRole('button', { name: 'Card or table view', exact: true });
  await expect(toggle).toHaveAttribute('title', 'Switch to table');
  await toggle.click();
  await expect(page.locator('#message-list')).toHaveAttribute('data-mail-view', 'table');
  await expect(page.locator('#quick-filter')).toBeHidden();
  await expect(page.locator('#quick-view')).toHaveCount(0);
  await expect.poll(async () => (await api(page, '/preferences')).mail_view).toBe('table');
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveAttribute('title', 'Switch to cards');
  await toggle.click();
  await expect(page.locator('#message-list')).toHaveAttribute('data-mail-view', 'cards');
  await page.screenshot({
    path: `test-results/${info.project.name}-flat-mail.png`,
    fullPage: true,
  });
});
test('Reader pills share the title row, privacy explanation is a tooltip, and reader chrome is compact and borderless', async ({
  page,
}, info) => {
  const messages = await api(page, '/messages');
  const message = messages.find((m) => m.demo);
  await api(page, '/messages/' + message.id, 'PATCH', { flagged: true, tags: ['Flat UI'] });
  await page.reload();
  await page.locator(`[data-message="${message.id}"] .subject`).click();
  await expect(page.locator('.reader-title-row h2')).toBeVisible();
  await expect(page.locator('.reader-title-row .reader-tags')).toContainText('Flat UI');
  await expect(page.locator('.reader-title-row .flagged-pill')).toBeVisible();
  await expect(page.locator('.reader-title-row .mail-pill').first()).toHaveCSS('font-size', '10px');
  await expect(page.locator('#message-attachments')).toHaveCSS('border-top-width', '0px');
  const tools = page.locator('.reader-actions button').first();
  const height = (await tools.boundingBox()).height;
  expect(height).toBeLessThanOrEqual(info.project.name === 'mobile' ? 36 : 30);
  await page.screenshot({
    path: `test-results/${info.project.name}-flat-reader.png`,
    fullPage: true,
  });
  await api(page, '/messages/' + message.id, 'PATCH', {
    flagged: message.flagged,
    tags: JSON.parse(message.tags),
  });
});
test('HTML privacy notice keeps its safety explanation as a tooltip without a separate line', async ({
  page,
}) => {
  await page.route('**/api/messages/*/preview-info', (route) =>
    route.fulfill({ json: { origins: [], saved_origins: [], text_links: [] } }),
  );
  const messages = await api(page, '/messages');
  const message = messages.find((m) => m.demo);
  await page.route('**/api/messages/' + message.id, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ json: { ...data, html_body: '<p>Flat preview</p>' } });
  });
  await page.locator(`[data-message="${message.id}"] .subject`).click();
  await expect(page.locator('.privacy-banner')).toHaveAttribute(
    'title',
    /Loading images shares your IP/,
  );
  await expect(page.locator('.html-safety-note')).toHaveCount(0);
  await expect(page.locator('.html-message')).toHaveCSS('border-top-width', '0px');
});
