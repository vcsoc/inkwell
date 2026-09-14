const { test, expect } = require('@playwright/test');
const { settingsSection } = require('./helpers.cjs');
async function view(page, name) {
  if (await page.locator('.mobile-tabs').isVisible())
    await page.locator('.mobile-tabs').getByRole('button', { name, exact: true }).click();
  else if (name === 'Settings') await page.locator('#settings').click();
  else await page.locator('#navigation').getByRole('button', { name, exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#page-title')).toContainText('Your inbox');
  await view(page, 'Settings');
});
test.afterEach(async ({ page }) => {
  await page.evaluate(async () => {
    await fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Inkwell': '1' },
      body: '{}',
    });
  });
});

test('internal forms persist, save, cancel and switch back to popup', async ({ page }) => {
  await settingsSection(page, 'Forms');
  await page.getByLabel('Form presentation').selectOption('inline');
  await page.getByRole('button', { name: 'Save form preference' }).click();
  await expect(page.locator('#toast')).toContainText('Form preference saved');
  await page.reload();
  await expect(page.locator('#page-title')).toContainText('Forms');
  await expect(page.getByLabel('Form presentation')).toHaveValue('inline');
  await settingsSection(page, 'Mail accounts');
  await page.getByRole('button', { name: 'Connect email' }).click();
  await expect(page.locator('main #modal.inline-form')).toBeVisible();
  expect(await page.locator('#modal').evaluate((el) => el.matches(':modal'))).toBe(false);
  await page.getByLabel('Quick setup').selectOption('gmail');
  await view(page, 'People');
  await expect(page.locator('#discard-confirmation')).toHaveCount(0);
  await expect(page.locator('#modal')).not.toBeVisible();
  await view(page, 'People');
  await page.getByRole('button', { name: 'Add person' }).click();
  await expect(page.locator('main #modal.inline-form')).toBeVisible();
  await page.getByLabel('Full name').fill('Inline Person');
  await page.getByLabel('Email', { exact: true }).fill('inline@example.com');
  await page.getByRole('button', { name: 'Save person' }).click();
  await expect(page.locator('.contacts-grid')).toContainText('Inline Person');
  await view(page, 'Calendar');
  await page.getByRole('button', { name: 'New event' }).click();
  await page.getByLabel('Event title').fill('Inline event');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.locator('.agenda')).toContainText('Inline event');
  await page.evaluate(() =>
    fetch('/api/ai/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Inkwell': '1' },
      body: '{}',
    }),
  );
  await page.route('**/api/ai/chat', (route) =>
    route.fulfill({ json: { answer: 'An inline draft' } }),
  );
  await page.locator('#assistant-toggle').click();
  await page.locator('#ai-prompt').fill('Write a greeting');
  await page.locator('#ai-submit').click();
  await page.getByRole('button', { name: 'Use as a draft' }).click();
  await expect(page.locator('#ai-panel')).not.toBeVisible();
  await expect(page.locator('main #modal.inline-form')).toBeVisible();
  await expect(page.locator('#compose-form textarea')).toHaveValue('An inline draft');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await view(page, 'Settings');
  await settingsSection(page, 'Forms');
  await page.getByLabel('Form presentation').selectOption('popup');
  await page.getByRole('button', { name: 'Save form preference' }).click();
  await expect(page.locator('#toast')).toContainText('Form preference saved');
  await settingsSection(page, 'Mail accounts');
  await page.getByRole('button', { name: 'Connect email' }).click();
  expect(await page.locator('#modal').evaluate((el) => el.matches(':modal'))).toBe(true);
});

test('theme preview, save, persistence, export, import validation and revert', async ({
  page,
}, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await settingsSection(page, 'Theme studio');
  await page.getByLabel('Starting palette').selectOption('Midnight');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(21, 26, 32)');
  await page.getByLabel('Theme name').fill('My midnight');
  await page.getByLabel('Corner radius').fill('18');
  await page.getByRole('button', { name: 'Save theme', exact: true }).click();
  await expect(page.locator('#theme-status')).toHaveText('Saved theme');
  await page.reload();
  await expect(page.locator('#page-title')).toContainText('Theme studio');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(21, 26, 32)');
  await expect(page.getByLabel('Theme name')).toHaveValue('My midnight');
  await expect(page.getByLabel('Corner radius')).toHaveValue('18');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export theme' }).click();
  expect((await download).suggestedFilename()).toBe('inkwell-theme.yaml');
  await page.locator('#theme-import').setInputFiles({
    name: 'unsafe.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ version: 1, theme: { background: 'url(https://evil.example)' } }),
    ),
  });
  await expect(page.locator('#toast')).toContainText('Colors must be');
  await page.locator('#theme-import').setInputFiles({
    name: 'custom.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ version: 1, theme: { name: 'Imported', accent: '#8844cc' } }),
    ),
  });
  await expect(page.getByLabel('Theme name')).toHaveValue('Imported');
  await page.getByRole('button', { name: 'Revert preview' }).click();
  await expect(page.getByLabel('Theme name')).toHaveValue('My midnight');
  await page.screenshot({ path: `test-results/${info.project.name}-theme.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]);
});

test('AI presets and subscription login status', async ({ page }) => {
  await settingsSection(page, 'AI assistant');
  await page.getByLabel('AI provider', { exact: true }).selectOption('openrouter');
  await expect(page.getByLabel('API base URL')).toHaveValue('https://openrouter.ai/api/v1');
  await page.getByLabel('AI provider', { exact: true }).selectOption('lmstudio');
  await expect(page.getByLabel('API base URL')).toHaveValue('http://127.0.0.1:1234/v1');
  await page.getByLabel('AI provider', { exact: true }).selectOption('codex');
  await expect(page.getByLabel('API key', { exact: true })).toBeDisabled();
  await page.route('**/api/ai/codex/status', (route) =>
    route.fulfill({ json: { available: true, message: 'ChatGPT login detected on the backend.' } }),
  );
  await page.getByRole('button', { name: 'Check Codex login' }).click();
  await expect(page.locator('#toast')).toContainText('ChatGPT login detected');
  await page.getByRole('button', { name: 'Save assistant' }).click();
  await expect(page.getByLabel('AI provider', { exact: true })).toHaveValue('codex');
  await page.getByLabel('AI provider', { exact: true }).selectOption('ollama');
  await page.getByRole('button', { name: 'Save assistant' }).click();
});
