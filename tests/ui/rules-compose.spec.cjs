const { test, expect } = require('@playwright/test');
const { openRuleSection } = require('./helpers.cjs');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path'),
  os = require('node:os');
let original, prefix;
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
  prefix = 'Builder ' + Date.now();
  await page.goto('/');
  original = await api(page, '/preferences');
  await api(page, '/preferences', 'PUT', {
    ...original,
    form_mode: 'popup',
    layout: 'classic',
    ui_zoom: 100,
  });
  await page.reload();
  page.on('dialog', async (dialog) => {
    await dialog.dismiss();
    throw Error('Unexpected confirmation');
  });
});
test.afterEach(async ({ page }) => {
  if (await page.locator('#compose-form').isVisible()) await page.locator('#close-modal').click();
  for (const r of await api(page, '/rules'))
    if (r.name.startsWith(prefix)) await api(page, '/rules/' + r.id, 'DELETE');
  for (const m of await api(page, '/messages?scope=all&q=' + encodeURIComponent(prefix))) {
    await api(page, '/messages/' + m.id, 'PATCH', { folder: 'trash' });
    await api(page, '/messages/' + m.id, 'DELETE');
  }
  for (const f of await api(page, '/local-folders'))
    if (f.name.startsWith(prefix)) await api(page, '/local-folders/' + f.id, 'DELETE');
  const tags = (await api(page, '/tags')).filter((t) => t.name.startsWith(prefix));
  if (tags.length) await api(page, '/tags/delete', 'POST', { ids: tags.map((t) => t.id) });
  for (const a of await api(page, '/accounts'))
    if (a.name.startsWith(prefix)) await api(page, '/accounts/' + a.id, 'DELETE');
  await api(page, '/preferences', 'PUT', original);
});

test('Auto-tag shortcut creates and selects a tag without losing the domain rule', async ({
  page,
}) => {
  if (await page.locator('.app-rail').isVisible())
    await page.locator('.app-rail [data-view="rules"]').click();
  else {
    if (await page.locator('#menu').isVisible()) await page.locator('#menu').click();
    await page.locator('#rule-manager-link').click();
  }
  await page.getByRole('button', { name: 'Create auto-tag rule', exact: true }).click();
  await page.getByLabel('Rule name', { exact: true }).fill(prefix + ' auto tag');
  await expect(page.getByLabel('Condition 1 field', { exact: true })).toHaveValue('domain');
  await expect(page.getByLabel('Condition 1 operator', { exact: true })).toHaveValue('is');
  await page.getByLabel('Condition 1 value', { exact: true }).fill('@example.com');
  await openRuleSection(page, 'rule-resource-tools');
  await page.getByLabel('New rule tag', { exact: true }).fill(prefix);
  await page.getByRole('button', { name: 'Create tag', exact: true }).click();
  await expect(page.getByLabel('Action 1 value', { exact: true })).not.toHaveValue('');
  await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(prefix + ' auto tag');
  await expect(page.getByLabel('Condition 1 value', { exact: true })).toHaveValue('@example.com');
  await page.getByRole('button', { name: 'Save rule', exact: true }).click();
  await expect(page.locator('#rules-list')).toContainText(prefix + ' auto tag');
  const rule = (await api(page, '/rules')).find((r) => r.name === prefix + ' auto tag');
  expect(rule.conditions).toEqual([{ field: 'domain', operator: 'is', value: 'example.com' }]);
  expect(rule.actions).toHaveLength(1);
  expect(rule.actions[0].type).toBe('add_tag');
});

test('Rule Manager builds AND/OR conditions and multiple actions, preserves editing when creating a folder', async ({
  page,
}, info) => {
  const tag = (await api(page, '/tags', 'POST', { name: prefix + ' Review', color: '#2664a0' })).id;
  const message = (
    await api(page, '/drafts', 'POST', { subject: prefix + ' ABC', body: 'Match this copy' })
  ).id;
  if (!process.env.INKWELL_UI_DATA?.startsWith(path.join(os.tmpdir(), 'inkwell-ui-')))
    throw Error('Refuse unsafe fixture');
  const db = new DatabaseSync(path.join(process.env.INKWELL_UI_DATA, 'inkwell.db'));
  db.prepare(
    "UPDATE messages SET folder='inbox',draft_revision=0,draft_key=NULL,unread=1,local_folder_override=0,remote_key=? WHERE id=?",
  ).run('fixture:' + message, message);
  db.close();
  await page.goto('/#/rules');
  await expect(page.locator('#page-title')).toContainText('Rule Manager');
  if (await page.locator('#menu').isVisible()) {
    await page.locator('#menu').click();
    await expect(page.locator('#rule-manager-link')).toBeVisible();
    await page.locator('#rule-manager-link').click();
  }
  await page.locator('#create-rule').click();
  await page.getByLabel('Rule name', { exact: true }).fill(prefix + ' ABC rule');
  await page.getByLabel('Condition 1 value', { exact: true }).fill('ABC');
  await page.getByRole('button', { name: 'Add condition', exact: true }).click();
  await page.getByLabel('Condition 2 field', { exact: true }).selectOption('unread');
  await page
    .getByRole('group', { name: 'Match conditions' })
    .getByRole('button', { name: 'Any OR' })
    .click();
  await openRuleSection(page, 'rule-resource-tools');
  await page.getByLabel('New local folder', { exact: true }).fill(prefix + ' XYZ');
  await page.getByRole('button', { name: 'Create local folder', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Local folder created');
  await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(prefix + ' ABC rule');
  await expect(page.getByLabel('Condition 1 value', { exact: true })).toHaveValue('ABC');
  const folder = (await api(page, '/local-folders')).find((f) => f.name === prefix + ' XYZ').id;
  await page.getByLabel('Action 1 value', { exact: true }).fill(prefix + ' XYZ');
  await page.getByLabel('Action 1 value', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await page.getByLabel('Action 2 type', { exact: true }).selectOption('mark_read');
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await page.getByLabel('Action 3 type', { exact: true }).selectOption('add_tag');
  await page.getByLabel('Action 3 value', { exact: true }).selectOption(String(tag));
  await page.getByRole('button', { name: 'Save rule', exact: true }).click();
  await expect(page.locator('#rules-list')).toContainText('ANY of 2 conditions');
  const saved = (await api(page, '/rules')).find((r) => r.name === prefix + ' ABC rule');
  expect(saved.actions).toHaveLength(3);
  await page.locator(`[data-edit-rule="${saved.id}"]`).click();
  await page
    .getByRole('group', { name: 'Match conditions' })
    .getByRole('button', { name: 'All AND' })
    .click();
  await page.getByRole('button', { name: 'Save rule', exact: true }).click();
  await page.locator('#apply-rules').click();
  await expect(page.locator('#toast')).toContainText('1 local copies matched');
  const moved = await api(page, '/messages/' + message);
  expect(moved.folder).toBe('local-' + folder);
  expect(moved.unread).toBe(0);
  expect(JSON.parse(moved.tags)).toContain(prefix + ' Review');
  await page.screenshot({
    path: 'test-results/' + info.project.name + '-rule-manager.png',
    fullPage: true,
  });
});

test('To Cc Bcc autocomplete remembers used addresses and draft recipients survive reopening', async ({
  page,
}) => {
  await api(page, '/drafts', 'POST', {
    subject: prefix + ' History',
    recipient: 'History Person <remembered@example.test>',
  });
  await page.locator('#heading-compose').click();
  await page.getByLabel('Subject', { exact: true }).fill(prefix + ' Compose');
  const to = page.getByRole('combobox', { name: 'To', exact: true });
  await to.fill('rememb');
  await page
    .getByRole('option', { name: 'remembered@example.test History Person', exact: true })
    .click();
  await expect(to).toHaveValue('remembered@example.test');
  await page.locator('#toggle-cc').click();
  const cc = page.getByRole('combobox', { name: 'Cc', exact: true });
  await cc.fill('another@example.test, rememb');
  await expect(
    page.getByRole('option', { name: 'remembered@example.test History Person', exact: true }),
  ).toBeVisible();
  await cc.press('ArrowDown');
  await cc.press('Enter');
  await expect(cc).toHaveValue('another@example.test, remembered@example.test');
  await page.locator('#toggle-bcc').click();
  const bcc = page.getByRole('combobox', { name: 'Bcc', exact: true });
  await bcc.fill('rememb');
  await page
    .getByRole('option', { name: 'remembered@example.test History Person', exact: true })
    .click();
  await page.locator('#toggle-bcc').click();
  await expect(bcc).toBeVisible();
  await expect(page.locator('#toast')).toContainText('Clear Bcc recipients');
  await page.locator('#close-modal').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  const summary = (
    await api(page, '/messages?folder=drafts&q=' + encodeURIComponent(prefix + ' Compose'))
  )[0];
  const saved = await api(page, '/messages/' + summary.id);
  expect(saved.cc).toBe('another@example.test, remembered@example.test');
  expect(saved.bcc).toBe('remembered@example.test');
  await page.goto('/#/drafts');
  await page.locator(`[data-message="${saved.id}"]`).click();
  await expect(page.getByRole('combobox', { name: 'Cc', exact: true })).toHaveValue(saved.cc);
  await expect(page.getByRole('combobox', { name: 'Bcc', exact: true })).toHaveValue(saved.bcc);
});

test('Tag palette and two-dimensional picker replace RGB sliders and persist colors', async ({
  page,
}, info) => {
  await page.goto('/#/tags');
  await page.getByRole('button', { name: 'Create tag', exact: true }).click();
  await page.getByLabel('Tag name', { exact: true }).fill(prefix + ' Color');
  await expect(page.locator('#tag-editor [data-channel]')).toHaveCount(0);
  await page.getByLabel('Choose tag color', { exact: true }).click();
  await page.getByRole('button', { name: 'Set Tag color to #2664a0', exact: true }).click();
  await expect(page.getByLabel('Tag color', { exact: true })).toHaveValue('#2664a0');
  const plane = page.getByRole('slider', {
    name: 'Tag color saturation and brightness',
    exact: true,
  });
  await plane.click({ position: { x: 60, y: 40 } });
  await plane.press('ArrowRight');
  const color = await page.getByLabel('Tag color', { exact: true }).inputValue();
  expect(color).toMatch(/^#[0-9a-f]{6}$/);
  expect(color).not.toBe('#2664a0');
  await page.getByRole('button', { name: 'Save tag', exact: true }).click();
  await expect(page.locator('#tag-list')).toContainText(prefix + ' Color');
  const tag = (await api(page, '/tags')).find((t) => t.name === prefix + ' Color');
  expect(tag.color).toBe(color);
  await page.locator(`[data-edit-tag="${tag.id}"]`).click();
  await expect(page.getByLabel('Tag color', { exact: true })).toHaveValue(color);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: 'test-results/' + info.project.name + '-tag-picker.png',
    fullPage: true,
  });
});

test('Context menu text is smaller without losing touch targets or no-wrap labels', async ({
  page,
}) => {
  const m = (await api(page, '/drafts', 'POST', { subject: prefix + ' Menu' })).id;
  await api(page, '/messages/' + m, 'PATCH', { folder: 'inbox' });
  await page.reload();
  await page.locator(`[data-message="${m}"] [data-more]`).click();
  const item = page.getByRole('menuitem', { name: 'Reply', exact: true });
  await expect(item).toBeVisible();
  const values = await item.evaluate((el) => ({
    size: parseFloat(getComputedStyle(el).fontSize),
    base: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-size')),
    height: el.getBoundingClientRect().height,
    wrap: getComputedStyle(el).whiteSpace,
    touch: matchMedia('(pointer: coarse), (max-width: 760px)').matches,
  }));
  expect(values.size).toBe(Math.max(12, values.base - 2));
  expect(values.height).toBeGreaterThanOrEqual(values.touch ? 44 : 34);
  expect(values.wrap).toBe('nowrap');
});

test('Enter in address and subject fields cannot accidentally send mail', async ({ page }) => {
  await page.route('**/api/sync', (route) => route.fulfill({ json: [] }));
  let submissions = 0;
  await page.route('**/api/send', (route) => {
    submissions++;
    return route.fulfill({ json: { id: 1 } });
  });
  await api(page, '/accounts', 'POST', {
    name: prefix + ' Sender',
    email: 'sender@example.test',
    username: 'sender@example.test',
    password: 'test-only',
    imap_host: 'imap.example.test',
    smtp_host: 'smtp.example.test',
    smtp_port: 465,
    smtp_security: 'tls',
  });
  await page.reload();
  await page.locator('#heading-compose').click();
  await expect(page.getByRole('button', { name: 'Send message ↗', exact: true })).toBeEnabled();
  const to = page.getByLabel('To', { exact: true });
  await to.fill('recipient@example.test');
  await to.press('Enter');
  await expect(page.getByLabel('Subject', { exact: true })).toBeFocused();
  await page.getByLabel('Subject', { exact: true }).fill(prefix + ' Enter guard');
  await page.getByLabel('Subject', { exact: true }).press('Enter');
  await expect(page.getByLabel('Message', { exact: true })).toBeFocused();
  expect(submissions).toBe(0);
});
