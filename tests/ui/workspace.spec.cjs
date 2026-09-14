const { test, expect } = require('@playwright/test');
const { settingsSection } = require('./helpers.cjs');
async function view(page, name) {
  const tabs = page.locator('.mobile-tabs');
  if (await tabs.isVisible()) await tabs.getByRole('button', { name, exact: true }).click();
  else if (name === 'Settings') await page.locator('#settings').click();
  else await page.locator('#navigation').getByRole('button', { name, exact: true }).click();
}
test('demo mail, reading, draft, search and no horizontal overflow', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await view(page, 'Settings');
  await settingsSection(page, 'Privacy & data');
  await page.getByRole('button', { name: 'Explore sample workspace' }).click();
  await expect(page.locator('.message-row')).toHaveCount(5);
  await page.locator('.message-row').first().click();
  await expect(page.locator('.message-body')).toContainText('Welcome to inkwell');
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(page.locator('input[name="recipient"]')).toHaveValue('maya@example.com');
  await page.locator('textarea[name="body"]').fill('Thanks! This looks lovely.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await page.getByRole('button', { name: 'Back to messages' }).click();
  await page.locator('#global-search').fill('typography');
  await expect(page.locator('.message-row')).toHaveCount(1);
  await expect(page.locator('.subject')).toContainText('Design review');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
  await page.locator('#global-search').fill('');
  await expect(page.locator('.message-row')).toHaveCount(5);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-inbox.png`,
    fullPage: true,
  });
});
test('calendar and contacts CRUD', async ({ page }, testInfo) => {
  await page.goto('/');
  await view(page, 'Calendar');
  await page.getByRole('button', { name: 'New event' }).click();
  await page
    .getByRole('textbox', { name: 'Event title' })
    .fill('Planning ' + testInfo.project.name);
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await expect(page.locator('.agenda')).toContainText('Planning ' + testInfo.project.name);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-calendar.png`,
    fullPage: true,
  });
  await view(page, 'People');
  await page.getByRole('button', { name: 'Add person' }).click();
  await page.getByRole('textbox', { name: 'Full name' }).fill('UI Test ' + testInfo.project.name);
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('ui@example.com');
  await page.getByRole('button', { name: 'Save person', exact: true }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  const card = page
    .locator('.contact-card')
    .filter({ hasText: 'UI Test ' + testInfo.project.name });
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete person' }).click();
  await expect(card).toHaveCount(0);
});
test('assistant settings and safe rendering', async ({ page }) => {
  await page.goto('/');
  await view(page, 'Settings');
  await settingsSection(page, 'AI assistant');
  await page.getByRole('textbox', { name: 'Model', exact: true }).fill('test-model');
  await page.getByRole('button', { name: 'Save assistant' }).click();
  await expect(page.getByRole('textbox', { name: 'Model', exact: true })).toHaveValue('test-model');
  await page.locator('#assistant-toggle').click();
  await expect(page.locator('#ai-context')).not.toBeChecked();
  await page.route('**/api/ai/chat', (route) =>
    route.fulfill({ json: { answer: '<img src=x onerror=alert(1)> A safe draft.' } }),
  );
  await page.locator('#ai-prompt').fill('Write a greeting');
  await page.locator('#ai-submit').click();
  await expect(page.locator('#ai-answer')).toContainText('<img src=x');
  await expect(page.locator('#ai-answer img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Use as a draft' }).click();
  await expect(page.locator('textarea[name="body"]')).toHaveValue(
    '<img src=x onerror=alert(1)> A safe draft.',
  );
});
