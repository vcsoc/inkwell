const { test, expect } = require('@playwright/test');

test('Match mode switches by pointer and keyboard, and a single-condition choice persists', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 967 });
  await page.goto('/#/rules');
  await page.locator('#create-rule').click();
  const group = page.getByRole('group', { name: 'Match conditions' });
  const all = group.getByRole('button', { name: 'All AND' });
  const any = group.getByRole('button', { name: 'Any OR' });
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await any.click();
  await expect(any).toHaveAttribute('aria-pressed', 'true');
  await expect(all).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#rule-form [name=mode]')).toHaveValue('any');
  await all.focus();
  await all.press('Enter');
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await any.click();
  await page.getByLabel('Rule name', { exact: true }).fill('One condition match test');
  await page.getByLabel('Condition 1 value', { exact: true }).fill('Example');
  await page.getByRole('button', { name: 'Save rule', exact: true }).click();
  await expect(any).toHaveAttribute('aria-pressed', 'true');
  const saved = await page.evaluate(async () =>
    (await (await fetch('/api/rules')).json()).find(
      (rule) => rule.name === 'One condition match test',
    ),
  );
  expect(saved.mode).toBe('any');
  await page.reload();
  await page.getByRole('button', { name: 'Edit One condition match test' }).click();
  await expect(
    page.getByRole('group', { name: 'Match conditions' }).getByRole('button', { name: 'Any OR' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(
    async (id) => fetch('/api/rules/' + id, { method: 'DELETE', headers: { 'X-Inkwell': '1' } }),
    saved.id,
  );
});
