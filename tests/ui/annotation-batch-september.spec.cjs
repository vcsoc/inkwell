const { test, expect } = require('@playwright/test');

test('desktop application rail remains visible across layouts and themes', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'mobile', 'Mobile keeps the persistent bottom navigation');
  await page.goto('/');
  const original = await page.evaluate(() => fetch('/api/preferences').then((r) => r.json()));
  try {
    for (const [index, layout] of ['focus', 'classic', 'stacked', 'list'].entries()) {
      await page.evaluate(
        async ({ original, layout, dark }) => {
          await fetch('/api/preferences', {
            method: 'PUT',
            headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...original, layout, theme: { ...original.theme, dark } }),
          });
        },
        { original, layout, dark: !!(index % 2) },
      );
      await page.reload();
      await expect(page.locator('.app-rail')).toBeVisible();
      const rail = await page.locator('.app-rail').boundingBox();
      expect(rail.x).toBe(0);
      expect(rail.height).toBeGreaterThan(800);
      for (const item of ['Mail', 'Calendar', 'People', 'Settings'])
        await expect(
          page.locator('.app-rail').getByRole('button', { name: item, exact: true }),
        ).toBeVisible();
    }
  } finally {
    await page.evaluate(
      (value) =>
        fetch('/api/preferences', {
          method: 'PUT',
          headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
        }),
      original,
    );
  }
});

test('people icon actions, compact header, breadcrumb, and matching search heights', async ({
  page,
}, info) => {
  await page.goto('/#/contacts');
  const title = page.locator('#page-title');
  await expect(title).toHaveText('your people.');
  const row = page.locator('.contact-card').first();
  if (await row.count()) {
    const person = await row.locator('h2').innerText();
    await expect(row.getByRole('button', { name: `Write email to ${person}` })).toHaveAttribute(
      'title',
      `Write email to ${person}`,
    );
    await expect(row.getByRole('button', { name: `Edit ${person}` }).locator('svg')).toHaveCount(1);
  }
  await page.goto('/#/settings/notifications');
  await expect(title).toHaveText('notifications.');
  await expect(page.locator('#breadcrumb')).toHaveText('settings.  notifications.');
  await expect(page.locator('.settings-nav a').last()).toHaveText('About');
  const result = await page.evaluate(() => ({
    heading: document.querySelector('.page-heading').getBoundingClientRect().toJSON(),
    title: document.querySelector('#page-title').getBoundingClientRect().toJSON(),
    subtitle: document.querySelector('.page-heading-context').getBoundingClientRect().toJSON(),
    sizes: ['#global-search', '#search-date-from', '#search-date-to', '#search-scope'].map(
      (selector) => ({
        height: document.querySelector(selector).getBoundingClientRect().height,
        font: getComputedStyle(document.querySelector(selector)).fontSize,
      }),
    ),
  }));
  expect(result.heading.height).toBeLessThan(91);
  expect(result.subtitle.left).toBeGreaterThan(result.title.right);
  expect(result.subtitle.right).toBeGreaterThan(result.heading.right - 26);
  expect(new Set(result.sizes.map((size) => size.height)).size).toBe(1);
  expect(new Set(result.sizes.map((size) => size.font)).size).toBe(1);
  if (info.project.name === 'desktop')
    await page.screenshot({ path: 'test-results/settings-annotation-header.png' });
});

test('Codex shows inline login, live cached model suggestions and model-specific thinking', async ({
  page,
}) => {
  await page.route('**/api/ai/codex/status', (route) =>
    route.fulfill({ json: { available: true, message: 'ChatGPT login detected on the backend.' } }),
  );
  await page.route('**/api/ai/codex/models', (route) =>
    route.fulfill({
      json: [
        {
          id: 'sample-medium',
          default_thinking: 'medium',
          thinking_levels: ['low', 'medium', 'high'],
        },
      ],
    }),
  );
  await page.goto('/#/settings/assistant');
  const settings = page.locator('#settings-assistant');
  await settings.getByLabel('AI provider', { exact: true }).selectOption('codex');
  await expect(settings.locator('#ai-api-url')).toBeHidden();
  await expect(settings.locator('#ai-api-key')).toBeHidden();
  await expect(settings.locator('#codex-status-result')).toContainText('ChatGPT login detected');
  await expect(settings.locator('#codex-models option[value="sample-medium"]')).toHaveCount(1);
  await settings.getByLabel('Model', { exact: true }).fill('sample-medium');
  await expect(settings.getByLabel('Thinking level')).toContainText('Model default (medium)');
  await settings.getByLabel('Thinking level').selectOption('high');
  await expect(settings.getByLabel('Assistant instructions')).toHaveValue(
    /do not help develop or change inkwell/,
  );
  await settings.getByRole('button', { name: 'Save assistant' }).click();
  await expect
    .poll(() => page.evaluate(() => fetch('/api/ai/config').then((r) => r.json())))
    .toMatchObject({ provider: 'codex', model: 'sample-medium', thinking_level: 'high' });
});
