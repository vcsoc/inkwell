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

test('today’s agenda is highlighted and scrolled into view, with a visible shared footer', async ({
  page,
}, info) => {
  await page.setViewportSize(
    info.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1703, height: 1059 },
  );
  await page.goto('/#/calendar');
  const created = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const add = async (day, title) => {
    const start = new Date(day.getTime() + 10 * 3600000);
    const response = await page.evaluate(
      async (body) => {
        const result = await fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Inkwell': '1' },
          body: JSON.stringify(body),
        });
        return result.json();
      },
      {
        title,
        start: start.toISOString(),
        end: new Date(start.getTime() + 3600000).toISOString(),
        timezone: 'UTC',
      },
    );
    created.push(response.id);
  };
  try {
    for (let day = 1; day < today.getDate(); day++)
      await add(new Date(today.getFullYear(), today.getMonth(), day), `Earlier agenda ${day}`);
    await add(today, 'Today appointment alpha');
    await add(today, 'Today appointment beta');
    await page.reload();
    await page.getByRole('button', { name: 'Expand monthly agenda' }).click();
    const marked = page
      .locator('#calendar-agenda .agenda-row.is-today')
      .filter({ hasText: 'Today appointment' });
    await expect(marked).toHaveCount(2);
    await expect(marked.first()).toContainText('Today appointment');
    const firstToday = page.locator('#calendar-agenda .agenda-row.is-today').first();
    await expect
      .poll(() =>
        firstToday.evaluate((row) => {
          const bounds = row.getBoundingClientRect(),
            panel = document.querySelector('#calendar-agenda').getBoundingClientRect();
          return bounds.top >= panel.top && bounds.bottom <= panel.bottom;
        }),
      )
      .toBe(true);
    expect(
      await page.locator('#calendar-agenda').evaluate((panel) => panel.scrollTop),
    ).toBeGreaterThan(0);
    expect(await marked.first().evaluate((row) => getComputedStyle(row).backgroundColor)).not.toBe(
      await page
        .locator('#calendar-agenda .agenda-row:not(.is-today)')
        .first()
        .evaluate((row) => getComputedStyle(row).backgroundColor),
    );
    await expect(page.locator('.calendar-important-note strong')).toHaveText('Important');
    await expect(page.locator('#calendar-footer-status')).toContainText(/\d+ items planned today/);
    await expect(page.locator('#app-footer')).toBeVisible();
    const footer = await page.locator('#app-footer').boundingBox();
    expect(footer.y + footer.height).toBeLessThanOrEqual(
      info.project.name === 'mobile' ? 844 - 64 + 1 : 1060,
    );
    await expect(page.locator('#agenda-toggle svg')).toBeVisible();
    expect(
      await page
        .locator('#agenda-toggle')
        .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(17);
    if (info.project.name === 'desktop') {
      const search = await page.locator('#global-search').boundingBox();
      const date = await page.locator('#search-date-from').boundingBox();
      expect(date.width).toBeLessThanOrEqual(120);
      expect(search.width).toBeGreaterThan(date.width);
    }
  } finally {
    for (const id of created)
      await page.evaluate(
        async (id) =>
          fetch('/api/events/' + id, { method: 'DELETE', headers: { 'X-Inkwell': '1' } }),
        id,
      );
  }
});

test('Quick filter icons occupy the first row at the far right and open compact controls', async ({
  page,
}) => {
  await page.goto('/#/inbox');
  const unread = page.locator('[data-filter="unread"]');
  const button = page.getByRole('button', { name: 'Filter and display options' });
  const filters = page.locator('#quick-filter');
  await expect(button.locator('svg')).toHaveCount(1);
  await expect(button).toHaveAttribute('title', 'Filter and display options');
  const tabBox = await unread.boundingBox();
  const buttonBox = await button.boundingBox();
  expect(Math.abs(tabBox.y - buttonBox.y)).toBeLessThan(12);
  expect(buttonBox.x).toBeGreaterThan(tabBox.x + tabBox.width + 15);
  await expect(page.locator('.quick-action-buttons .quick-icon')).toHaveCount(7);
  await expect(filters).toBeHidden();
  await button.click();
  await expect(filters).toBeVisible();
  await expect(page.locator('#quick-sort')).toBeVisible();
  await button.click();
  await expect(filters).toBeHidden();
  await expect(page.locator('.quick-action-buttons')).toBeVisible();
  await button.click();
  await expect(filters).toBeVisible();
});
