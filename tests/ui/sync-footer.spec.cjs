const { test, expect } = require('@playwright/test');

for (const layout of ['focus', 'classic', 'stacked', 'list']) {
  test(`sync status stays in the main footer, clear of the folder sidebar (${layout})`, async ({
    page,
  }, info) => {
    await page.goto('/');
    const original = await page.evaluate(
      async () => await (await fetch('/api/preferences')).json(),
    );
    const save = (value) =>
      page.evaluate(
        async (value) =>
          fetch('/api/preferences', {
            method: 'PUT',
            headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
            body: JSON.stringify(value),
          }),
        value,
      );
    try {
      await save({ ...original, layout, sidebar_width: 350, ui_zoom: 100 });
      await page.setViewportSize(
        info.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      );
      await page.goto('/#/rules');
      await page.reload();
      const footer = page.locator('#sync-progress');
      await expect(footer).toHaveJSProperty('hidden', true);
      await footer.evaluate((element) => {
        element.textContent = 'Syncing Inbox · 4/12 folders · 6 new';
        element.hidden = false;
      });
      await expect(footer).toBeVisible();
      expect(await page.locator('.page-heading #sync-progress').count()).toBe(0);
      const bounds = await page.evaluate(() => {
        const footer = document.querySelector('#sync-progress').getBoundingClientRect();
        const sidebar = document.querySelector('#sidebar').getBoundingClientRect();
        return {
          footer: { left: footer.left, right: footer.right, bottom: footer.bottom },
          sidebar: { right: sidebar.right },
          height: innerHeight,
          width: innerWidth,
        };
      });
      if (info.project.name !== 'mobile') {
        expect(bounds.footer.left).toBeGreaterThanOrEqual(bounds.sidebar.right - 1);
        expect(Math.abs(bounds.footer.bottom - bounds.height)).toBeLessThan(2);
        const resized = await page.evaluate(() => {
          document.documentElement.style.setProperty('--sidebar-width', '420px');
          return {
            left: document.querySelector('#sync-progress').getBoundingClientRect().left,
            sidebarRight: document.querySelector('#sidebar').getBoundingClientRect().right,
          };
        });
        expect(Math.abs(resized.left - resized.sidebarRight)).toBeLessThan(2);
      } else {
        expect(bounds.footer.left).toBe(0);
        expect(Math.abs(bounds.footer.bottom - (bounds.height - 64))).toBeLessThan(2);
      }
      expect(Math.abs(bounds.footer.right - bounds.width)).toBeLessThan(2);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await expect(footer).toBeInViewport();
      if (['classic', 'stacked'].includes(layout)) {
        await page.goto('/#/inbox');
        await footer.evaluate((element) => {
          element.textContent = 'Syncing inbox';
          element.hidden = false;
        });
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        const mail = await page.evaluate(() => ({
          footerTop: document.querySelector('#sync-progress').getBoundingClientRect().top,
          mailBottom: document.querySelector('.mail-footer').getBoundingClientRect().bottom,
        }));
        expect(mail.mailBottom).toBeLessThanOrEqual(mail.footerTop + 1);
      }
    } finally {
      await save(original);
    }
  });
}
