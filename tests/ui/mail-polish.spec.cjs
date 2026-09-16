const { test, expect } = require('@playwright/test');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path'),
  os = require('node:os');
let original, prefix, folderId, htmlId, remoteAccount;
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
  prefix = 'Polish ' + Date.now();
  folderId = htmlId = remoteAccount = null;
  await page.goto('/');
  original = await api(page, '/preferences');
  await api(page, '/preferences', 'PUT', {
    ...original,
    form_mode: 'popup',
    layout: 'classic',
    ui_zoom: 100,
  });
  await api(page, '/demo', 'POST');
  for (const row of (await api(page, '/messages?scope=all')).filter((m) => m.demo))
    await api(page, '/messages/' + row.id, 'PATCH', { folder: 'inbox' });
  await page.reload();
  await expect(page.locator('.message-row')).toHaveCount(5);
  page.on('dialog', async (dialog) => {
    await dialog.dismiss();
    throw Error('Unexpected confirmation: ' + dialog.message());
  });
});
test.afterEach(async ({ page }) => {
  await page.unroute('**/api/drafts');
  if (remoteAccount) await api(page, '/accounts/' + remoteAccount, 'DELETE');
  if (await page.locator('#compose-form').isVisible()) await page.locator('#close-modal').click();
  const rows = await api(page, '/messages?scope=all&q=' + encodeURIComponent(prefix));
  for (const row of rows) {
    await api(page, '/messages/' + row.id, 'PATCH', { folder: 'trash' });
    await api(page, '/messages/' + row.id, 'DELETE');
  }
  if (folderId) {
    const filed = await api(page, '/messages?folder=local-' + folderId);
    for (const row of filed) await api(page, '/messages/' + row.id, 'PATCH', { folder: 'inbox' });
    await api(page, '/local-folders/' + folderId, 'DELETE');
  }
  for (const row of (await api(page, '/messages?scope=all')).filter((m) => m.demo))
    await api(page, '/messages/' + row.id, 'PATCH', { folder: 'inbox' });
  if (htmlId) {
    const db = new DatabaseSync(path.join(process.env.INKWELL_UI_DATA, 'inkwell.db'));
    db.prepare('UPDATE messages SET html_body=NULL WHERE id=?').run(htmlId);
    db.close();
  }
  await api(page, '/preferences', 'PUT', original);
});
test('popup autosaves partial addresses, preserves one draft and resumes latest edits', async ({
  page,
}) => {
  await page.locator('#heading-compose').click();
  await page.locator('[name=recipient]').fill('unfinished@');
  await page.locator('[name=subject]').fill(prefix);
  await page.locator('[name=body]').fill('First edits');
  await expect(page.locator('#draft-status')).toContainText('saved automatically');
  const first = (await api(page, '/messages?folder=drafts&q=' + encodeURIComponent(prefix)))[0];
  await page.locator('[name=body]').fill('Latest edits before leaving');
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal')).not.toBeVisible();
  let drafts = await api(page, '/messages?folder=drafts&q=' + encodeURIComponent(prefix));
  expect(drafts).toHaveLength(1);
  expect(drafts[0].id).toBe(first.id);
  await page.goto('/#/drafts');
  await page.locator(`[data-message="${first.id}"] .subject`).click();
  await expect(page.locator('[name=body]')).toHaveValue('Latest edits before leaving');
  await page.locator('#delete-draft').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  drafts = await api(page, '/messages?folder=drafts&q=' + encodeURIComponent(prefix));
  expect(drafts).toHaveLength(0);
});
test('leaving an internal reply saves it automatically and follows the clicked navigation', async ({
  page,
}) => {
  await api(page, '/preferences', 'PUT', {
    ...original,
    form_mode: 'inline',
    layout: 'classic',
    ui_zoom: 100,
  });
  await page.reload();
  await page.locator('.message-row .subject').first().click();
  await page.locator('#reply').click();
  await page.locator('[name=subject]').fill(prefix);
  await page.locator('[name=body]').fill('Reply kept on click away');
  const tabs = page.locator('.mobile-tabs');
  if (await tabs.isVisible())
    await tabs.getByRole('button', { name: 'Calendar', exact: true }).click();
  else await page.locator('.app-rail [data-view=calendar]').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await expect(page.locator('.calendar-grid')).toBeVisible();
  const drafts = await api(page, '/messages?folder=drafts&q=' + encodeURIComponent(prefix));
  expect(drafts).toHaveLength(1);
  expect((await api(page, '/messages/' + drafts[0].id)).body).toBe('Reply kept on click away');
});
test('a failed autosave keeps the editor and its content until saving succeeds', async ({
  page,
}) => {
  await page.route('**/api/drafts', (route) =>
    route.fulfill({ status: 503, json: { detail: 'Storage unavailable' } }),
  );
  await page.locator('#heading-compose').click();
  await page.locator('[name=subject]').fill(prefix);
  await page.locator('[name=body]').fill('Do not lose this');
  await page.locator('#close-modal').click();
  await expect(page.locator('#draft-status')).toContainText('Storage unavailable');
  await expect(page.locator('[name=body]')).toHaveValue('Do not lose this');
  await page.unroute('**/api/drafts');
  await page.locator('#close-modal').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  expect(await api(page, '/messages?folder=drafts&q=' + encodeURIComponent(prefix))).toHaveLength(
    1,
  );
});
test('selected messages drag to a folder, with a mobile Move alternative', async ({
  page,
}, info) => {
  folderId = (await api(page, '/local-folders', 'POST', { name: prefix })).id;
  await page.reload();
  const rows = page.locator('.message-row');
  await expect(rows).toHaveCount(5);
  const ids = await rows.evaluateAll((nodes) =>
    nodes.slice(0, 2).map((n) => Number(n.dataset.message)),
  );
  await rows.nth(0).locator('.select-message').check();
  await rows.nth(1).locator('.select-message').check();
  await expect(page.locator('#selection-count')).toHaveText('2 selected');
  if (info.project.name === 'desktop')
    await rows.first().dragTo(page.locator(`#navigation [data-view="local-${folderId}"]`));
  else {
    await page.locator('#selection-destination').selectOption('local-' + folderId);
    await page.locator('#move-selected').click();
  }
  await expect(page.locator('.message-row')).toHaveCount(3);
  const moved = await api(page, '/messages?folder=local-' + folderId);
  expect(moved.map((m) => m.id).sort()).toEqual(ids.sort());
  expect(moved.every((m) => m.local_folder_override === 1)).toBe(true);
});
test('server-tree drop files locally without displaying the account banner', async ({
  page,
}, info) => {
  if (!process.env.INKWELL_UI_DATA?.startsWith(path.join(os.tmpdir(), 'inkwell-ui-')))
    throw Error('Not an isolated workspace');
  await page.route('**/api/sync', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/remote-folders/*/sync', (route) =>
    route.fulfill({ json: { added: 0 } }),
  );
  const db = new DatabaseSync(path.join(process.env.INKWELL_UI_DATA, 'inkwell.db'));
  db.exec('PRAGMA busy_timeout=1000');
  remoteAccount = Number(
    db
      .prepare(
        "INSERT INTO accounts(name,email,imap_host,imap_port,smtp_host,smtp_port,username,secret,smtp_security,provider) VALUES ('Fixture','fixture@example.org','localhost',993,'localhost',465,'fixture','', 'tls','microsoft')",
      )
      .run().lastInsertRowid,
  );
  const destination = Number(
    db
      .prepare(
        "INSERT INTO remote_folders(account_id,remote_id,name,path) VALUES (?,'target','Tree destination','Tree destination')",
      )
      .run(remoteAccount).lastInsertRowid,
  );
  db.close();
  await page.reload();
  await expect(page.locator('.message-row')).toHaveCount(5);
  const row = page.locator('.message-row').first(),
    id = Number(await row.getAttribute('data-message'));
  await row.locator('.select-message').check();
  if (info.project.name === 'desktop') {
    await expect(page.locator('.server-folders')).not.toContainText('fixture@example.org');
    await row.dragTo(page.locator(`[data-remote-folder="${destination}"]`));
  } else {
    await page.locator('#selection-destination').selectOption('remote:' + destination);
    await page.locator('#move-selected').click();
  }
  await expect(page.locator('.message-row')).toHaveCount(4);
  await page.goto('/#/remote/' + destination);
  await expect(page.locator(`[data-message="${id}"]`)).toBeVisible();
  const moved = await api(page, '/messages/' + id);
  expect(moved.remote_folder_id).toBeNull();
  expect(moved.local_destination_id).toBe(destination);
});

test('leaving a popup saves a new email without a prompt', async ({ page }, info) => {
  await page.locator('#heading-compose').click();
  await page.locator('[name=subject]').fill(prefix);
  await page.locator('[name=body]').fill('Saved by clicking off');
  if (info.project.name === 'mobile') await page.locator('#close-modal').click();
  else await page.mouse.click(2, 2);
  await expect(page.locator('#modal')).not.toBeVisible();
  expect(await api(page, '/messages?folder=drafts&q=' + encodeURIComponent(prefix))).toHaveLength(
    1,
  );
});

test('Trash context menu restores the previous folder and never wraps its labels', async ({
  page,
}) => {
  const id = Number(await page.locator('.message-row').first().getAttribute('data-message'));
  await api(page, '/messages/' + id, 'PATCH', { folder: 'archive' });
  await api(page, '/messages/' + id, 'PATCH', { folder: 'trash' });
  await page.goto('/#/trash');
  await page.locator(`[data-more="${id}"]`).click();
  const menu = page.locator('#message-menu');
  await menu.getByRole('menuitem', { name: 'File', exact: true }).click();
  await expect(menu.getByRole('menuitem', { name: 'Restore from Trash' })).toBeVisible();
  expect(
    await menu
      .locator('button:visible')
      .evaluateAll((nodes) => nodes.every((n) => getComputedStyle(n).whiteSpace === 'nowrap')),
  ).toBe(true);
  const box = await menu.boundingBox();
  expect(box.width).toBeLessThanOrEqual(page.viewportSize().width - 16);
  await menu.getByRole('menuitem', { name: 'Restore from Trash' }).click();
  await expect(page.locator(`[data-message="${id}"]`)).toHaveCount(0);
  expect((await api(page, '/messages/' + id)).folder).toBe('archive');
});
test('light-theme text reader switches its entire palette to dark and resets on another message', async ({
  page,
}) => {
  await api(page, '/preferences', 'PUT', {
    ...original,
    layout: 'classic',
    preview_mode: 'text',
    ui_zoom: 100,
    theme: { ...original.theme, dark: false, surface: '#ffffff', text: '#292e2b' },
  });
  await page.reload();
  await page.locator('.message-row .subject').first().click();
  await page.locator('#reader-appearance').click();
  await expect(page.locator('#reader')).toHaveCSS('background-color', 'rgb(32, 39, 49)');
  await expect(page.locator('.message-body')).toHaveCSS('color', 'rgb(237, 241, 247)');
  await expect(page.locator('#reader')).toHaveCSS('color-scheme', 'dark');
  await page.locator('#reader-back').click();
  await page.locator('.message-row .subject').nth(1).click();
  await expect(page.locator('#reader')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('#reader')).toHaveCSS('color-scheme', 'light');
});

test('HTML defaults to theme colors, toggles light and dark, and uses a bin icon', async ({
  page,
}, info) => {
  const id = Number(await page.locator('.message-row').first().getAttribute('data-message'));
  if (!process.env.INKWELL_UI_DATA?.startsWith(path.join(os.tmpdir(), 'inkwell-ui-')))
    throw Error('Not an isolated workspace');
  htmlId = id;
  const db = new DatabaseSync(path.join(process.env.INKWELL_UI_DATA, 'inkwell.db'));
  db.prepare('UPDATE messages SET html_body=? WHERE id=?').run(
    '<p style="color:black!important;background-color:white!important">Themed reader</p>',
    id,
  );
  db.close();
  await api(page, '/preferences', 'PUT', {
    ...original,
    ui_zoom: 100,
    layout: 'classic',
    preview_mode: 'html',
    theme: {
      ...original.theme,
      dark: true,
      background: '#0d1117',
      surface: '#161b22',
      text: '#e6edf3',
      selection: '#303e4b',
      accent: '#9bbacb',
      accent_text: '#17212b',
    },
  });
  await page.reload();
  await page.locator(`[data-message="${id}"] .subject`).click();
  const body = page.frameLocator('.html-message').locator('body');
  await expect(body).toHaveCSS('background-color', 'rgb(22, 27, 34)');
  await expect(page.frameLocator('.html-message').locator('p')).toHaveCSS(
    'color',
    'rgb(230, 237, 243)',
  );
  await expect(page.locator('#trash-message svg')).toBeVisible();
  await page.locator('#reader-appearance').click();
  await expect(body).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('#reader')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('#reader h2')).toHaveCSS('color', 'rgb(41, 46, 43)');
  await expect(page.locator('.privacy-banner')).toHaveCSS('background-color', 'rgb(234, 240, 232)');
  await expect(page.locator('#reader')).toHaveCSS('color-scheme', 'light');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(13, 17, 23)');
  await page.screenshot({
    path: `test-results/${info.project.name}-light-reader-in-dark-theme.png`,
    fullPage: true,
  });
  await page.locator('#reader-appearance').click();
  await expect(body).toHaveCSS('background-color', 'rgb(22, 27, 34)');
  await expect(page.locator('#reader')).toHaveCSS('background-color', 'rgb(22, 27, 34)');
  await expect(page.locator('#reader')).toHaveCSS('color-scheme', 'dark');
  await expect(page.locator('.privacy-banner')).toHaveCSS('background-color', 'rgb(48, 62, 75)');
  await page.screenshot({
    path: `test-results/${info.project.name}-themed-reader.png`,
    fullPage: true,
  });
  await page.locator('#trash-message').click();
  await expect(page.locator(`[data-message="${id}"]`)).toHaveCount(0);
  expect((await api(page, '/messages/' + id)).folder).toBe('trash');
});
