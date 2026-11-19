const { test, expect } = require('@playwright/test');

test('Classic inbox has a single top bar, folder-only sidebar, bottom rail profile and one shared footer', async ({
  page,
}, info) => {
  await page.goto('/');
  const original = await page.evaluate(() =>
    fetch('/api/preferences').then((response) => response.json()),
  );
  try {
    await page.evaluate(
      async (value) =>
        fetch('/api/preferences', {
          method: 'PUT',
          headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...value, layout: 'classic', sidebar_width: 276, ui_zoom: 100 }),
        }),
      original,
    );
    await page.setViewportSize(
      info.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1920, height: 965 },
    );
    await page.reload();
    await expect(page.locator('#topbar-heading #page-title')).toHaveText('your inbox.');
    await expect(page.locator('.page-heading')).toBeHidden();
    await expect(page.locator('.top-actions #heading-compose')).toBeVisible();
    const position = await page.evaluate(() => ({
      ask: document.querySelector('#assistant-toggle').getBoundingClientRect().right,
      compose: document.querySelector('#heading-compose').getBoundingClientRect().left,
      footer: document.querySelector('#app-footer').getBoundingClientRect().toJSON(),
      mail: document.querySelector('.mail-footer').getBoundingClientRect().toJSON(),
      sidebar: document.querySelector('#sidebar').getBoundingClientRect().toJSON(),
      navigation: document.querySelector('#navigation').getBoundingClientRect().toJSON(),
    }));
    expect(position.compose).toBeGreaterThanOrEqual(position.ask);
    expect(position.mail.top).toBeGreaterThanOrEqual(position.footer.top);
    expect(position.mail.bottom).toBeLessThanOrEqual(position.footer.bottom);
    await expect(page.locator('footer')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.screenshot({ path: `test-results/annotations-${info.project.name}.png` });
    await expect(page.locator('.pinned-empty')).toHaveCount(0);
    const help = page.locator('.pinned-help');
    await expect(help).toHaveAttribute('title', 'Right-click a folder to pin it here.');
    await expect(help).toHaveAttribute('aria-label', /Right-click a folder/);
    if (info.project.name !== 'mobile') {
      await expect(page.locator('.sidebar-bottom')).toBeHidden();
      await expect(page.locator('.app-rail [data-view="settings"]')).toBeVisible();
      await expect(page.locator('.app-rail [data-view="rules"]')).toBeVisible();
      await expect(page.locator('.app-rail [data-view="tags"]')).toBeVisible();
      await expect(page.locator('.rail-profile')).toBeVisible();
      expect(position.navigation.bottom).toBeGreaterThanOrEqual(position.sidebar.bottom - 4);
      expect(position.footer.left).toBeGreaterThanOrEqual(position.sidebar.right - 1);
      const profile = await page.locator('.rail-profile').boundingBox();
      expect(profile.y + profile.height).toBeGreaterThan(920);
      for (const width of [1000, 800]) {
        await page.setViewportSize({ width, height: 965 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
          false,
        );
        await expect(page.locator('#heading-compose')).toBeVisible();
      }
    } else {
      expect(position.footer.bottom).toBeLessThanOrEqual(844 - 64 + 1);
      await expect(page.locator('.app-rail')).toBeHidden();
    }
    await page.locator('#sync-progress').evaluate((badge) => {
      badge.textContent = 'Syncing Inbox · 2/12 folders';
      badge.hidden = false;
    });
    await expect(page.locator('.app-footer .sync-footer')).toBeVisible();
    await expect(page.locator('.app-footer .mail-footer')).toBeVisible();
    await expect(page.locator('footer')).toHaveCount(1);
    if (info.project.name !== 'mobile') {
      await page.locator('.app-rail [data-view="settings"]').click();
      await expect(page.locator('#page-heading-text #page-title')).toBeVisible();
      await expect(page.locator('.page-heading')).toBeVisible();
      await expect(page.locator('.app-footer .mail-footer')).toBeHidden();
    }
  } finally {
    await page.evaluate(
      async (value) =>
        fetch('/api/preferences', {
          method: 'PUT',
          headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
        }),
      original,
    );
  }
});
