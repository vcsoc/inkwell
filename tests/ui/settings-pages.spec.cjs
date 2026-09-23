const { test, expect } = require('@playwright/test');
const { settingsSection } = require('./helpers.cjs');
const pages = [
  ['shortcuts', 'Shortcuts', '#shortcut-form'],
  ['rules', 'Mail rules', '#rule-form'],
  ['layout', 'Layout', '#layout-settings'],
  ['forms', 'Forms', '#form-mode-settings'],
  ['theme', 'Theme studio', '#theme-editor'],
  ['mail', 'Mail accounts', '#settings-mail'],
  ['notifications', 'Notifications', '#settings-notifications'],
  ['about', 'About', '#settings-about'],
  ['assistant', 'AI assistant', '#ai-settings'],
  ['privacy', 'Privacy & data', '#privacy-card'],
];

test('settings hub links mount only their dedicated feature page', async ({ page }, info) => {
  await page.goto('/#/settings');
  await expect(page.locator('#page-title')).toHaveText('Settings.');
  await expect(page.locator('.settings-category')).toHaveCount(pages.length);
  await expect(page.locator('#settings-content form')).toHaveCount(0);
  await page
    .locator('.settings-overview')
    .getByRole('link', { name: 'Forms', exact: true })
    .click();
  await expect(page).toHaveURL(/#\/settings\/forms$/);
  for (const [id, name, selector] of pages) {
    await settingsSection(page, name);
    await expect(page).toHaveURL(new RegExp('#/settings/' + id + '$'));
    await expect(page.locator('#page-title')).toHaveText(name + '.');
    await expect(page.locator(selector)).toBeVisible();
    for (const [otherId, , otherSelector] of pages)
      if (otherId !== id) await expect(page.locator(otherSelector)).toHaveCount(0);
    expect(await page.evaluate(() => scrollY)).toBe(0);
  }
  await settingsSection(page, 'All settings');
  await expect(page.locator('.settings-category')).toHaveCount(pages.length);
  await page.screenshot({
    path: `test-results/${info.project.name}-settings-pages.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

for (const [id, name, selector] of pages) {
  test(`settings/${id} supports direct links and reload`, async ({ page }) => {
    await page.goto('/#/settings/' + id);
    await expect(page.locator(selector)).toBeVisible();
    await expect(page.locator('#page-title')).toHaveText(name + '.');
    await page.reload();
    await expect(page).toHaveURL(new RegExp('#/settings/' + id + '$'));
    await expect(page.locator(selector)).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Settings sections' })
        .getByRole('link', { name, exact: true }),
    ).toHaveAttribute('aria-current', 'page');
  });
}

test('settings back and forward restore the right page, not a scroll position', async ({
  page,
}) => {
  await page.goto('/#/settings/layout');
  await expect(page.locator('#layout-settings')).toBeVisible();
  await settingsSection(page, 'Forms');
  await settingsSection(page, 'Theme studio');
  await page.goBack();
  await expect(page).toHaveURL(/#\/settings\/forms$/);
  await expect(page.locator('#form-mode-settings')).toBeVisible();
  await expect(page.locator('#theme-editor')).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(/#\/settings\/theme$/);
  await expect(page.locator('#theme-editor')).toBeVisible();
  await settingsSection(page, 'All settings');
  await page.goBack();
  await expect(page.locator('#theme-editor')).toBeVisible();
});

test('leaving a theme page discards its unsaved preview without changing preferences', async ({
  page,
}) => {
  await page.goto('/#/settings/theme');
  await expect(page.locator('#theme-editor')).toBeVisible();
  const original = await page.evaluate(async () => {
    const response = await fetch('/api/preferences');
    return response.json();
  });
  await page.getByLabel('Starting palette').selectOption('Midnight');
  await page.getByLabel('Theme name').fill('Unsaved preview');
  await settingsSection(page, 'Forms');
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--bg'))).toBe(
    original.theme.background,
  );
  await page.goBack();
  await expect(page.getByLabel('Theme name')).toHaveValue(original.theme.name);
  const persisted = await page.evaluate(async () => {
    const response = await fetch('/api/preferences');
    return response.json();
  });
  expect(persisted).toEqual(original);
});

test('late provider responses cannot replace a different settings sub-page', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page.locator('.settings-overview')).toBeVisible();
  let release,
    intercepted = false;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/ai/config', async (route) => {
    intercepted = true;
    await gate;
    await route.fulfill({ json: { model: 'stale-model' } });
  });
  await settingsSection(page, 'AI assistant');
  await expect.poll(() => intercepted).toBe(true);
  await settingsSection(page, 'Forms');
  const response = page.waitForResponse('**/api/ai/config');
  release();
  await (await response).finished();
  await expect(page.locator('#form-mode-settings')).toBeVisible();
  await expect(page.locator('#ai-settings')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/settings\/forms$/);
});
