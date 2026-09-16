const { test, expect } = require('@playwright/test');
const { DatabaseSync } = require('node:sqlite');
const { sidebarClick, selectEmailMenuAction } = require('./helpers.cjs');
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
  for (const folder of await api(page, '/local-folders'))
    if (folder.name.startsWith(prefix)) await api(page, '/local-folders/' + folder.id, 'DELETE');
  await api(page, '/preferences', 'PUT', original);
});
test('Email-file download exports cached mail without altering the message', async ({ page }) => {
  const before = await api(page, '/messages/' + ids[0]);
  await page.locator(`[data-more="${ids[0]}"]`).click();
  const pending = page.waitForEvent('download');
  await selectEmailMenuAction(page, 'Save email file (.eml)');
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.eml$/);
  const contents = require('node:fs').readFileSync(await download.path(), 'utf8');
  expect(contents).toContain('X-Inkwell-Export:');
  expect(contents).toContain('Keep body');
  expect(await api(page, '/messages/' + ids[0])).toEqual(before);
});

test('Apply Rule starts from the message, not an existing rule; saved rules require selection', async ({
  page,
}) => {
  const rule = (
    await api(page, '/rules', 'POST', {
      name: prefix + ' saved',
      enabled: false,
      conditions: [{ field: 'subject', operator: 'contains', value: prefix }],
      actions: [{ type: 'star' }],
    })
  ).id;
  await page.locator(`[data-message="${ids[0]}"] .subject`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Apply rule…', exact: true }).click();
  await expect(page.getByLabel('Rule name', { exact: true })).not.toHaveValue(prefix + ' saved');
  await expect(page.getByLabel('Condition 1 value', { exact: true })).toHaveValue(
    'writer@example.co.uk',
  );
  await expect(page.getByRole('button', { name: 'Run saved rule', exact: true })).toBeDisabled();
  await expect(page.locator('.rule-entry.active')).toHaveCount(0);
  await page.locator(`[data-edit-rule="${rule}"]`).click();
  await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(prefix + ' saved');
  await expect(page.getByRole('button', { name: 'Run saved rule', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Run saved rule', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('1 local copies matched');
  expect((await api(page, '/messages/' + ids[0])).starred).toBe(1);
  expect((await api(page, '/messages/' + ids[1])).starred).toBe(0);
  const stored = (await api(page, '/rules')).filter((r) => r.id === rule);
  expect(stored).toHaveLength(1);
  expect(stored[0].enabled).toBe(false);
  await page.getByRole('button', { name: 'Create from this message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run saved rule', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Condition 1 value', { exact: true })).toHaveValue(
    'writer@example.co.uk',
  );
});

test('Destination autocomplete keeps IDs, selects by keyboard, and blocks unmatched text', async ({
  page,
}) => {
  const folder = (await api(page, '/local-folders', 'POST', { name: prefix + ' Destination' })).id;
  await page.goto('/#/rules');
  await page.locator('#create-rule').click();
  await page.getByLabel('Rule name', { exact: true }).fill(prefix + ' autocomplete');
  await page.getByLabel('Condition 1 value', { exact: true }).fill(prefix);
  const input = page.getByRole('combobox', { name: 'Action 1 value', exact: true });
  await input.fill('does not exist');
  await page.getByRole('button', { name: 'Save rule', exact: true }).click();
  expect(
    (await api(page, '/rules')).filter((r) => r.name === prefix + ' autocomplete'),
  ).toHaveLength(0);
  await input.fill(prefix + ' Dest');
  await page.evaluate(async () => {
    const folders = await (await fetch('/api/local-folders')).json();
    document
      .querySelector('#rule-editor')
      .dispatchEvent(new CustomEvent('inkwell-folders-changed', { detail: folders }));
  });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(prefix + ' Dest');
  await expect(
    page.getByRole('listbox').getByRole('option', { name: prefix + ' Destination', exact: true }),
  ).toBeVisible();
  await input.press('Enter');
  await expect(input).toHaveValue(prefix + ' Destination');
  await input.fill(prefix + ' Dest');
  await page.getByLabel('Rule name', { exact: true }).click();
  await expect(input).toHaveValue(prefix + ' Destination');
  await page.getByRole('button', { name: 'Save rule', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Rule saved');
  expect(
    (await api(page, '/rules')).find((r) => r.name === prefix + ' autocomplete').actions,
  ).toEqual([{ type: 'move', value: 'local-' + folder }]);
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
  await page.route('**/api/rules/run', (route) =>
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

test('Opening Rule Manager remembers the reader message and its current folder', async ({
  page,
}) => {
  const folder = (await api(page, '/local-folders', 'POST', { name: prefix + ' current' })).id;
  await api(page, '/messages/' + ids[0], 'PATCH', { folder: 'local-' + folder });
  await page.reload();
  await sidebarClick(page, `#navigation [data-view="local-${folder}"]`);
  await page.locator(`[data-message="${ids[0]}"] .subject`).click();
  await expect(page.locator('#reader')).toContainText(subject);
  await sidebarClick(page, '#rule-manager-link');
  await expect(page.getByLabel('Rule run scope')).toHaveValue('message');
  await page.getByLabel('Rule run scope').selectOption('folder');
  await expect(page.getByLabel('Folder to process')).toHaveValue('local-' + folder);
  await page.locator('#create-rule').click();
  await page.getByLabel('Rule name', { exact: true }).fill(prefix + ' current rule');
  await page.getByLabel('Condition 1 value', { exact: true }).fill(prefix);
  await page.getByLabel('Action 1 type', { exact: true }).selectOption('star');
  await page.getByRole('button', { name: 'Save and run', exact: true }).click();
  await expect(page.locator('#rule-run-status')).toContainText('1 local copies matched');
  expect((await api(page, '/messages/' + ids[0])).starred).toBe(1);
  expect((await api(page, '/messages/' + ids[1])).starred).toBe(0);
});

test('Save and run supports a chosen folder, all folders, and rerunning a saved rule', async ({
  page,
}) => {
  await api(page, '/messages/' + ids[1], 'PATCH', { folder: 'archive' });
  await page.locator(`[data-more="${ids[0]}"]`).click();
  await page.getByRole('menuitem', { name: 'Apply rule…', exact: true }).click();
  await page.getByLabel('Rule name', { exact: true }).fill(prefix + ' scopes');
  await page.getByLabel('Condition 1 field', { exact: true }).selectOption('subject');
  await page.getByLabel('Condition 1 operator', { exact: true }).selectOption('contains');
  await page.getByLabel('Condition 1 value', { exact: true }).fill(prefix);
  await page.getByLabel('Action 1 type', { exact: true }).selectOption('star');
  await page.getByLabel('Rule run scope').selectOption('folder');
  await page.getByLabel('Folder to process').selectOption('inbox');
  await page.getByRole('button', { name: 'Save and run', exact: true }).click();
  await expect(page.locator('#rule-run-status')).toContainText('1 local copies matched');
  expect((await api(page, '/messages/' + ids[0])).starred).toBe(1);
  expect((await api(page, '/messages/' + ids[1])).starred).toBe(0);
  await page.getByLabel('Rule run scope').selectOption('all');
  await page.getByRole('button', { name: 'Save and run', exact: true }).click();
  await expect(page.locator('#rule-run-status')).toContainText('2 local copies matched');
  expect((await api(page, '/messages/' + ids[1])).starred).toBe(1);
  await api(page, '/messages/' + ids[1], 'PATCH', { starred: false });
  await page.getByLabel('Rule name', { exact: true }).fill(prefix + ' unsaved');
  await page.getByRole('button', { name: 'Run saved rule', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('2 local copies matched');
  await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(prefix + ' unsaved');
  expect((await api(page, '/messages/' + ids[1])).starred).toBe(1);
});

test('Rule priorities move without losing editor changes, with drag previews and keyboard alternatives', async ({
  page,
}) => {
  const created = [];
  for (let i = 0; i < 3; i++)
    created.push(
      (
        await api(page, '/rules', 'POST', {
          name: prefix + ' priority ' + i,
          conditions: [{ field: 'subject', operator: 'contains', value: prefix }],
          actions: [{ type: 'star' }],
        })
      ).id,
    );
  await page.goto('/#/rules');
  await page.locator(`[data-edit-rule="${created[0]}"]`).click();
  await page.getByLabel('Rule name', { exact: true }).fill(prefix + ' unsaved');
  const control = page.locator(`[data-rule-down="${created[0]}"]`);
  expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(
    test.info().project.name === 'mobile' ? 44 : 32,
  );
  await control.click();
  await expect(page.locator(`[data-edit-rule="${created[0]}"] strong`)).toContainText('2.');
  await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(prefix + ' unsaved');
  const target = page.locator(`[data-rule-entry="${created[1]}"]`),
    box = await target.boundingBox();
  const data = await page.evaluateHandle(() => new DataTransfer());
  await page
    .locator(`[data-edit-rule="${created[2]}"]`)
    .dispatchEvent('dragstart', { dataTransfer: data });
  await target.dispatchEvent('dragover', { dataTransfer: data, clientY: box.y + 1 });
  await expect(target).toHaveClass(/rule-drop-before/);
  await page.keyboard.press('Escape');
  await expect(target).not.toHaveClass(/rule-drop-before/);
  await page
    .locator(`[data-edit-rule="${created[2]}"]`)
    .dispatchEvent('dragstart', { dataTransfer: data });
  await target.dispatchEvent('dragover', { dataTransfer: data, clientY: box.y + 1 });
  expect(
    (await api(page, '/rules')).filter((r) => created.includes(r.id)).map((r) => r.id),
  ).toEqual([created[1], created[0], created[2]]);
  await target.dispatchEvent('drop', { dataTransfer: data, clientY: box.y + 1 });
  await expect(page.locator(`[data-edit-rule="${created[2]}"] strong`)).toContainText('1.');
  await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(prefix + ' unsaved');
  await page.reload();
  await expect(page.locator(`[data-edit-rule="${created[2]}"] strong`)).toContainText('1.');
});

test('Stop processing is saved and all-rule runs honor it', async ({ page }) => {
  const first = (
    await api(page, '/rules', 'POST', {
      name: prefix + ' stop',
      conditions: [{ field: 'subject', operator: 'contains', value: prefix }],
      actions: [{ type: 'star' }],
    })
  ).id;
  await api(page, '/rules', 'POST', {
    name: prefix + ' later',
    conditions: [{ field: 'subject', operator: 'contains', value: prefix }],
    actions: [{ type: 'unstar' }],
  });
  await page.goto('/#/rules');
  await page.locator(`[data-edit-rule="${first}"]`).click();
  await page.getByLabel('Rule run scope').selectOption('all');
  await page.locator('#apply-rules').click();
  await expect(page.locator('#rule-run-status')).toContainText('2 local copies matched');
  expect((await api(page, '/messages/' + ids[0])).starred).toBe(1);
  await page
    .getByRole('checkbox', { name: 'Stop processing further rules after this rule matches' })
    .uncheck();
  await page.getByRole('button', { name: 'Save rule', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Rule saved');
  await page.locator('#apply-rules').click();
  await expect.poll(async () => (await api(page, '/messages/' + ids[0])).starred).toBe(0);
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
