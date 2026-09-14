const { test, expect } = require('@playwright/test');
let preferences,
  ruleId,
  folderId,
  eventIds = [];
async function api(page, url, method = 'GET', body) {
  return page.evaluate(
    async ({ url, method, body }) => {
      const response = await fetch('/api' + url, {
        method,
        headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw Error(await response.text());
      return response.json();
    },
    { url, method, body },
  );
}
test.beforeEach(async ({ page }) => {
  ruleId = folderId = null;
  eventIds = [];
  await page.goto('/');
  preferences = await api(page, '/preferences');
  await api(page, '/preferences', 'PUT', { ...preferences, form_mode: 'popup', ui_zoom: 100 });
  await page.reload();
  await expect(page.locator('.mail-shell')).toBeVisible();
});
test.afterEach(async ({ page }) => {
  for (const id of eventIds) await api(page, '/events/' + id, 'DELETE');
  if (ruleId) await api(page, '/rules/' + ruleId, 'DELETE');
  if (folderId) await api(page, '/local-folders/' + folderId, 'DELETE');
  await api(page, '/preferences', 'PUT', preferences);
});

test('one live search uses two-character minimum and clearing restores mail', async ({ page }) => {
  await api(page, '/demo', 'POST');
  await page.reload();
  await expect(page.locator('.message-row')).toHaveCount(5);
  await expect(page.locator('#search')).toHaveCount(0);
  await expect(page.locator('input[type=search]')).toHaveCount(1);
  const queries = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/messages?'))
      queries.push(new URL(request.url()).searchParams.get('q'));
  });
  await page.locator('#global-search').fill('x');
  await page.waitForTimeout(350);
  expect(queries).toEqual([]);
  await page.locator('#global-search').fill('typography');
  await expect(page.locator('.message-row')).toHaveCount(1);
  await page.locator('#global-search').fill('');
  await expect(page.locator('.message-row')).toHaveCount(5);
  let release;
  const hold = new Promise((resolve) => (release = resolve));
  await page.route('**/api/messages?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('q') === 'slow') await hold;
    await route.continue();
  });
  await page.locator('#global-search').fill('slow');
  await expect.poll(() => queries.includes('slow')).toBe(true);
  await page.locator('#global-search').fill('typography');
  await expect(page.locator('.message-row')).toHaveCount(1);
  release();
  await expect(page.locator('#global-search')).toHaveValue('typography');
  await page.locator('#global-search').fill('');
  await expect(page.locator('.message-row')).toHaveCount(5);
});

test('rule editor creates local destinations and saves sender exclusions', async ({ page }) => {
  await page.goto('/#/settings/rules');
  const name = 'Rules folder ' + Date.now();
  await page.getByLabel('New local folder').fill(name);
  await page.getByRole('button', { name: 'Create local folder', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Local folder created');
  folderId = (await api(page, '/local-folders')).find((f) => f.name === name).id;
  await page.getByLabel('Rule name', { exact: true }).fill('Older read sender mail');
  await page.getByLabel('Condition 1 field', { exact: true }).selectOption('domain');
  await page.getByLabel('Condition 1 operator', { exact: true }).selectOption('is');
  await page.getByLabel('Condition 1 value', { exact: true }).fill('example.org');
  await page.getByLabel('Action 1 value', { exact: true }).selectOption('local-' + folderId);
  await page.getByLabel('Exclude unread messages').check();
  await page.getByLabel('Only messages older than days (0 = any age)').fill('7');
  await page.getByRole('button', { name: 'Save rule', exact: true }).click();
  await expect(page.locator('.rule-row')).toContainText('Older read sender mail');
  const saved = (await api(page, '/rules')).find((r) => r.name === 'Older read sender mail');
  ruleId = saved.id;
  expect(saved).toMatchObject({
    conditions: [{ field: 'domain', operator: 'is', value: 'example.org' }],
    actions: [{ type: 'move', value: 'local-' + folderId }],
    exclude_unread: true,
    older_than_days: 7,
  });
  await page.locator('[data-edit-rule="' + ruleId + '"]').click();
  await page.getByLabel('Enabled', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save rule', exact: true }).click();
  await expect(page.locator('.rule-row')).toContainText('Disabled');
  await page.goto('/#/local-' + folderId);
  await expect(page.locator('#page-title')).toContainText(name);
});

test('all-day range and repeating series render across all selected days', async ({ page }) => {
  await page.goto('/#/calendar');
  const days = page.locator('[data-day]');
  await expect(days).toHaveCount(42);
  const first = await days.nth(10).getAttribute('data-day'),
    last = await days.nth(12).getAttribute('data-day');
  await page.getByRole('button', { name: 'Select date range', exact: true }).click();
  await days.nth(10).click();
  await days.nth(12).click();
  await expect(page.getByLabel('All day', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Starts', { exact: true })).toHaveValue(first);
  await expect(page.getByLabel('Ends', { exact: true })).toHaveValue(last);
  const title = 'Multi-day repeat ' + Date.now();
  await page.getByLabel('Event title', { exact: true }).fill(title);
  await page.getByLabel('Repeat', { exact: true }).selectOption('weekly');
  await page.getByLabel('Repeat every (interval)').fill('2');
  await page.getByLabel('Maximum occurrences').fill('3');
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  const event = (await api(page, '/events')).find((e) => e.title === title);
  eventIds.push(event.id);
  expect(event.all_day).toBe(1);
  expect(JSON.parse(event.recurrence)).toMatchObject({
    frequency: 'weekly',
    interval: 2,
    count: 3,
  });
  expect(
    await page.locator('.calendar-grid [data-event="' + event.id + '"]').count(),
  ).toBeGreaterThanOrEqual(3);
  await page
    .locator('.calendar-grid [data-event="' + event.id + '"]')
    .last()
    .click();
  await expect(page.getByLabel('Starts', { exact: true })).toHaveValue(first);
  await expect(page.getByLabel('Repeat', { exact: true })).toHaveValue('weekly');
  await page.getByLabel('Maximum occurrences').fill('2');
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await page.screenshot({
    path: 'test-results/' + test.info().project.name + '-calendar-repeat.png',
    fullPage: true,
  });
});

test('dragging dates creates one all-day span and the logo follows theme text', async ({
  page,
}) => {
  await page.goto('/#/calendar');
  const days = page.locator('[data-day]');
  await expect(days).toHaveCount(42);
  await days.nth(8).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const a = await days.nth(8).boundingBox(),
    b = await days.nth(10).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByLabel('All day', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Starts', { exact: true })).toHaveValue(
    await days.nth(8).getAttribute('data-day'),
  );
  await expect(page.getByLabel('Ends', { exact: true })).toHaveValue(
    await days.nth(10).getAttribute('data-day'),
  );
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  expect(await page.title()).toContain('inkwell');
  await expect(page.locator('.brand-logo')).toHaveCSS('mask-image', /logo\.png/);
  await page.goto('/#/settings/theme');
  await page.getByLabel('Starting palette').selectOption('Midnight');
  await expect(page.locator('.brand-logo')).toHaveCSS('background-color', 'rgb(237, 241, 247)');
});
