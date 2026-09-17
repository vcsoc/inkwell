const { test, expect } = require('@playwright/test');
let original;
test.beforeEach(async ({ page }) => {
  await page.goto('/#/settings/theme');
  await expect(page.locator('#theme-editor')).toBeVisible();
  original = await page.evaluate(async () => (await fetch('/api/preferences')).json());
});
test.afterEach(async ({ page }) => {
  await page.evaluate(
    (value) =>
      fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      }),
    original,
  );
});

test('readable defaults, separate sidebar fonts and genuinely compact spacing persist', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Reset to Sage' }).click();
  await expect(page.getByLabel('Text size', { exact: true })).toHaveValue('16');
  await expect(page.getByLabel('Sidebar text size', { exact: true })).toHaveValue('16');
  await page.getByLabel('Sidebar text size', { exact: true }).fill('19');
  await page.getByRole('combobox', { name: 'Sidebar font', exact: true }).selectOption('mono');
  await page.getByLabel('Sidebar spacing (%)', { exact: true }).fill('50');
  await page.getByLabel('Layout spacing (%)', { exact: true }).fill('80');
  const row = page.locator('#navigation [data-view=inbox]');
  const comfortable = await row.evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
  await page.getByRole('combobox', { name: 'Density', exact: true }).selectOption('compact');
  const compact = await row.evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
  expect(compact).toBeLessThan(comfortable / 2);
  await expect(row).toHaveCSS('font-size', '19px');
  await page.getByRole('button', { name: 'Save theme', exact: true }).click();
  await expect(page.locator('#theme-status')).toHaveText('Saved theme');
  await page.reload();
  await expect(page.getByLabel('Sidebar text size', { exact: true })).toHaveValue('19');
  await expect(page.getByRole('combobox', { name: 'Sidebar font', exact: true })).toHaveValue(
    'mono',
  );
  await expect(page.getByLabel('Sidebar spacing (%)', { exact: true })).toHaveValue('50');
  await expect(page.getByLabel('Layout spacing (%)', { exact: true })).toHaveValue('80');
});

test('every theme color has a compact right-hand dropdown without changing form height', async ({
  page,
}, info) => {
  const fields = page.locator('#theme-editor .color-field');
  for (let i = 0; i < (await fields.count()); i++) {
    const field = fields.nth(i),
      trigger = field.locator('.theme-color-trigger');
    await trigger.scrollIntoViewIfNeeded();
    const before = await field.boundingBox();
    await trigger.click();
    await expect(field.locator('[popover]')).toBeVisible();
    expect((await field.boundingBox()).height).toBe(before.height);
    expect(await page.locator('.theme-color-popup:popover-open').count()).toBe(1);
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => (document.documentElement.style.zoom = '1.5'));
  const trigger = page.getByRole('button', { name: 'Choose background color', exact: true });
  await trigger.click();
  const popup = page.getByRole('group', { name: 'Background color picker', exact: true });
  expect(
    await popup.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1;
    }),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await page.evaluate(() => (document.documentElement.style.zoom = '1'));
  await trigger.click();
  await page.screenshot({
    path: `test-results/${info.project.name}-theme-color-dropdown.png`,
    fullPage: false,
  });
});

test('YAML round trip, safe rejection and color picker stay inside the application', async ({
  page,
}) => {
  await page.locator('#theme-import').setInputFiles({
    name: 'custom.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(
      'version: 1\ntheme:\n  name: "YAML palette"\n  background: "#123456"\n  sidebar_font_size: 18\n  sidebar_spacing: 60\n',
    ),
  });
  await expect(page.getByLabel('Theme name')).toHaveValue('YAML palette');
  await expect(page.getByLabel('Background color', { exact: true })).toHaveValue('#123456');
  await expect(page.locator('input[type=color]')).toHaveCount(0);
  const trigger = page.getByRole('button', { name: 'Choose background color', exact: true });
  const hex = page.getByLabel('Background color', { exact: true });
  const fieldBox = await hex.boundingBox(),
    triggerBox = await trigger.boundingBox();
  expect(Math.abs(fieldBox.y - triggerBox.y)).toBeLessThan(2);
  expect(triggerBox.x).toBeGreaterThanOrEqual(fieldBox.x + fieldBox.width - 2);
  await trigger.click();
  const popup = page.getByRole('group', { name: 'Background color picker', exact: true });
  await expect(popup).toBeVisible();
  await popup.getByRole('button', { name: 'Set Background color to #2664a0', exact: true }).click();
  await expect(hex).toHaveValue('#2664a0');
  const plane = popup.getByRole('slider', {
    name: 'Background color saturation and brightness',
    exact: true,
  });
  await plane.focus();
  await plane.press('ArrowLeft');
  await expect(hex).not.toHaveValue('#2664a0');
  await popup.getByRole('button', { name: 'Set Background color to #2664a0', exact: true }).click();
  expect(await popup.evaluate((el) => el.getBoundingClientRect().right <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(popup).not.toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export theme', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('inkwell-theme.yaml');
  await page.locator('#theme-import').setInputFiles(await file.path());
  await expect(page.getByLabel('Theme name')).toHaveValue('YAML palette');
  await expect(page.getByLabel('Background color', { exact: true })).toHaveValue('#2664a0');
  await page.locator('#theme-import').setInputFiles({
    name: 'bad.yml',
    mimeType: 'application/yaml',
    buffer: Buffer.from('version: 1\ntheme:\n  name: *unsafe\n'),
  });
  await expect(page.locator('#toast')).toContainText('aliases are not supported');
  await expect(page.getByLabel('Theme name')).toHaveValue('YAML palette');
  await page.getByLabel('Export format').selectOption('json');
  const json = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export theme', exact: true }).click();
  expect((await json).suggestedFilename()).toBe('inkwell-theme.json');
});

test('internal calendar editor sits to the right when wide and preserves edits on resize', async ({
  page,
}, info) => {
  await page.evaluate(
    (value) =>
      fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...value, form_mode: 'inline' }),
      }),
    original,
  );
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/#/calendar');
  await page.reload();
  await page.getByRole('button', { name: 'New event' }).click();
  await expect(page.locator('#calendar-editor-layout > #workspace')).toBeVisible();
  await expect(page.locator('#event-form')).toBeVisible();
  const calendar = await page.locator('#calendar-editor-layout > #workspace').boundingBox();
  const editor = await page.locator('#modal').boundingBox();
  expect(editor.x).toBeGreaterThan(calendar.x + calendar.width);
  const title = 'Side calendar ' + info.project.name + ' ' + Date.now();
  await page.getByLabel('Event title', { exact: true }).fill(title);
  await page.locator('.calendar-day:not(.outside) [data-day]').first().click();
  await expect(page.locator('#discard-confirmation')).toHaveCount(0);
  await expect(page.getByLabel('Event title', { exact: true })).toHaveValue('');
  await page.getByLabel('Event title', { exact: true }).fill(title);
  await page.screenshot({
    path: `test-results/${info.project.name}-calendar-side-editor.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 700, height: 900 });
  await expect(page.locator('#calendar-editor-layout > #workspace')).not.toBeVisible();
  await expect(page.getByLabel('Event title', { exact: true })).toHaveValue(title);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(page.locator('#calendar-editor-layout > #workspace')).toBeVisible();
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  await expect(page.locator('#calendar-editor-layout')).toHaveCount(0);
  await page.locator('.agenda-row').filter({ hasText: title }).click();
  await expect(page.locator('#calendar-editor-layout > #workspace')).toBeVisible();
  await expect(page.getByLabel('Event title', { exact: true })).toHaveValue(title);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await page.evaluate(async (title) => {
    const events = await (await fetch('/api/events')).json();
    for (const event of events)
      if (event.title === title)
        await fetch('/api/events/' + event.id, { method: 'DELETE', headers: { 'X-Inkwell': '1' } });
  }, title);
});
