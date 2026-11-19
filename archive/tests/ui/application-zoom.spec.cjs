const { test, expect } = require('@playwright/test');

test('Ctrl+Plus, Ctrl+Minus and Ctrl+0 zoom the entire app while typing and persist after reload', async ({
  page,
}) => {
  await page.goto('/');
  const api = (path, method = 'GET', body) =>
    page.evaluate(
      async ({ path, method, body }) => {
        const response = await fetch('/api' + path, {
          method,
          headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!response.ok) throw Error(await response.text());
        return response.json();
      },
      { path, method, body },
    );
  const original = await api('/preferences');
  try {
    await api('/preferences', 'PUT', { ...original, ui_zoom: 100 });
    await page.reload();
    await page.locator('#global-search').focus();
    await page.keyboard.press('ControlOrMeta+=');
    await expect(page.locator('html')).toHaveCSS('zoom', '1.1');
    await page.keyboard.press('ControlOrMeta+Shift+Equal');
    await expect(page.locator('html')).toHaveCSS('zoom', '1.2');
    await page.keyboard.press('ControlOrMeta+-');
    await expect(page.locator('html')).toHaveCSS('zoom', '1.1');
    await expect.poll(async () => (await api('/preferences')).ui_zoom).toBe(110);
    await page.reload();
    await expect(page.locator('html')).toHaveCSS('zoom', '1.1');
    await page.keyboard.press('ControlOrMeta+0');
    await expect(page.locator('html')).toHaveCSS('zoom', '1');
    await expect.poll(async () => (await api('/preferences')).ui_zoom).toBe(100);
  } finally {
    await api('/preferences', 'PUT', original);
  }
});
