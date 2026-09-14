const { test, expect } = require('@playwright/test');
for (const [kind, label] of [
  ['sender', 'Find all by sender'],
  ['organisation', 'Find all by organisation'],
  ['subject', 'Find all by subject'],
]) {
  test(`email menu opens a ${kind} collection`, async ({ page }, info) => {
    await page.goto('/');
    const setup = await page.evaluate(async (kind) => {
      const call = async (path, method = 'GET', body) => {
        const response = await fetch('/api' + path, {
          method,
          headers: { 'Content-Type': 'application/json', 'X-Inkwell': '1' },
          body: body ? JSON.stringify(body) : undefined,
        });
        return response.json();
      };
      await call('/demo', 'POST');
      const source = (await call('/messages'))[0];
      let draft;
      if (kind === 'subject')
        draft = (
          await call('/drafts', 'POST', {
            recipient: 'someone@example.com',
            subject: 'Re: ' + source.subject,
            body: 'Related outgoing draft',
          })
        ).id;
      const descriptor = await call('/collections/from-message/' + source.id + '?kind=' + kind);
      const result = await call('/collections/query', 'POST', {
        kind: descriptor.kind,
        key: descriptor.key,
      });
      return { sourceId: source.id, total: result.total, draft };
    }, kind);
    await page.reload();
    const row = page.locator(`[data-message="${setup.sourceId}"]`);
    await expect(row).toBeVisible();
    if (info.project.name === 'desktop') await row.click({ button: 'right' });
    else await row.getByRole('button', { name: 'More email actions' }).click();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
    await expect(page.locator('#breadcrumb')).toHaveText('Grouped mail');
    await expect(page.locator('.collection-banner')).toContainText(`${setup.total} messages`);
    await expect(page.locator('.message-row')).toHaveCount(setup.total);
    if (kind === 'organisation')
      await expect(page.locator('.collection-banner')).toContainText('example.com');
    if (kind === 'subject')
      await expect(page.locator('.collection-banner')).toContainText('drafts');
    await page.locator('#global-search').fill('no-match-unique-713bb');
    await expect(page.locator('.message-row')).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to inbox', exact: true }).click();
    await expect(page.locator('#breadcrumb')).toHaveText('Inbox');
    if (setup.draft)
      await page.evaluate(
        (id) => fetch('/api/messages/' + id, { method: 'DELETE', headers: { 'X-Inkwell': '1' } }),
        setup.draft,
      );
  });
}

test('keyboard context menu navigation and dismissal restore focus', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => fetch('/api/demo', { method: 'POST', headers: { 'X-Inkwell': '1' } }));
  await page.reload();
  const row = page.locator('.message-row').first();
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await expect(
    page.getByRole('menuitem', { name: 'Find all by sender', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(
    page.getByRole('menuitem', { name: 'Find all by organisation', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#message-menu')).not.toBeVisible();
  await expect(row).toBeFocused();
});
