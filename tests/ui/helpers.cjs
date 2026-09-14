const { expect } = require('@playwright/test');
async function settingsSection(page, name) {
  const navigation = page.getByRole('navigation', { name: 'Settings sections', exact: true });
  await navigation.getByRole('link', { name, exact: true }).click();
  await expect(navigation.getByRole('link', { name, exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
}
module.exports = { settingsSection };
