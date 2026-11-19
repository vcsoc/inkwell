const { expect } = require('@playwright/test');
async function settingsSection(page, name) {
  const navigation = page.getByRole('navigation', { name: 'Settings sections', exact: true });
  await navigation.getByRole('link', { name, exact: true }).click();
  await expect(navigation.getByRole('link', { name, exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
}
async function selectEmailMenuAction(page, name) {
  const item = page.getByRole('menuitem', { name, exact: true, includeHidden: true });
  const panel = await item.evaluate((el) => el.closest('.submenu-panel')?.id);
  if (panel && !(await item.isVisible())) await page.locator(`[aria-controls="${panel}"]`).click();
  await item.click();
}
async function readerAction(page, name, menuName) {
  const button = page.locator('.reader-actions').getByRole('button', { name, exact: true });
  if (await button.isVisible()) await button.click();
  else {
    await page.locator('#reader-menu').click();
    await selectEmailMenuAction(page, menuName);
  }
}
async function sidebarClick(page, selector) {
  const railView = {
    '#rule-manager-link': 'rules',
    '#tag-manager-link': 'tags',
    '#settings': 'settings',
  }[selector];
  if (railView && (await page.locator('.app-rail').isVisible())) {
    await page.locator(`.app-rail [data-view="${railView}"]`).click();
    return;
  }
  await expect(page.locator(selector)).toBeAttached();
  if (!(await page.locator(selector).isVisible()) && (await page.locator('#menu').isVisible()))
    await page.locator('#menu').click();
  await page.locator(selector).click();
}
async function openRuleSection(page, id) {
  const section = page.locator('#' + id);
  if (!(await section.evaluate((el) => el.open))) await section.locator(':scope > summary').click();
}
module.exports = {
  settingsSection,
  selectEmailMenuAction,
  readerAction,
  sidebarClick,
  openRuleSection,
};
