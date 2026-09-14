const { test, expect } = require('@playwright/test');
const { DatabaseSync } = require('node:sqlite');
const os = require('node:os'),
  path = require('node:path');
let original, ids, folder, prefix, tagName;
function openDb() {
  if (!process.env.INKWELL_UI_DATA?.startsWith(path.join(os.tmpdir(), 'inkwell-ui-')))
    throw Error('Unsafe fixture path');
  return new DatabaseSync(path.join(process.env.INKWELL_UI_DATA, 'inkwell.db'));
}
async function api(page, url, method = 'GET', body) {
  return page.evaluate(
    async ({ url, method, body }) => {
      const r = await fetch('/api' + url, {
        method,
        headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!r.ok) throw Error(await r.text());
      return r.json();
    },
    { url, method, body },
  );
}
test.beforeEach(async ({ page }) => {
  prefix = 'Find' + Date.now();
  tagName = 'Équipe ' + prefix;
  ids = [];
  folder = null;
  await page.goto('/');
  original = await api(page, '/preferences');
  await api(page, '/preferences', 'PUT', {
    ...original,
    layout: 'classic',
    form_mode: 'popup',
    quick_filter_pinned: false,
  });
  for (const suffix of ['inbox', 'junk', 'tagged']) {
    const id = (
      await api(page, '/drafts', 'POST', { subject: prefix + ' ' + suffix, body: 'Neutral body' })
    ).id;
    ids.push(id);
    await api(page, '/messages/' + id, 'PATCH', {
      folder: 'inbox',
      tags: suffix === 'tagged' ? [tagName] : [],
    });
  }
  const db = openDb();
  db.prepare("UPDATE messages SET folder='sent' WHERE id=?").run(ids[2]);
  folder = Number(
    db
      .prepare(
        "INSERT INTO remote_folders(account_id,remote_id,name,path,well_known) VALUES (999999,?,'Junk Email','Junk Email','junkemail')",
      )
      .run(prefix).lastInsertRowid,
  );
  db.prepare(
    "UPDATE messages SET folder='remote',local_folder_override=0,remote_folder_id=? WHERE id=?",
  ).run(folder, ids[1]);
  db.close();
  await page.reload();
});
test.afterEach(async ({ page }) => {
  for (const id of ids) {
    await api(page, '/messages/' + id, 'PATCH', { folder: 'trash' });
    await api(page, '/messages/' + id, 'DELETE');
  }
  const db = openDb();
  if (folder !== null) db.prepare('DELETE FROM remote_folders WHERE id=?').run(folder);
  db.close();
  const tags = (await api(page, '/tags')).filter((t) => t.name === tagName);
  if (tags.length) await api(page, '/tags/delete', 'POST', { ids: tags.map((t) => t.id) });
  await api(page, '/preferences', 'PUT', original);
});
test('Default global search includes Junk and Sent; narrower scope and clearing work', async ({
  page,
}) => {
  await expect(page.locator('#search-scope')).toHaveValue('all');
  await page.locator('#global-search').fill(prefix);
  await expect(page.locator('.message-row')).toHaveCount(3);
  await expect(page.locator(`[data-message="${ids[1]}"] .folder-badge`)).toContainText(
    'Junk Email',
  );
  await page.locator('#search-scope').selectOption('folder');
  await expect(page.locator('.message-row')).toHaveCount(1);
  await expect(page.locator(`[data-message="${ids[0]}"]`)).toBeVisible();
  await page.locator('#search-scope').selectOption('all');
  await expect(page.locator('.message-row')).toHaveCount(3);
  await page.locator('#global-search').fill('');
  await expect(page.locator(`[data-message="${ids[1]}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-message="${ids[2]}"]`)).toHaveCount(0);
  await expect(page.locator('#search-scope')).toHaveValue('all');
});
test('Plain Unicode tags and tag-only searches find tagged mail outside Inbox', async ({
  page,
}, info) => {
  for (const query of [
    tagName.toLowerCase(),
    'tag:' + tagName.toLowerCase(),
    'tag:"' + tagName + '"',
    '#' + tagName,
  ]) {
    await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === '/api/messages' &&
          new URL(r.url()).searchParams.get('q') === query,
      ),
      page.locator('#global-search').fill(query),
    ]);
    await expect(page.locator('.message-row')).toHaveCount(1);
    await expect(page.locator(`[data-message="${ids[2]}"] .tag-pill`)).toHaveText(tagName);
  }
  await page.locator('#search-scope').selectOption('folder');
  await expect(page.locator('.message-row')).toHaveCount(0);
  await page.locator('#search-scope').selectOption('all');
  await expect(page.locator('.message-row')).toHaveCount(1);
  await page.screenshot({
    path: 'test-results/' + info.project.name + '-global-tag-search.png',
    fullPage: true,
  });
});
