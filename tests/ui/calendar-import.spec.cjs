const { test, expect } = require('@playwright/test');
const { selectEmailMenuAction } = require('./helpers.cjs');
const request = (page, path, method = 'GET', body) =>
  page.evaluate(
    async ({ path, method, body }) => {
      const r = await fetch('/api' + path, {
        method,
        headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!r.ok) throw Error(await r.text());
      return r.json();
    },
    { path, method, body },
  );

test('ICS review imports into calendar once and explains native reminder limitations', async ({
  page,
}) => {
  const title = 'ICS ' + Date.now(),
    uid = title + '@example.org';
  await page.goto('/#/calendar');
  try {
    const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:20990102T100000Z\r\nDTEND:20990102T110000Z\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
    for (const expected of ['1 calendar event(s) added', '0 calendar event(s) added']) {
      await page.getByRole('button', { name: 'Import .ics', exact: true }).click();
      await page.getByLabel('Calendar file (.ics)', { exact: true }).setInputFiles({
        name: 'meeting.ics',
        mimeType: 'text/calendar',
        buffer: Buffer.from(ics),
      });
      await expect(page.locator('#calendar-import-preview')).toContainText(title);
      await expect(page.locator('#calendar-import')).toContainText('Keep Inkwell open');
      await page.getByRole('button', { name: 'Add to local calendar', exact: true }).click();
      await expect(page.locator('#modal')).not.toBeVisible();
      await expect(page.locator('#toast')).toContainText(expected);
      await expect(page.locator('.agenda')).toContainText(title);
    }
    expect((await request(page, '/events')).filter((e) => e.title === title)).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  } finally {
    for (const e of await request(page, '/events'))
      if (e.title === title) await request(page, '/events/' + e.id, 'DELETE');
  }
});

test('message menu opens invite review without sending an RSVP or auto-adding events', async ({
  page,
}) => {
  await page.goto('/');
  const draft = await request(page, '/drafts', 'POST', {
    subject: 'Invitation menu ' + Date.now(),
    body: 'Meeting',
  });
  try {
    await request(page, '/messages/' + draft.id, 'PATCH', { folder: 'inbox' });
    await page.reload();
    await page.route(`**/api/messages/${draft.id}/calendar-invites?*`, (route) =>
      route.fulfill({
        status: 422,
        json: { detail: 'No ICS meeting invitation was found in this email.' },
      }),
    );
    await page.locator(`[data-more="${draft.id}"]`).click();
    await selectEmailMenuAction(page, 'Add meeting invitation…');
    await expect(page.locator('#calendar-import-status')).toContainText('No ICS');
    await expect(
      page.getByRole('button', { name: 'Add to local calendar', exact: true }),
    ).toBeDisabled();
    await expect(page.locator('#calendar-import')).toContainText('no RSVP');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  } finally {
    await request(page, '/messages/' + draft.id, 'PATCH', { folder: 'trash' });
    await request(page, '/messages/' + draft.id, 'DELETE');
  }
});
