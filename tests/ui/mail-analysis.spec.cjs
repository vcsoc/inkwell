const { test, expect } = require('@playwright/test');
const names = [
  'Invoice',
  'Receipt',
  'Action required',
  'Meeting',
  'Delivery',
  'Newsletter',
  'Project',
  'Customer',
  'Cold lead',
  'Hot lead',
];
async function mock(page, failApproval = false) {
  const cfg = {
    enabled: false,
    model: 'english',
    categories: names.map((name) => ({
      name,
      description: 'Description for ' + name,
      threshold: 0.8,
      enabled: true,
    })),
  };
  const state = {
    config: cfg,
    counts: { review: 1, pending: 0 },
    tag_usage: names.map((name) => ({
      name,
      count: name === 'Invoice' ? 12 : name === 'Newsletter' ? 8 : 0,
    })),
    backfill: {},
    runtime_ready: true,
    runtime_path: '/local/inkwell/laya-runtime/bin/python',
    worker_active: false,
    last_error: '',
  };
  const record = {
    message_id: 42,
    subject: '<img src=x onerror=alert(1)> Invoice for November',
    sender: 'Alex <alex@example.test>',
    date: '2026-11-01',
    tags: ['Manual'],
    state: 'review',
    scores: Object.fromEntries(
      names.map((name) => [
        name,
        name === 'Invoice' ? 0.97 : name === 'Action required' ? 0.92 : 0.1,
      ]),
    ),
    error: '',
    truncated: 1,
    provider_job_id: null,
    outcome: '',
  };
  const requests = [];
  await page.route('**/api/mail-analysis**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname,
      body = request.postDataJSON();
    requests.push({ path, method: request.method(), body });
    let response = state;
    if (path.endsWith('/mail-analysis') && request.method() === 'PUT') state.config = body;
    if (path.endsWith('/results'))
      response = new URL(request.url()).searchParams.get('state') === record.state ? [record] : [];
    if (path.endsWith('/approve')) {
      if (failApproval) {
        await route.fulfill({
          status: 409,
          json: {
            detail:
              'Server writes for this mail provider are not supported yet; no mailbox change was made.',
          },
        });
        return;
      }
      record.state = 'applied';
      record.provider_job_id = 17;
      record.sync_state = 'pending';
      record.tags = ['Manual', ...body.tags];
      state.counts = { review: 0, applied: 1 };
      response = { applied: true, provider_queued: 1 };
    }
    if (path.endsWith('/reject')) {
      record.state = 'rejected';
      state.counts.review = 0;
      response = { rejected: true };
    }
    if (path.endsWith('/backfill')) {
      state.backfill = {
        through: 55,
        cursor: 0,
        active: body.action !== 'pause',
        paused: body.action === 'pause',
      };
      response = state.backfill;
    }
    await route.fulfill({ json: response });
  });
  return { requests, state, record };
}

test('local analysis settings configure ten tags without inferring or backfilling on page load', async ({
  page,
}) => {
  const { requests } = await mock(page);
  await page.goto('/#/settings/analysis');
  await expect(page.locator('.analysis-settings')).toBeVisible();
  await expect(page.locator('#analysis-runtime')).toContainText('runtime ready');
  await expect(page.locator('#analysis-enabled')).not.toBeChecked();
  expect(requests.every((r) => r.method === 'GET')).toBe(true);
  await page.locator('#analysis-catalog-tab').click();
  await expect(page.locator('#analysis-categories tr')).toHaveCount(10);
  await page
    .locator('[data-field=description]')
    .first()
    .fill('An unpaid invoice requiring payment.');
  await page.locator('[data-field=threshold]').first().fill('0.9');
  await page.getByRole('button', { name: 'Save analysis settings', exact: true }).click();
  await expect.poll(() => requests.some((r) => r.method === 'PUT')).toBe(true);
  await page.locator('#analysis-enabled').check();
  await expect.poll(() => requests.filter((r) => r.method === 'PUT').length).toBe(2);
  const saved = requests.filter((r) => r.method === 'PUT').at(-1).body;
  expect(saved.enabled).toBe(true);
  expect(saved.model).toBe('english');
  expect(saved.categories[0].threshold).toBe(0.9);
  expect(requests.some((r) => r.path.endsWith('/backfill'))).toBe(false);
  await page.locator('#analysis-backfill').click();
  await expect(page.locator('#analysis-queue-state')).toContainText('Scanning');
  await page.locator('#analysis-pause').click();
  await expect(page.locator('#analysis-queue-state')).toContainText('paused');
  await page.locator('#analysis-resume').click();
  await expect(page.locator('#analysis-queue-state')).toContainText('Scanning');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `test-results/mail-analysis-settings-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test('review escapes mail content, supports multiple labels and shows pending/failed provider status honestly', async ({
  page,
}) => {
  const { requests, record } = await mock(page);
  await page.goto('/#/settings/analysis');
  await expect(page.locator('.analysis-result')).toHaveCount(1);
  await expect(page.locator('.analysis-result img')).toHaveCount(0);
  await expect(page.locator('.analysis-result')).toContainText('Existing tags');
  await expect(page.locator('.analysis-result')).toContainText('Invoice for November');
  await expect(page.locator('[data-review] [name=tags]')).toHaveCount(10);
  await page.getByRole('switch', { name: 'Invoice', exact: true }).check();
  await page.getByRole('switch', { name: 'Action required', exact: true }).check();
  await page.getByRole('button', { name: 'Apply selected tags', exact: true }).click();
  await expect.poll(() => requests.some((r) => r.path.endsWith('/approve'))).toBe(true);
  expect(requests.find((r) => r.path.endsWith('/approve')).body.tags).toEqual([
    'Invoice',
    'Action required',
  ]);
  await page.locator('#analysis-filter').selectOption('applied');
  await expect(page.locator('#analysis-results')).toContainText('Provider synchronization pending');
  record.sync_state = 'failed';
  record.sync_error = 'Permission expired';
  await page.locator('#analysis-refresh').click();
  await expect(page.locator('#analysis-results')).toContainText(
    'Provider synchronization failed: Permission expired',
  );
  await expect(page.locator('#analysis-results')).not.toContainText('Provider synchronized');
});

test('unsupported provider errors keep suggestions and dismiss never applies tags', async ({
  page,
}) => {
  const { requests } = await mock(page, true);
  await page.goto('/#/settings/analysis');
  await expect(page.locator('[data-review] [name=tags]')).toHaveCount(10);
  await page.getByRole('switch', { name: 'Invoice', exact: true }).check();
  await page.getByRole('switch', { name: 'Action required', exact: true }).check();
  await page.getByRole('button', { name: 'Apply selected tags', exact: true }).click();
  await expect(page.locator('.analysis-result-error')).toContainText('not supported');
  await expect(page.locator('[data-review]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Dismiss suggestions', exact: true }).click();
  await expect(page.locator('[data-review]')).toHaveCount(0);
  expect(requests.filter((r) => r.path.endsWith('/approve'))).toHaveLength(1);
  expect(requests.filter((r) => r.path.endsWith('/reject'))).toHaveLength(1);
});

test('all scored tags remain selectable below thresholds, including no-match results', async ({
  page,
}) => {
  const { requests, record } = await mock(page);
  record.scores.Newsletter = 0.79;
  await page.goto('/#/settings/analysis');
  await expect(page.getByRole('switch', { name: 'Newsletter', exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Newsletter', exact: true })).not.toBeChecked();
  await expect(
    page.getByRole('button', { name: 'Apply selected tags', exact: true }),
  ).toBeDisabled();
  await expect(
    page
      .locator('.analysis-tag-choice')
      .filter({ has: page.getByRole('switch', { name: 'Newsletter', exact: true }) }),
  ).toContainText('Manual choice');
  record.state = 'no_match';
  await page.locator('#analysis-filter').selectOption('no_match');
  await page.getByRole('switch', { name: 'Newsletter', exact: true }).check();
  await page.getByRole('button', { name: 'Apply selected tags', exact: true }).click();
  await expect.poll(() => requests.some((r) => r.path.endsWith('/approve'))).toBe(true);
  expect(requests.find((r) => r.path.endsWith('/approve')).body.tags).toEqual(['Newsletter']);
});

test('catalog table creates, edits, disables and removes analysis definitions inline', async ({
  page,
}) => {
  const { requests } = await mock(page);
  await page.goto('/#/settings/analysis');
  await page.locator('#analysis-catalog-tab').click();
  await expect(page.locator('#analysis-categories tr')).toHaveCount(10);
  await page.getByRole('button', { name: 'Add tag', exact: true }).click();
  const row = page.locator('#analysis-categories tr').last();
  await row.getByRole('textbox', { name: 'Tag name', exact: true }).fill('Legal');
  await row
    .getByRole('textbox', { name: 'Tag description', exact: true })
    .fill('Does this email discuss legal agreements?');
  await row.getByRole('spinbutton', { name: 'Minimum model score', exact: true }).fill('0.85');
  await page.getByRole('switch', { name: 'Enable tag Receipt', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Remove Invoice', exact: true }).click();
  await page.getByRole('button', { name: 'Save analysis settings', exact: true }).click();
  await expect(page.locator('#analysis-catalog-state')).toHaveText('All changes saved');
  const cfg = requests.find((r) => r.method === 'PUT').body;
  expect(cfg.categories).toHaveLength(10);
  expect(cfg.categories.some((c) => c.name === 'Invoice')).toBe(false);
  expect(cfg.categories.find((c) => c.name === 'Receipt').enabled).toBe(false);
  expect(cfg.categories.find((c) => c.name === 'Legal').threshold).toBe(0.85);
});

test('wide dashboard uses available width with real progress, usage bars and accessible help', async ({
  page,
}) => {
  const { state } = await mock(page);
  if (test.info().project.name === 'desktop')
    await page.setViewportSize({ width: 1910, height: 1046 });
  state.backfill = { through: 20750, cursor: 255, active: true, paused: false };
  state.progress = {
    total: 100,
    completed: 25,
    remaining: 75,
    queued: 30,
    running: 2,
    failed: 3,
    unqueued: 40,
    percent: 25,
  };
  state.counts = { review: 25, pending: 30, running: 2, failed: 3 };
  state.config.enabled = true;
  await page.goto('/#/settings/analysis');
  await expect(page.locator('#analysis-progress')).toHaveAttribute('value', '25');
  await expect(page.locator('#analysis-progress-label')).toContainText('25');
  await expect(page.locator('#analysis-status')).toContainText('75 remaining');
  await expect(page.locator('#analysis-status')).toContainText('40 not yet queued');
  await expect(page.getByRole('meter', { name: 'Invoice usage', exact: true })).toHaveAttribute(
    'value',
    '12',
  );
  await expect(page.locator('#analysis-usage-chart [role=listitem]')).toHaveCount(10);
  await expect(page.locator('.analysis-settings [type=checkbox]:not([role=switch])')).toHaveCount(
    0,
  );
  if (test.info().project.name === 'desktop') {
    const space = await page.locator('#settings-content').boundingBox(),
      dashboard = await page.locator('.analysis-settings').boundingBox();
    expect(dashboard.width).toBeGreaterThan(1100);
    expect(Math.abs(space.width - dashboard.width)).toBeLessThan(2);
  }
  await page.getByRole('button', { name: 'About local mail analysis', exact: true }).focus();
  const tip = page.locator('.analysis-heading [role=tooltip]');
  await expect(tip).toBeVisible();
  const bounds = await tip.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  await page.keyboard.press('Escape');
  await expect(tip).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `test-results/mail-analysis-dashboard-${test.info().project.name}.png`,
  });
});
