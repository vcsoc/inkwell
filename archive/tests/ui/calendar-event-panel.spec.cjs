const { test, expect } = require('@playwright/test');

test.use({ timezoneId: 'America/Toronto' });
let original;
let event;
async function api(page, path, method = 'GET', body) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch('/api' + path, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Inkwell': '1' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw Error(await response.text());
      return response.json();
    },
    { path, method, body },
  );
}
test.beforeEach(async ({ page }) => {
  await page.route('**/api/calendars/sync', (route) => route.fulfill({ json: { active: false } }));
  await page.goto('/');
  original = await api(page, '/preferences');
  await api(page, '/preferences', 'PUT', {
    ...original,
    form_mode: 'inline',
    layout: 'classic',
    ui_zoom: 100,
  });
  const times = await page.evaluate(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 3, 11, 30);
    return { start: start.toISOString(), end: new Date(start.getTime() + 3600000).toISOString() };
  });
  event = {
    title: 'Local-time panel fixture',
    ...times,
    timezone: 'UTC',
    location: 'Meeting room B',
    notes: 'Notes <script>not executable</script>\n'.repeat(80),
  };
  const created = await api(page, '/events', 'POST', event);
  event.id = created.id;
  await page.goto('/#/calendar');
  await page.reload();
  await expect(page.locator(`.calendar-event[data-event="${event.id}"]`)).toBeVisible();
});
test.afterEach(async ({ page }) => {
  if (event?.id) await api(page, '/events/' + event.id, 'DELETE');
  if (original) await api(page, '/preferences', 'PUT', original);
});
const geometry = (page) =>
  page.evaluate(() => {
    const grid = document.querySelector('.calendar-grid');
    return {
      rect: grid.getBoundingClientRect().toJSON(),
      gridScroll: grid.scrollTop,
      gridOverflow: grid.scrollHeight - grid.clientHeight,
      documentScroll: document.scrollingElement.scrollTop,
      mainScroll: document.querySelector('main').scrollTop,
      workspaceScroll: document.querySelector('#workspace').scrollTop,
    };
  });

test('opening and scrolling the inline editor keeps the full calendar pinned on screen', async ({
  page,
}, info) => {
  const widths = info.project.name === 'mobile' ? [390] : [1920, 1050, 800];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const before = await geometry(page);
    await page.locator(`.calendar-event[data-event="${event.id}"]`).click();
    await expect(page.locator('#calendar-editor-layout #event-form')).toBeVisible();
    await expect(page.locator('.calendar-grid')).toBeVisible();
    const opened = await geometry(page);
    expect(Math.abs(opened.rect.bottom - before.rect.bottom)).toBeLessThanOrEqual(5);
    expect(opened.rect.height).toBeGreaterThan(250);
    expect(opened.gridOverflow).toBeLessThanOrEqual(1);
    expect(opened.documentScroll).toBe(0);
    const body = page.locator('#modal-body');
    expect(await body.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(100);
    await body.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    expect(await body.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    const after = await geometry(page);
    expect(after.rect).toEqual(opened.rect);
    expect(after.documentScroll).toBe(0);
    expect(after.mainScroll).toBe(0);
    expect(after.workspaceScroll).toBe(0);
    expect(after.gridScroll).toBe(0);
    await page.screenshot({
      path: `test-results/calendar-event-panel-${info.project.name}-${width}.png`,
    });
    await page.locator('#close-modal').click();
    await expect(page.locator('#calendar-editor-layout')).toHaveCount(0);
  }
});

test('event labels and editors default to local time and saving preserves the original instant', async ({
  page,
}) => {
  const button = page.locator(`.calendar-event[data-event="${event.id}"]`);
  await expect(button).toContainText('11:30');
  await button.click();
  await expect(page.locator('[name=timezone]')).toHaveValue('America/Toronto');
  await expect(page.locator('[name=start]')).toHaveValue(/T11:30$/);
  await expect(page.locator('[name=end]')).toHaveValue(/T12:30$/);
  await page.locator('#event-form button[type=submit]').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  const saved = (await api(page, '/events')).find((e) => e.id === event.id);
  expect(Date.parse(saved.start)).toBe(Date.parse(event.start));
  expect(Date.parse(saved.end)).toBe(Date.parse(event.end));
  expect(saved.timezone).toBe('America/Toronto');
});

test('custom previews show local details, stay in the viewport, support keyboard dismissal and escape HTML', async ({
  page,
}, info) => {
  const button = page.locator(`.calendar-event[data-event="${event.id}"]`);
  if (info.project.name === 'mobile') await button.focus();
  else await button.hover();
  const preview = page.getByRole('tooltip');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(event.title);
  await expect(preview).toContainText('11:30 – 12:30');
  await expect(preview).toContainText('America/Toronto');
  await expect(preview).toContainText('Meeting room B');
  await expect(preview).toContainText('<script>not executable</script>');
  await expect(preview.locator('script')).toHaveCount(0);
  const rect = await preview.boundingBox();
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(rect.y + rect.height).toBeLessThanOrEqual(page.viewportSize().height);
  await page.screenshot({
    path: `test-results/calendar-event-preview-${test.info().project.name}.png`,
  });
  await preview.hover();
  await expect(preview).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await button.evaluate((el) => el.blur());
  await button.focus();
  await expect(preview).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
});

test('saving an unchanged repeated fall-back hour preserves its original offset', async ({
  page,
}) => {
  const value = { ...event, start: '2026-11-01T06:30:00Z', end: '2026-11-01T07:30:00Z' };
  await api(page, '/events/' + event.id, 'PUT', value);
  await page.evaluate((value) => window.inkwellEventForm(value), value);
  await expect(page.locator('[name=start]')).toHaveValue('2026-11-01T01:30');
  await page.locator('#event-form button[type=submit]').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  const saved = (await api(page, '/events')).find((e) => e.id === event.id);
  expect(Date.parse(saved.start)).toBe(Date.parse(value.start));
  expect(Date.parse(saved.end)).toBe(Date.parse(value.end));
});

test('focused previews survive background calendar refreshes', async ({ page }) => {
  let revision = 1;
  await page.route('**/api/calendars', (route) =>
    route.fulfill({
      json: { calendars: [], accounts: [], sync: { active: false, revision, errors: [] } },
    }),
  );
  await page.reload();
  const button = page.locator(`.calendar-event[data-event="${event.id}"]`);
  await button.focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await button.evaluate((el) => {
    el.dataset.beforeRefresh = 'true';
  });
  revision++;
  await expect(button).not.toHaveAttribute('data-before-refresh', 'true');
  await expect(button).toBeFocused();
  await expect(page.getByRole('tooltip')).toContainText(event.title);
});

test('preview positioning follows application zoom without leaving the screen', async ({
  page,
}) => {
  await page.evaluate(() => {
    document.documentElement.style.zoom = '0.75';
  });
  const button = page.locator(`.calendar-event[data-event="${event.id}"]`);
  await button.focus();
  const preview = page.getByRole('tooltip');
  await expect(preview).toBeVisible();
  const box = await preview.boundingBox(),
    anchor = await button.boundingBox();
  const expected = Math.max(8, Math.min(anchor.x, page.viewportSize().width - box.width - 8));
  expect(Math.abs(box.x - expected)).toBeLessThan(2);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
});

test('all-day labels and previews keep date-only events out of timezone conversion', async ({
  page,
}) => {
  const day = event.start.slice(0, 10);
  const next = new Date(day + 'T00:00:00Z');
  next.setUTCDate(next.getUTCDate() + 1);
  await api(page, '/events/' + event.id, 'PUT', {
    ...event,
    start: day + 'T00:00:00Z',
    end: next.toISOString(),
    all_day: true,
  });
  await page.reload();
  const button = page.locator(`.calendar-event[data-event="${event.id}"]`);
  await expect(button.locator('.calendar-event-time')).toHaveText('All day');
  await expect(button.locator('time')).toHaveCount(0);
  await button.focus();
  const expected = await page.evaluate(
    (day) =>
      new Date(day + 'T00:00:00').toLocaleDateString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    day,
  );
  await expect(page.getByRole('tooltip')).toContainText(expected + ' · All day');
});

test('readonly event details keep the calendar visible and use local times across DST', async ({
  page,
}) => {
  for (const start of ['2027-03-07T16:30:00Z', '2027-03-15T15:30:00Z']) {
    const value = {
      ...event,
      start,
      end: new Date(Date.parse(start) + 3600000).toISOString(),
      provider_calendar_id: 999,
      calendar_can_edit: 0,
      calendar_name: 'Shared calendar',
    };
    await page.evaluate((value) => window.inkwellEventForm(value), value);
    await expect(page.locator('#calendar-editor-layout')).toBeVisible();
    await expect(page.locator('.calendar-grid')).toBeVisible();
    await expect(page.locator('#modal-body')).toContainText('America/Toronto');
    await expect(page.locator('#modal-body')).toContainText('11:30');
    await page.locator('#close-modal').click();
    await page.evaluate(
      (value) => window.inkwellEventForm({ ...value, provider_calendar_id: null }),
      value,
    );
    await expect(page.locator('[name=start]')).toHaveValue(/T11:30$/);
    await expect(page.locator('[name=timezone]')).toHaveValue('America/Toronto');
    await page.locator('#close-modal').click();
  }
});
