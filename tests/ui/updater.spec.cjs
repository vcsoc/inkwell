const { test, expect } = require('@playwright/test');

test('startup offers the update with tooltips; Later, Skip and manual checks behave correctly', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.inkwellUpdates = {
      onProgress(callback) {
        window.__updateProgress = callback;
        return () => {};
      },
      async check(manual) {
        return localStorage.getItem('test-skipped') && !manual
          ? { status: 'skipped', version: '9.9.9' }
          : { status: 'available', version: '9.9.9' };
      },
      async skip() {
        localStorage.setItem('test-skipped', '9.9.9');
        return { status: 'skipped' };
      },
      async install() {
        window.__updateProgress({ phase: 'download', percent: 45, detail: '45 / 100 MB' });
        await new Promise((resolve) => setTimeout(resolve, 150));
        window.__updateProgress({
          phase: 'install',
          percent: 78,
          detail: 'Bundled backend validated',
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { status: 'restart-needed' };
      },
    };
  });
  await page.goto('/#/settings/about');
  const notice = page.locator('#update-toast');
  await expect(notice).toBeVisible({ timeout: 4500 });
  await expect(notice.getByText('Inkwell 9.9.9 is available')).toBeVisible();
  await expect(notice.getByRole('button', { name: 'Update', exact: true })).toHaveAttribute(
    'title',
    /Download and verify/,
  );
  await expect(notice.getByRole('button', { name: 'Later' })).toHaveAttribute('title', /next time/);
  await expect(notice.getByRole('button', { name: 'Skip version' })).toHaveAttribute(
    'title',
    /specific version/,
  );
  await notice.getByRole('button', { name: 'Later' }).click();
  await expect(notice).toBeHidden();
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Skip version' }).click();
  await expect(notice).toBeHidden();
  await page.reload();
  await page.waitForTimeout(1650);
  await expect(notice).toBeHidden();
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(notice.locator('#update-progress')).toBeVisible();
  await expect(notice.locator('#update-detail')).toHaveText(
    /45 \/ 100 MB|Bundled backend validated|Your draft/,
  );
  await expect(notice.getByText('Update installed')).toBeVisible();
});
