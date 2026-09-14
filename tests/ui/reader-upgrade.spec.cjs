const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
let original, id;
async function request(page, url, method = 'GET', body) {
  return page.evaluate(
    async ({ url, method, body }) =>
      (
        await fetch('/api' + url, {
          method,
          headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
      ).json(),
    { url, method, body },
  );
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  original = await request(page, '/preferences');
  await request(page, '/preferences', 'PUT', {
    ...original,
    layout: 'classic',
    form_mode: 'popup',
    preview_mode: 'html',
    sidebar_width: 260,
    message_list_width: 380,
    ui_zoom: 100,
  });
  if (!process.env.INKWELL_UI_DATA?.startsWith(path.join(os.tmpdir(), 'inkwell-ui-')))
    throw Error('Refusing to seed a non-test workspace');
  id = Number(
    execFileSync(
      'uv',
      [
        'run',
        'python',
        '-c',
        `
from inkwell import store
with store.db() as db:
 c=db.execute("INSERT INTO messages(sender,recipient,subject,body,html_body,date,unread) VALUES (?,?,?,?,?,?,1)", ('Alex <alex@example.org>','me@example.org','Secure HTML fixture','Safe text alternative.','<h1>Safe HTML fixture</h1><p style=\"color:red\">Readable formatting</p><script>top.compromised=true</script><img src=\"https://images.example.org/pixel.png\" onerror=\"top.compromised=true\"><iframe src=\"https://evil.example/frame\"></iframe><a href=\"https://evil.example/link\">Disabled navigation</a><div style=\"background-image:url(https://evil.example/css)\">No CSS tracking</div>', '2099-01-01T12:00:00+00:00'))
 print(c.lastrowid)
`,
      ],
      {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, INKWELL_DATA_DIR: process.env.INKWELL_UI_DATA },
      },
    ).trim(),
  );
  await page.reload();
  await expect(page.locator(`[data-message="${id}"]`)).toBeVisible();
});
test.afterEach(async ({ page }) => {
  if (id) {
    await request(page, '/messages/' + id, 'PATCH', { folder: 'trash' });
    expect(await request(page, '/messages/' + id, 'DELETE')).toEqual({ ok: true });
  }
  if (original) await request(page, '/preferences', 'PUT', original);
});

test('HTML is sandboxed, no remote fetch until explicit permission, and reopening blocks again', async ({
  page,
}) => {
  const requests = [],
    requestHeaders = [];
  await page.route('https://**/*', (route) => {
    requests.push(route.request().url());
    requestHeaders.push(route.request().headers());
    return route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8ZkAAAAASUVORK5CYII=',
        'base64',
      ),
    });
  });
  await page.locator(`[data-message="${id}"]`).click();
  const frame = page.frameLocator('.html-message');
  await expect(frame.getByRole('heading', { name: 'Safe HTML fixture' })).toBeVisible();
  await expect(page.locator('.html-message')).toHaveAttribute('sandbox', '');
  await expect(frame.locator('script,iframe,form,[href],[src]')).toHaveCount(0);
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => window.compromised)).toBeUndefined();
  await page.getByLabel('Remote content options').selectOption('all');
  await expect(page.locator('#confirm-yes')).toHaveCount(0);
  await expect.poll(() => requests.length).toBe(1);
  expect(requests).toEqual(['https://images.example.org/pixel.png']);
  expect(requestHeaders[0].referer).toBeUndefined();
  await page.getByLabel('Remote content options').selectOption('block');
  await expect(frame.locator('img[src]')).toHaveCount(0);
  await page.getByLabel('Remote content options').selectOption('origin-0');
  await expect.poll(() => requests.length).toBe(2);
  await page.reload();
  await page.locator(`[data-message="${id}"]`).click();
  await expect(frame.getByRole('heading', { name: 'Safe HTML fixture' })).toBeVisible();
  expect(requests.length).toBe(2);
  await page.screenshot({
    path: 'test-results/' + test.info().project.name + '-secure-html.png',
    fullPage: true,
  });
});

test('unread and editable reusable tags appear as pills; text preview preference persists', async ({
  page,
}) => {
  const row = page.locator(`[data-message="${id}"]`);
  await expect(row.locator('.unread-pill')).toHaveText('Unread');
  await row.click();
  await page.getByRole('button', { name: 'Tags…', exact: true }).click();
  await page.getByLabel('Tags (comma-separated)').fill('Project, Follow up');
  await page.getByRole('button', { name: 'Save tags', exact: true }).click();
  await expect(page.locator('#reader .tag-pill')).toHaveText(['Project', 'Follow up']);
  await page.getByRole('button', { name: 'Tags…', exact: true }).click();
  await page.getByLabel('Tags (comma-separated)').fill('');
  await page
    .getByRole('group', { name: 'Existing tags' })
    .getByRole('button', { name: 'Project', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Existing tags' })
    .getByRole('button', { name: 'Follow up', exact: true })
    .click();
  await expect(page.getByLabel('Tags (comma-separated)')).toHaveValue('Project, Follow up');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await page.getByRole('button', { name: 'Back to messages' }).click();
  await expect(row.locator('.tag-pill')).toHaveText(['Project', 'Follow up']);
  await expect(row.locator('.unread-pill')).toHaveCount(0);
  await page.goto('/#/settings/forms');
  await page.getByLabel('Email preview format').selectOption('text');
  await page.getByRole('button', { name: 'Save form preference' }).click();
  await expect(page.locator('#toast')).toContainText('saved');
  await page.reload();
  await expect(page.getByLabel('Email preview format')).toHaveValue('text');
  await page.goto('/#/inbox');
  await row.click();
  await expect(page.locator('.html-message')).toHaveCount(0);
  await expect(page.locator('.message-body')).toHaveText('Safe text alternative.');
  await expect(page.locator('#reader .tag-pill')).toHaveText(['Project', 'Follow up']);
});

test('pane widths resize by pointer and keyboard and persist; Ctrl zoom resets', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  const sidebar = page.getByRole('separator', { name: 'Resize folder sidebar' });
  await sidebar.focus();
  await sidebar.press('ArrowRight');
  await expect(page.locator('#sidebar')).toHaveCSS('width', '270px');
  const grip = page.getByRole('separator', { name: 'Resize message list' });
  const box = await grip.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + 30);
  await page.mouse.up();
  await expect(page.locator('#message-list')).toHaveCSS('width', '440px');
  await expect.poll(async () => (await request(page, '/preferences')).message_list_width).toBe(440);
  await page.reload();
  await expect(page.locator('#sidebar')).toHaveCSS('width', '270px');
  await expect(page.locator('#message-list')).toHaveCSS('width', '440px');
  await page.keyboard.press('Control+=');
  await expect(page.locator('html')).toHaveCSS('zoom', '1.1');
  expect((await page.locator('#sidebar').boundingBox()).height).toBeLessThanOrEqual(1000.5);
  await page.setViewportSize({ width: 800, height: 1000 });
  await expect(page.locator('#sidebar')).not.toBeVisible();
  await expect(page.locator('.mobile-tabs')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.locator(`[data-message="${id}"] [data-more]`).click();
  const menu = await page.locator('#message-menu').boundingBox();
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(1500);
  expect(menu.y + menu.height).toBeLessThanOrEqual(1000);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+-');
  await expect(page.locator('html')).toHaveCSS('zoom', '1');
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+0');
  await expect(page.locator('html')).toHaveCSS('zoom', '1');
  await expect.poll(async () => (await request(page, '/preferences')).ui_zoom).toBe(100);
});

test('Theme Studio sample previews colors and sidebar fonts without saving', async ({ page }) => {
  await page.goto('/#/settings/theme');
  const preview = page.getByRole('region', { name: 'Live theme preview' });
  await expect(preview).toBeVisible();
  if (page.viewportSize().width >= 1440) {
    const panel = await preview.boundingBox(),
      editor = await page.locator('#settings-theme').boundingBox();
    expect(panel.x).toBeGreaterThan(editor.x + editor.width - 1);
  }
  await page.getByLabel('Sidebar text size', { exact: true }).fill('20');
  await expect(preview.locator('.theme-sample-sidebar')).toHaveCSS('font-size', '20px');
  await page.getByLabel('Accent color', { exact: true }).fill('#123456');
  await expect(preview.locator('.unread-pill').first()).toHaveCSS(
    'background-color',
    'rgb(18, 52, 86)',
  );
  expect((await request(page, '/preferences')).theme.accent).toBe(original.theme.accent);
  await page.getByRole('button', { name: 'Revert preview' }).click();
  await expect(page.getByLabel('Accent color', { exact: true })).toHaveValue(original.theme.accent);
  await page.screenshot({
    path: 'test-results/' + test.info().project.name + '-live-theme.png',
    fullPage: true,
  });
});

test('Reader toolbar uses compact SVG controls with working star, move and sender actions', async ({
  page,
}, info) => {
  await page.locator(`[data-message="${id}"]`).click();
  const toolbar = page.getByRole('group', { name: 'Email actions', exact: true });
  await expect(toolbar.locator('button')).toHaveCount(14);
  await expect(toolbar.locator('button svg')).toHaveCount(14);
  const size = await toolbar
    .locator('button')
    .first()
    .evaluate((b) => parseFloat(getComputedStyle(b).fontSize));
  expect(size).toBeLessThan(16);
  await toolbar.getByRole('button', { name: 'Star message', exact: true }).click();
  await expect(
    toolbar.getByRole('button', { name: 'Unstar message', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect((await request(page, '/messages/' + id)).starred).toBe(1);
  await toolbar.getByRole('button', { name: 'Copy sender address', exact: true }).click();
  await expect(page.locator('#modal-body input')).toHaveValue('alex@example.org');
  await page.locator('#close-modal').click();
  await toolbar.getByRole('button', { name: 'Add sender to contacts', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('alex@example.org');
  await page.locator('#close-modal').click();
  const box = await toolbar.boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({
    path: 'test-results/' + info.project.name + '-reader-toolbar.png',
    fullPage: true,
  });
  await toolbar.getByRole('button', { name: 'Move local copy', exact: true }).click();
  await page.locator('#move-local-form select').selectOption('archive');
  await page.locator('#move-local-form button[type=submit]').click();
  await expect.poll(async () => (await request(page, '/messages/' + id)).folder).toBe('archive');
});
