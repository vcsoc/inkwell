const { test, expect } = require('@playwright/test');

test('Classic calendar fills the pane and keeps the agenda accessible at narrow desktop widths', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'mobile', 'Desktop rail and split-pane geometry');
  await page.goto('/');
  const original = await page.evaluate(() => fetch('/api/preferences').then((r) => r.json()));
  try {
    await page.evaluate(
      (value) =>
        fetch('/api/preferences', {
          method: 'PUT',
          headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...value, layout: 'classic', ui_zoom: 100 }),
        }),
      original,
    );
    await page.goto('/#/calendar');
    await page.reload();
    await expect(page.locator('.app-rail')).toBeVisible();
    for (const width of [1920, 1050, 800]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await page.evaluate(() => ({
        grid: document.querySelector('.calendar-grid').getBoundingClientRect().toJSON(),
        sidebar: document.querySelector('#sidebar').getBoundingClientRect().toJSON(),
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      expect(geometry.overflow).toBe(false);
      expect(geometry.grid.left).toBeGreaterThanOrEqual(geometry.sidebar.right - 1);
      expect(geometry.grid.bottom).toBeGreaterThan(840);
      await expect(page.getByRole('button', { name: 'Expand monthly agenda' })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Expand monthly agenda' }).click();
    await expect(page.locator('#calendar-agenda')).toBeVisible();
    await page.screenshot({ path: 'test-results/calendar-classic-agenda.png' });
  } finally {
    await page.evaluate(
      (value) =>
        fetch('/api/preferences', {
          method: 'PUT',
          headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
        }),
      original,
    );
  }
});
