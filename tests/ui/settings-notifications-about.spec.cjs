const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const defaultSound = readFileSync(join(__dirname, '../../inkwell/static/new-mail.wav'));

test('sound settings allow selecting, previewing and resetting a local WAV', async ({ page }) => {
  await page.goto('/#/settings/notifications');
  const settings = page.locator('#settings-notifications');
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('radio', { name: 'Inkwell chime' })).toBeChecked();
  await settings.getByRole('button', { name: 'Play Inkwell chime' }).click();
  const before = await page.evaluate(() => fetch('/api/mail-notifications').then((r) => r.json()));
  try {
    await settings.getByLabel('Enable new-mail sound').check();
    await settings.getByLabel('Notification scope').selectOption('pinned');
    await settings.getByRole('button', { name: 'Save notification settings' }).click();
    await expect
      .poll(() => page.evaluate(() => fetch('/api/mail-notifications').then((r) => r.json())))
      .toMatchObject({ enabled: true, scope: 'pinned' });
    await settings.locator('#notification-sound-file').setInputFiles([
      { name: 'batch-first.wav', mimeType: 'audio/wav', buffer: defaultSound },
      { name: 'my-alert.wav', mimeType: 'audio/wav', buffer: defaultSound },
    ]);
    await expect(settings.getByRole('radio', { name: 'batch-first.wav' })).toBeVisible();
    await expect(settings.getByRole('radio', { name: 'my-alert.wav' })).toBeChecked();
    await expect
      .poll(() => page.evaluate(() => fetch('/api/mail-notifications').then((r) => r.json())))
      .toMatchObject({ custom_sound: true });
    await page.reload();
    await expect(settings.getByRole('radio', { name: 'my-alert.wav' })).toBeChecked();
    await settings.locator('#notification-sound-file').setInputFiles({
      name: 'second.wav',
      mimeType: 'audio/wav',
      buffer: defaultSound,
    });
    await expect(settings.getByRole('radio', { name: 'second.wav' })).toBeChecked();
    await settings.getByRole('radio', { name: 'my-alert.wav' }).check();
    await settings.getByRole('button', { name: 'Play my-alert.wav' }).click();
    await settings.getByRole('button', { name: 'Use default sound' }).click();
    await expect(settings.getByRole('radio', { name: 'Inkwell chime' })).toBeChecked();
    await expect(settings.getByRole('radio', { name: 'second.wav' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => fetch('/api/mail-notifications').then((r) => r.json())))
      .toMatchObject({ custom_sound: false });
  } finally {
    await page.evaluate(async (original) => {
      for (const sound of await fetch('/api/mail-notifications/sounds').then((r) => r.json()))
        if (sound.id !== 'default')
          await fetch('/api/mail-notifications/sounds/' + sound.id, {
            method: 'DELETE',
            headers: { 'X-Inkwell': '1' },
          });
      await fetch('/api/mail-notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Inkwell': '1' },
        body: JSON.stringify({
          enabled: original.enabled,
          scope: original.scope,
          senders: original.senders,
        }),
      });
    }, before);
  }
});

test('About shows live version, build commit, developer and GitHub link', async ({ page }) => {
  await page.goto('/#/settings/about');
  const about = page.locator('#settings-about');
  await expect(about).toBeVisible();
  const info = await page.evaluate(() => fetch('/api/about').then((r) => r.json()));
  await expect(about.locator('#app-version')).toHaveText(info.version);
  await expect(about.locator('#app-commit')).toHaveText(info.commit);
  await expect(about.getByText('Developed by Chris Visser')).toBeVisible();
  const github = about.getByRole('link', { name: 'Inkwell on GitHub' });
  await expect(github).toHaveAttribute('href', 'https://github.com/vcsoc/inkwell');
  await expect(github.locator('svg')).toHaveCount(1);
});
