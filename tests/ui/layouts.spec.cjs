const { test, expect } = require('@playwright/test');
const { settingsSection } = require('./helpers.cjs');
async function settings(page) {
  if (await page.locator('.mobile-tabs').isVisible())
    await page
      .locator('.mobile-tabs')
      .getByRole('button', { name: 'Settings', exact: true })
      .click();
  else await page.locator('#settings').click();
  await settingsSection(page, 'Layout');
}
async function inbox(page) {
  if (await page.locator('.mobile-tabs').isVisible())
    await page.locator('.mobile-tabs').getByRole('button', { name: 'Mail', exact: true }).click();
  else
    await page.locator('#navigation').getByRole('button', { name: 'Inbox', exact: true }).click();
}
test('saved layouts, three-pane reference, bottom reader and list-first', async ({
  page,
}, info) => {
  await page.goto('/');
  await expect(page.locator('#page-title')).toContainText('Your inbox');
  await page.evaluate(() => fetch('/api/demo', { method: 'POST', headers: { 'X-Inkwell': '1' } }));
  for (const layout of ['classic', 'stacked', 'list', 'focus']) {
    await settings(page);
    await page.getByLabel('Default mail layout').selectOption(layout);
    await page.getByRole('button', { name: 'Save layout', exact: true }).click();
    await expect(page.locator('#layout-status')).toHaveText('Saved default layout');
    // Saving a theme on a separate page must not reset the saved layout.
    await settingsSection(page, 'Theme studio');
    await page.getByRole('button', { name: 'Save theme', exact: true }).click();
    await expect(page.locator('#theme-status')).toHaveText('Saved theme');
    await page.reload();
    await expect(page.locator('#page-title')).toContainText('Theme studio');
    await inbox(page);
    await expect(page.locator('#page-title')).toContainText('Your inbox');
    await expect(page.locator('html')).toHaveAttribute('data-layout', layout);
    await expect(page.locator('.message-row')).toHaveCount(5);
    await page.locator('.message-row').first().click();
    await expect(page.locator('.message-body')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    if (info.project.name === 'desktop') {
      const list = await page.locator('.message-list').boundingBox();
      const reader = await page.locator('.reader').boundingBox();
      if (layout === 'classic') {
        await expect(page.locator('.app-rail')).toBeVisible();
        expect(reader.x).toBeGreaterThanOrEqual(list.x + list.width - 1);
        await page.screenshot({ path: 'test-results/classic-layout.png' });
      } else if (layout === 'stacked')
        expect(reader.y).toBeGreaterThanOrEqual(list.y + list.height - 1);
      else if (layout === 'list') await expect(page.locator('.message-list')).not.toBeVisible();
    } else {
      await expect(page.locator('.app-rail')).not.toBeVisible();
      await expect(page.locator('.message-list')).not.toBeVisible();
    }
    await page.getByRole('button', { name: 'Back to messages' }).click();
    await expect(page.locator('.message-list')).toBeVisible();
  }
  await settings(page);
  await page.getByLabel('Default mail layout').selectOption('classic');
  await page.getByRole('button', { name: 'Revert layout preview' }).click();
  await expect(page.getByLabel('Default mail layout')).toHaveValue('focus');
  await inbox(page);
});
