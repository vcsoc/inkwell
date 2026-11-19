const { test, expect } = require('@playwright/test');

let sources;
let syncs;
let saved;
test.beforeEach(async ({ page }) => {
  sources = Array.from({ length: 5 }, (_, i) => ({
    id: i + 1,
    name: `Outlook calendar ${i + 1}`,
    account_email: 'calendar@example.com',
    account_id: 1,
    selected: 1,
    can_edit: i < 2 ? 1 : 0,
    is_default: i === 0 ? 1 : 0,
  }));
  syncs = 0;
  saved = null;
  await page.route('**/api/calendars', (route) =>
    route.fulfill({
      json: {
        calendars: sources,
        accounts: [{ id: 1, email: 'calendar@example.com', calendar_access: true }],
        sync: { active: false, revision: 1, errors: [] },
      },
    }),
  );
  await page.route('**/api/calendars/sync', (route) => {
    syncs++;
    return route.fulfill({ json: { active: true } });
  });
  await page.route(/\/api\/calendars\/\d+$/, async (route) => {
    const id = Number(route.request().url().split('/').pop());
    sources.find((s) => s.id === id).selected = route.request().postDataJSON().selected;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/events/occurrences?*', (route) => {
    const today = new Date();
    const start = new Date(Date.UTC(today.getFullYear(), today.getMonth(), 15, 12));
    const values = [0, 2]
      .filter((i) => sources[i].selected)
      .map((i) => ({
        id: 1000 + i,
        title: i === 0 ? 'Editable Outlook meeting' : 'Shared read-only appointment',
        start: start.toISOString(),
        end: new Date(start.getTime() + 3600000).toISOString(),
        all_day: false,
        timezone: 'UTC',
        recurrence: '{}',
        notes: 'Outlook notes',
        location: '',
        provider_calendar_id: i + 1,
        provider_event_id: 'remote-' + i,
        provider_account_id: 1,
        calendar_name: sources[i].name,
        calendar_can_edit: sources[i].can_edit,
      }));
    return route.fulfill({ json: values });
  });
  await page.route('**/api/events', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    saved = route.request().postDataJSON();
    return route.fulfill({ json: { id: 2000 } });
  });
  await page.goto('/#/calendar');
  await expect(page.locator('[data-calendar-source]')).toHaveCount(5);
});

test('all five Outlook sources are listed with honest editability and no local-only switch', async ({
  page,
}) => {
  await expect(page.locator('.calendar-source-pills button')).toHaveCount(5);
  await expect(page.locator('[data-calendar-source="5"]')).toContainText('Outlook calendar 5');
  await expect(page.locator('[data-calendar-source="3"]')).toHaveAttribute('title', /Read-only/);
  await expect(page.locator('[data-calendar-source="3"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.calendar-event[data-event="1000"]')).toHaveAttribute(
    'aria-label',
    /Outlook calendar 1/,
  );
  await expect(page.getByText('Local changes only', { exact: false })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: `test-results/calendar-pills-${test.info().project.name}.png` });
});

test('visibility choices filter events without deleting the source and Sync calendars retries', async ({
  page,
}) => {
  await expect(page.locator('.calendar-event[data-event="1002"]')).toHaveCount(1);
  await page.locator('[data-calendar-source="3"]').click();
  await expect(page.locator('.calendar-event[data-event="1002"]')).toHaveCount(0);
  await expect(page.locator('[data-calendar-source]')).toHaveCount(5);
  await expect(page.locator('[data-calendar-source="3"]')).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(page.locator('[data-calendar-source="3"]')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-calendar-source="3"]').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.calendar-event[data-event="1002"]')).toHaveCount(1);
  await expect.poll(() => syncs).toBeGreaterThan(0);
  const before = syncs;
  await page.getByRole('button', { name: 'Sync calendars', exact: true }).click();
  await expect.poll(() => syncs).toBeGreaterThan(before);
});

test('month navigation sits immediately after the title and keeps all three controls working', async ({
  page,
}) => {
  const title = page.locator('.calendar-month-navigation h2');
  const initial = await title.innerText();
  const heading = await title.boundingBox();
  const buttons = await page
    .getByRole('group', { name: 'Month navigation', exact: true })
    .boundingBox();
  expect(buttons.x - (heading.x + heading.width)).toBeGreaterThanOrEqual(0);
  expect(buttons.x - (heading.x + heading.width)).toBeLessThanOrEqual(16);
  expect(Math.abs(buttons.y + buttons.height / 2 - (heading.y + heading.height / 2))).toBeLessThan(
    3,
  );
  await page.getByRole('button', { name: 'Previous month', exact: true }).click();
  await expect(title).not.toHaveText(initial);
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  await expect(title).toHaveText(initial);
  await page.getByRole('button', { name: 'Previous month', exact: true }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(title).toHaveText(initial);
  await page.screenshot({
    path: `test-results/calendar-month-navigation-${test.info().project.name}.png`,
  });
});

test('failed visibility saves restore the pill and leave events visible', async ({ page }) => {
  await page.route(/\/api\/calendars\/3$/, (route) =>
    route.fulfill({ status: 503, json: { detail: 'Visibility save failed' } }),
  );
  await page.locator('[data-calendar-source="3"]').click();
  await expect(page.locator('[data-calendar-source="3"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-calendar-source="3"]')).toBeEnabled();
  await expect(page.locator('.calendar-event[data-event="1002"]')).toHaveCount(1);
});

test('a read-only Outlook event opens details without edit or delete controls', async ({
  page,
}) => {
  await page.locator('.calendar-event[data-event="1002"]').click();
  await expect(page.locator('#modal')).toContainText('Read-only Outlook event');
  await expect(page.locator('#modal')).toContainText('Outlook calendar 3');
  await expect(page.locator('#event-form')).toHaveCount(0);
  await expect(page.locator('#delete-event')).toHaveCount(0);
});

test('new events select an editable Outlook calendar and downloaded events retain their source', async ({
  page,
}) => {
  await page.locator('.calendar-event[data-event="1000"]').click();
  await expect(page.locator('[name=calendar_id]')).toBeDisabled();
  await expect(page.locator('[name=calendar_id]')).toHaveValue('1');
  await expect(page.locator('[name=frequency]')).toBeDisabled();
  await page.locator('#close-modal').click();
  await page.locator('.day-number').first().click();
  await expect(page.locator('[name=calendar_id] option')).toHaveCount(2);
  await page.locator('[name=calendar_id]').selectOption('2');
  await page.locator('[name=title]').fill('Created in second Outlook calendar');
  await page.locator('#event-form button[type=submit]').click();
  await expect.poll(() => saved?.calendar_id).toBe(2);
  expect(saved.title).toBe('Created in second Outlook calendar');
});
