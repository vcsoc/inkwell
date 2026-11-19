const { test, expect } = require('@playwright/test');

test('Microsoft webmail is a clearly labelled no-ID external option, not a fake account connection', async ({
  page,
}) => {
  const writes = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      /\/api\/(accounts|microsoft\/begin)$/.test(new URL(request.url()).pathname)
    )
      writes.push(request.url());
  });
  await page.goto('/#/settings/mail');
  await expect(page.getByRole('link', { name: 'Open Outlook.com webmail' })).toHaveAttribute(
    'href',
    'https://outlook.live.com/mail/',
  );
  await expect(page.getByRole('link', { name: 'Open Microsoft 365 webmail' })).toHaveAttribute(
    'href',
    'https://outlook.office.com/mail/',
  );
  await expect(page.locator('#settings-mail')).toContainText('instead of connecting it to inkwell');
  await page.getByRole('button', { name: 'Connect email' }).click();
  for (const [provider, url] of [
    ['outlookweb', 'https://outlook.live.com/mail/'],
    ['microsoft365web', 'https://outlook.office.com/mail/'],
  ]) {
    await page.getByLabel('Quick setup').selectOption(provider);
    await expect(page.locator('#webmail-account-fields')).toBeVisible();
    await expect(page.locator('#open-webmail')).toHaveAttribute('href', url);
    await expect(page.locator('#open-webmail')).toHaveAttribute('target', '_blank');
    await expect(page.locator('#open-webmail')).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(page.getByLabel('Microsoft application client ID')).not.toBeVisible();
    await expect(page.getByLabel('App password', { exact: true })).not.toBeVisible();
    await expect(page.locator('#account-form button[type=submit]')).not.toBeVisible();
    await page
      .locator('#account-form')
      .evaluate((form) =>
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
      );
    expect(writes).toEqual([]);
  }
  await page.getByLabel('Quick setup').selectOption('gmail');
  await expect(page.locator('#webmail-account-fields')).not.toBeVisible();
  await expect(page.getByLabel('App password', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save account', exact: true })).toBeVisible();
  await expect(page.getByLabel('SMTP server', { exact: true })).toHaveValue('smtp.gmail.com');
});
