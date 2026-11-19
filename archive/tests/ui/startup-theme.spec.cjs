const { test, expect } = require('@playwright/test');
async function api(page, method = 'GET', body) {
  return page.evaluate(
    async ({ method, body }) => {
      const r = await fetch('/api/preferences', {
        method,
        headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) throw Error(await r.text());
      return r.json();
    },
    { method, body },
  );
}
for (const [dark, background, rgb] of [
  [true, '#102030', 'rgb(16, 32, 48)'],
  [false, '#e4d0aa', 'rgb(228, 208, 170)'],
]) {
  test(`Saved ${dark ? 'dark' : 'light'} palette paints before workspace bootstrap completes`, async ({
    page,
  }) => {
    await page.goto('/');
    const original = await api(page);
    let release;
    const blocked = new Promise((resolve) => (release = resolve));
    try {
      await api(page, 'PUT', {
        ...original,
        theme: { ...original.theme, dark, background, name: '</script>";window.injected=true;//' },
      });
      await page.route('**/api/accounts', async (route) => {
        await blocked;
        await route.continue();
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('body')).toHaveCSS('background-color', rgb);
      await expect(page.locator('html')).toHaveCSS('color-scheme', dark ? 'dark' : 'light');
      expect(await page.evaluate(() => !!window.InkwellStartupThemeApplied)).toBe(true);
      expect(await page.evaluate(() => window.injected)).toBeUndefined();
      release();
      await expect(page.locator('#heading-compose')).toBeVisible();
      await expect(page.locator('body')).toHaveCSS('background-color', rgb);
    } finally {
      release();
      await api(page, 'PUT', original);
    }
  });
}
