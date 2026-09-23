const { test, expect } = require('@playwright/test');
const { openRuleSection } = require('./helpers.cjs');
let prefix, ids;
async function api(page, path, method = 'GET', body) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const r = await fetch('/api' + path, {
        method,
        headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) throw Error(await r.text());
      return r.json();
    },
    { path, method, body },
  );
}
test.beforeEach(async ({ page }) => {
  prefix = 'Compact rules ' + Date.now();
  ids = [];
  await page.goto('/');
  for (const name of ['First', 'Second']) {
    const r = await api(page, '/rules', 'POST', {
      name: prefix + ' ' + name,
      enabled: true,
      mode: 'all',
      conditions: [{ field: 'subject', operator: 'contains', value: name }],
      actions: [{ type: 'star', value: '' }],
    });
    ids.push(r.id);
  }
  await page.goto('/#/rules');
  await expect(page.locator('#rule-form')).toBeVisible();
});
test.afterEach(async ({ page }) => {
  for (const r of await api(page, '/rules'))
    if (r.name.includes(prefix)) await api(page, '/rules/' + r.id, 'DELETE');
});
test('Rule list and editor align, selecting is obvious, search preserves edits and saving keeps the rule open', async ({
  page,
}, info) => {
  const first = (await api(page, '/rules'))[0];
  await expect(page.locator(`[data-edit-rule="${first.id}"]`)).toHaveAttribute(
    'aria-current',
    'true',
  );
  const left = await page.locator('.rule-list-pane').boundingBox(),
    right = await page.locator('#rule-editor').boundingBox();
  if (info.project.name === 'desktop') {
    expect(left.x + left.width).toBeLessThan(right.x);
    expect(Math.abs(left.y - right.y)).toBeLessThan(2);
  } else expect(left.y + left.height).toBeLessThan(right.y);
  await page.locator(`[data-edit-rule="${ids[0]}"]`).click();
  await page.getByLabel('Rule name', { exact: true }).fill(prefix + ' Unfinished');
  await page.getByLabel('Condition 1 value', { exact: true }).fill('Unsaved condition');
  await page.locator('#rules-search').fill('Second');
  await expect(page.getByLabel('Condition 1 value', { exact: true })).toHaveValue(
    'Unsaved condition',
  );
  await page.locator('#rules-search').fill('');
  await expect(page.locator(`[data-edit-rule="${ids[0]}"]`)).toHaveAttribute(
    'aria-current',
    'true',
  );
  await page.locator(`[data-edit-rule="${ids[1]}"]`).click();
  await expect(page.getByLabel('Condition 1 value', { exact: true })).toHaveValue('Second');
  await page.getByLabel('Rule name', { exact: true }).fill(prefix + ' Edited second');
  await page.getByRole('button', { name: 'Save rule', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Rule saved');
  await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(
    prefix + ' Edited second',
  );
  await expect(page.locator(`[data-edit-rule="${ids[1]}"]`)).toHaveAttribute(
    'aria-current',
    'true',
  );
  const saved = (await api(page, '/rules')).filter((r) => r.name.includes(prefix));
  expect(saved).toHaveLength(2);
  expect(saved.find((r) => r.id === ids[0]).name).toBe(prefix + ' First');
  await page.screenshot({
    path: 'test-results/' + info.project.name + '-compact-rule-manager.png',
    fullPage: true,
  });
  await page.locator('#create-rule').click();
  await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue('');
  await expect(page.locator('.rule-entry.active')).toHaveCount(0);
});
test('Selected rule tools preserve editor changes and advanced settings reopen when active', async ({
  page,
}) => {
  await page.locator(`[data-edit-rule="${ids[0]}"]`).click();
  await expect(page.locator('#rule-advanced')).not.toHaveAttribute('open', '');
  await expect(page.locator('#rule-resource-tools')).not.toHaveAttribute('open', '');
  await page.getByLabel('Condition 1 value', { exact: true }).fill('Keep my edits');
  await page.locator(`[data-toggle-rule="${ids[0]}"]`).click();
  await expect(page.locator('#rule-form [name=enabled]')).not.toBeChecked();
  await expect(page.getByLabel('Condition 1 value', { exact: true })).toHaveValue('Keep my edits');
  await openRuleSection(page, 'rule-advanced');
  await page.getByLabel('Exclude unread messages').check();
  await page.getByRole('button', { name: 'Save rule', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Rule saved');
  const saved = (await api(page, '/rules')).find((r) => r.id === ids[0]);
  expect(saved.enabled).toBe(false);
  expect(saved.exclude_unread).toBe(true);
  await page.locator(`[data-edit-rule="${ids[1]}"]`).click();
  await page.locator(`[data-edit-rule="${ids[0]}"]`).click();
  await expect(page.locator('#rule-advanced')).toHaveAttribute('open', '');
  await expect(page.getByLabel('Exclude unread messages')).toBeChecked();
  await page.locator(`[data-copy-rule="${ids[0]}"]`).click();
  await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(
    'Copy of ' + prefix + ' First',
  );
  await expect(page.locator('.rule-entry.active')).toHaveCount(0);
  expect((await api(page, '/rules')).filter((r) => r.name.includes(prefix))).toHaveLength(2);
});
test('Action type stays narrow and Remove shares the action row', async ({ page }, info) => {
  await page.locator('#create-rule').click();
  const type = page.getByLabel('Action 1 type');
  const row = page.locator('[data-action-index="0"]');
  for (const action of ['move', 'star']) {
    await type.selectOption(action);
    const bounds = await row.evaluate((element) => {
      const box = (selector) => {
        const { x, y, width, height } = element.querySelector(selector).getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        field: document.querySelector('[data-condition="0"] label').getBoundingClientRect().width,
        type: box('label:first-child'),
        remove: box('[data-remove-action]'),
      };
    });
    if (info.project.name === 'desktop') {
      expect(bounds.type.width).toBeLessThan(bounds.field * 1.25);
      expect(
        Math.abs(bounds.remove.y + bounds.remove.height - bounds.type.y - bounds.type.height),
      ).toBeLessThan(3);
      expect(bounds.remove.x).toBeGreaterThan(bounds.type.x + bounds.type.width);
    }
  }
});
test('Resizing the split workspace keeps editor values and controls inside the page', async ({
  page,
}) => {
  await page.locator(`[data-edit-rule="${ids[0]}"]`).click();
  await page.getByLabel('Condition 1 value', { exact: true }).fill('Retain while resizing');
  for (const width of [1440, 1100, 800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByLabel('Condition 1 value', { exact: true })).toHaveValue(
      'Retain while resizing',
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    expect(overflow).toBe(false);
    const bounds = await page.locator('#rule-form select').evaluateAll((nodes) =>
      nodes.map((n) => ({
        x: n.getBoundingClientRect().x,
        right: n.getBoundingClientRect().right,
        width: innerWidth,
      })),
    );
    for (const b of bounds) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.right).toBeLessThanOrEqual(b.width + 1);
    }
  }
});
