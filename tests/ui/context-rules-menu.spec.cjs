const { test, expect } = require('@playwright/test');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path'),
  os = require('node:os');
let prefix, original, ids, subject;
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
  ids = [];
  prefix = 'Context ' + Date.now();
  subject = prefix + ' <img src=x onerror=window.bad=true>';
  await page.goto('/');
  original = await api(page, '/preferences');
  await api(page, '/preferences', 'PUT', {
    ...original,
    layout: 'classic',
    ui_zoom: 100,
    quick_filter_pinned: false,
  });
  if (!process.env.INKWELL_UI_DATA?.startsWith(path.join(os.tmpdir(), 'inkwell-ui-')))
    throw Error('Unsafe fixture path');
  const db = new DatabaseSync(path.join(process.env.INKWELL_UI_DATA, 'inkwell.db'));
  db.function('inkwell_sender_key', (_value) => 'writer@example.co.uk');
  db.function('inkwell_domain_key', (_value) => 'example.co.uk');
  db.function('inkwell_subject_key', (value) => value.toLowerCase());
  ids = [subject, prefix + ' untouched'].map((subject) =>
    Number(
      db
        .prepare(
          "INSERT INTO messages(sender,recipient,subject,body,date,remote_key) VALUES ('Writer <writer@example.co.uk>','me@example.net',?,'Keep body','2099-01-01',?)",
        )
        .run(subject, subject).lastInsertRowid,
    ),
  );
  db.close();
  await page.reload();
});
test.afterEach(async ({ page }) => {
  for (const rule of await api(page, '/rules'))
    if (rule.name.startsWith(prefix)) await api(page, '/rules/' + rule.id, 'DELETE');
  for (const id of ids) {
    await api(page, '/messages/' + id, 'PATCH', { folder: 'trash' });
    await api(page, '/messages/' + id, 'DELETE');
  }
  const tags = (await api(page, '/tags')).filter((t) => t.name.startsWith(prefix));
  if (tags.length) await api(page, '/tags/delete', 'POST', { ids: tags.map((t) => t.id) });
  await api(page, '/preferences', 'PUT', original);
});
test('Apply rule prefills sender, subject, domain and TLD and applies only this copy', async ({
  page,
}) => {
  const tag = (await api(page, '/tags', 'POST', { name: prefix })).id;
  await page.locator(`[data-more="${ids[0]}"]`).click();
  await page.getByRole('menuitem', { name: 'Apply rule…', exact: true }).click();
  await expect(page.getByLabel('Condition 1 value', { exact: true })).toHaveValue(
    'writer@example.co.uk',
  );
  await page.getByLabel('Rule name', { exact: true }).fill(prefix + ' rule');
  for (const [field, value] of [
    ['subject', subject],
    ['domain', 'example.co.uk'],
    ['tld', 'uk'],
    ['sender', 'writer@example.co.uk'],
    ['tld', 'uk'],
  ]) {
    await page.getByLabel('Condition 1 field', { exact: true }).selectOption(field);
    await expect(page.getByLabel('Condition 1 value', { exact: true })).toHaveValue(value);
  }
  await expect(page.locator('#rule-editor img')).toHaveCount(0);
  await page.getByLabel('Action 1 value', { exact: true }).selectOption(String(tag));
  await page.getByRole('button', { name: 'Save and apply to this message', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('saved and applied');
  expect(JSON.parse((await api(page, '/messages/' + ids[0])).tags)).toEqual([prefix]);
  expect(JSON.parse((await api(page, '/messages/' + ids[1])).tags)).toEqual([]);
  expect(
    (await api(page, '/rules')).find((r) => r.name === prefix + ' rule').conditions[0],
  ).toEqual({ field: 'tld', operator: 'is', value: 'uk' });
});
test('Retrying a failed selected-message application does not create duplicate rules', async ({
  page,
}) => {
  await page.locator(`[data-more="${ids[0]}"]`).click();
  await page.getByRole('menuitem', { name: 'Apply rule…', exact: true }).click();
  await page.getByLabel('Rule name', { exact: true }).fill(prefix + ' retry');
  await page.getByLabel('Action 1 type', { exact: true }).selectOption('star');
  let attempts = 0;
  await page.route('**/api/rules/*/apply-message', (route) =>
    ++attempts === 1
      ? route.fulfill({ status: 500, json: { detail: 'Temporary failure' } })
      : route.continue(),
  );
  await page.getByRole('button', { name: 'Save and apply to this message', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Rule saved, but applying failed');
  await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(prefix + ' retry');
  await page.getByRole('button', { name: 'Save and apply to this message', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('saved and applied');
  expect((await api(page, '/rules')).filter((r) => r.name === prefix + ' retry')).toHaveLength(1);
  expect((await api(page, '/messages/' + ids[0])).starred).toBe(1);
});

test('Grouped menu stays compact and submenus fit the viewport with keyboard and touch back', async ({
  page,
}, info) => {
  await page.locator(`[data-more="${ids[0]}"]`).click();
  const menu = page.locator('#message-menu');
  expect(await menu.locator('.menu-root > button:visible').count()).toBeLessThanOrEqual(10);
  for (const [key, label] of [
    ['filing', 'File'],
    ['mark', 'Mark'],
    ['find', 'Find related'],
    ['more', 'More actions'],
  ]) {
    await page.getByRole('menuitem', { name: label, exact: true }).click();
    const panel = page.locator('#message-sub-' + key);
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height + 1);
    expect(
      await panel
        .locator('button:visible')
        .evaluateAll((nodes) => nodes.every((n) => getComputedStyle(n).whiteSpace === 'nowrap')),
    ).toBe(true);
    if (await panel.locator('.submenu-back').isVisible())
      await panel.locator('.submenu-back').click();
    else await page.keyboard.press('ArrowLeft');
  }
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.screenshot({
    path: 'test-results/' + info.project.name + '-grouped-menu.png',
    fullPage: false,
  });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
});
