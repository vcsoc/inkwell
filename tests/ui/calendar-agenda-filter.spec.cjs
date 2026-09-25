const { test, expect } = require('@playwright/test');

test('calendar maximizes the viewport and opens its agenda only when requested', async ({
  page,
}, info) => {
  await page.setViewportSize(
    info.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  );
  await page.goto('/#/calendar');
  await expect(page.locator('#topbar-heading #page-title')).toHaveText('calendar.');
  await expect(page.locator('.page-heading')).toBeHidden();
  await expect(page.locator('#range-hint')).toHaveClass('sr-only');
  expect(
    await page.locator('#range-hint').evaluate((el) => el.getBoundingClientRect().height),
  ).toBeLessThanOrEqual(1);
  const toggle = page.getByRole('button', { name: 'Expand monthly agenda' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#calendar-agenda')).toBeHidden();
  const closed = await page.evaluate(() => ({
    grid: document.querySelector('.calendar-grid').getBoundingClientRect().toJSON(),
    workspace: document.querySelector('#workspace').getBoundingClientRect().toJSON(),
    rail: document.querySelector('.calendar-agenda-panel').getBoundingClientRect().toJSON(),
    viewport: innerHeight,
  }));
  expect(closed.grid.height).toBeGreaterThan(info.project.name === 'mobile' ? 330 : 620);
  expect(closed.grid.bottom).toBeLessThanOrEqual(closed.workspace.bottom + 1);
  expect(closed.workspace.bottom).toBeLessThanOrEqual(closed.viewport);
  expect(closed.rail.width).toBeLessThanOrEqual(40);
  await toggle.click();
  const expanded = page.getByRole('button', { name: 'Collapse monthly agenda' });
  await expect(expanded).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#calendar-agenda')).toBeVisible();
  await expect(page.locator('#calendar-agenda a[download]')).toHaveAttribute(
    'href',
    '/api/calendar.ics',
  );
  if (info.project.name !== 'mobile') {
    const openGridWidth = await page
      .locator('.calendar-grid')
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(openGridWidth).toBeLessThan(closed.grid.width - 150);
  }
  if (info.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Collapse monthly agenda' }).click();
    await page.locator('#month-next').click();
    await page.getByRole('button', { name: 'Expand monthly agenda' }).click();
  } else {
    await page.locator('#month-next').click();
  }
  await expect(page.locator('#calendar-agenda')).toBeVisible();
  await page.getByRole('button', { name: 'Collapse monthly agenda' }).click();
  await expect(page.locator('#calendar-agenda')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Expand monthly agenda' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: `test-results/calendar-panel-${info.project.name}.png` });
});

test('Quick filter icon follows Unread and uses the same tab treatment', async ({ page }) => {
  await page.goto('/#/inbox');
  const tabs = page.locator('.filter-tabs');
  const button = tabs.getByRole('button', { name: 'Quick filter' });
  await expect(button).toHaveClass(/filter-tab/);
  await expect(button.locator('svg')).toHaveCount(1);
  await expect(button).toHaveAttribute('title', 'Show or hide quick filters');
  expect(await button.evaluate((el) => el.previousElementSibling?.dataset.filter)).toBe('unread');
  const filter = page.locator('#quick-filter');
  await expect(filter).toBeVisible();
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(button).not.toHaveClass(/active/);
  await expect(filter).toBeHidden();
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(button).toHaveClass(/active/);
  await expect(filter).toBeVisible();
});
