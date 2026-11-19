// Run with Playwright installed: node tests/theme-studio.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

(async () => {
  const files = { '/': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'], '/calendar-workspace.css': ['calendar-workspace.css', 'text/css'],
    '/waypoint.css': ['waypoint.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'],
    '/theme-files.js': ['theme-files.js', 'text/javascript'], '/theme.js': ['theme.js', 'text/javascript'], '/drafts.js': ['drafts.js', 'text/javascript'], '/calendar.js': ['calendar.js', 'text/javascript'] };
  const server = http.createServer(async (request, response) => {
    const item = files[request.url];
    if (!item) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', item[1]);
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:");
    response.end(await fs.readFile(path.resolve(__dirname, '../ui', item[0])));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      let contacts = [], events = [];
      window.__TAURI__ = { core: { invoke: async (name, args) => {
        if (name === 'save_draft') { window.draftFixture = args; return { id: 10, key: args.key, revision: (args.expected?.revision || 0) + 1 }; }
        if (name === 'start_inbox_job') { window.fixtureSync = true; return { running: true, pages: 0, inserted: 0, errors: [] }; }
        if (name === 'inbox_job_status') return window.fixtureSync ? { running: !window.fixtureSyncDone, pages: 20, inserted: 111, errors: [] } : null;
        if (name === 'recent_sent_addresses') return [['Sent Person <sent@example.test>', '', '']];
        if (name === 'draft_clipboard') return 'Clipboard fixture';
        if (name === 'translate_draft') return 'Texte de test';
        if (name === 'delete_plain_draft') { window.deletedDraft = args.expected; return; }
        if (name === 'message') return { subject: 'Fixture message', sender: 'sender@example.test', recipient: 'you@example.test', date: '2026-01-01', body: 'Fixture notes' };
        if (name === 'events') return events;
        if (name === 'save_local_event') { events = [{ id: 1, editable: true, ...args.fields }]; return 1; }
        if (name === 'delete_local_event') { events = []; return; }
        if (name === 'contacts') return contacts;
        if (name === 'set_contact_avatar') { contacts = contacts.map((row) => row.id === args.id ? { ...row, avatar: args.avatar } : row); window.avatarFixture = args.avatar; return; }
        if (name === 'save_contact') { contacts = [{ id: 1, ...args.fields }]; return 1; }
        if (name === 'delete_contact') { contacts = []; return; }
        if (name === 'folders') return [{ key: 'inbox', label: 'Inbox' }];
        if (name === 'workspace_results') return { contacts: [{ title: 'Contact result', detail: 'fixture@example.test', target: '1' }], events: [{ title: 'Calendar result', detail: 'Library', target: '2026-01-03' }], folders: [{ title: 'Inbox folder', detail: '', target: 'inbox' }] };
        if (name === 'messages') { window.searchFixture = args; return { rows: [{ id: 1, subject: 'Fixture message', sender: 'sender@example.test', date: '2026-01-01' }], more: false }; }
        if (name === 'export_theme') { window.exportFixture = args; return true; }
        return [];
      } } };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(await page.title(), 'inkwell\u00ae');
    assert.equal(await page.locator('.wordmark').textContent(), 'inkwell\u00ae');
    const color = (name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim(), name);
    assert.equal(await color('background'), 'oklch(1 0 0)');
    assert.equal(await color('brand-hexagon'), '#13a3b2');
    const button = (name) => page.getByRole('button', { name, exact: true });
    await button('Theme Studio').click();
    await page.getByLabel('Theme preset').selectOption({ label: 'Waypoint Dark' });
    assert.equal(await color('background'), 'oklch(0.248 0 0)');
    assert.equal(await color('sidebar'), 'oklch(0.187 0 0)');
    await page.getByLabel('Canvas', { exact: true }).fill('#202840');
    assert.equal(await color('background'), '#202840');
    await button('Mail').click();
    assert.equal(await color('background'), 'oklch(1 0 0)');
    await button('Theme Studio').click();
    await page.getByLabel('Import a theme').setInputFiles({ name: 'fixture.yaml', mimeType: 'application/yaml',
      buffer: Buffer.from('version: 1\ntheme:\n  name: "Test studio"\n  background: "#223344"\n  headings: "serif"\n  sidebar_font_size: 18\n') });
    await page.getByText('Imported as a preview.', { exact: false }).waitFor();
    assert.equal(await color('background'), '#223344');
    assert.equal(await color('sidebar-size'), '18px');
    await button('Save theme').click();
    await button('Apply Test studio').waitFor();
    assert.equal(await page.locator('.saved-theme-preview').count(), 1);
    assert.equal(await button('Apply Test studio').locator('svg').count(), 1);
    assert.equal(await button('Delete Test studio').locator('svg').count(), 1);
    await page.reload();
    assert.equal(await color('background'), '#223344');
    await button('Theme Studio').click();
    await page.getByLabel('Export format').selectOption('json');
    await button('Export theme').click();
    await page.getByText('Theme exported.', { exact: true }).waitFor();
    const exported = await page.evaluate(() => window.exportFixture);
    assert.equal(JSON.parse(exported.contents).theme.heading, 'serif');
    assert.equal(JSON.parse(exported.contents).theme.background, '#223344');
    await button('Delete Test studio').click();
    assert.equal(await color('background'), '#223344');
    await button('Reset to Waypoint').click();
    assert.equal(await color('background'), 'oklch(1 0 0)');
    await page.setViewportSize({ width: 390, height: 740 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    if (process.env.THEME_SCREENSHOT) await page.screenshot({ path: process.env.THEME_SCREENSHOT });
    await page.setViewportSize({ width: 1280, height: 850 });
    await button('Contacts').click();
    await button('New contact').click();
    await page.getByLabel('Name', { exact: true }).fill('Fixture Contact');
    await page.getByLabel('Email', { exact: true }).fill('contact@example.test');
    await button('Save contact').click();
    await page.getByRole('heading', { name: 'Fixture Contact' }).waitFor();
    assert.equal(await page.locator('.people-card').count(), 1);
    const card = page.locator('.people-card');
    assert.ok((await card.boundingBox()).height >= 310);
    await card.locator('input[type=file]').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAE0lEQVR4nGNkaGDACpiwCw9WCQBqCACQJ5at+QAAAABJRU5ErkJggg==', 'base64') });
    await card.locator('.people-avatar img').waitFor();
    assert.match(await page.evaluate(() => window.avatarFixture), /^data:image\/jpeg;base64,/);
    await button('Remove photo').click();
    await card.locator('.people-avatar img').waitFor({ state: 'detached' });
    await card.evaluate((el) => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
      const bytes = atob(canvas.toDataURL('image/png').split(',')[1]);
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File([Uint8Array.from(bytes, (char) => char.charCodeAt(0))], 'dropped.png', { type: 'image/png' }));
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
    });
    await card.locator('.people-avatar img').waitFor();
    assert.equal(await button('Jump to contacts: F').isEnabled(), true);
    await page.getByLabel('Find a person').fill('not found');
    await page.getByText('No matching contacts.').waitFor();
    await page.getByLabel('Find a person').clear();
    await button('Compose to contact').click();
    assert.equal(await page.getByLabel('To', { exact: true }).inputValue(), 'contact@example.test');
    await button('Close').click();
    await button('Edit').click();
    await page.locator('#contact-dialog').getByLabel('Notes', { exact: true }).fill('Fixture note');
    await button('Save contact').click();
    await page.getByText('Fixture note', { exact: true }).waitFor();
    page.once('dialog', (dialog) => dialog.accept());
    await button('Delete').click();
    await page.getByText('Fixture Contact', { exact: true }).waitFor({ state: 'detached' });
    await button('Mail').click();
    await button('Collapse sidebar').click();
    assert.equal(await page.locator('#workspace-sidebar').isVisible(), true);
    assert.equal(await page.locator('.wordmark').isVisible(), true);
    for (const control of await page.locator('#workspace-sidebar .nav-item').all()) {
      assert.equal(await control.locator('.nav-label').isVisible(), false);
      assert.equal(await control.locator('.nav-icon').isVisible(), true);
      assert.equal(await control.getAttribute('title'), await control.getAttribute('aria-label'));
      const row = await control.boundingBox(), icon = await control.locator('.nav-icon').boundingBox();
      assert.ok(Math.abs((row.x + row.width / 2) - (icon.x + icon.width / 2)) < 2);
    }
    await button('Inbox').click();
    assert.equal(await button('Inbox').getAttribute('aria-current'), 'true');
    await button('Expand sidebar').click();
    await button('Sync Outlook Inbox').click();
    await page.getByText('Syncing Outlook Inbox:', { exact: false }).waitFor();
    assert.equal(await page.locator('.masthead #sync-status').count(), 0);
    const sidebar = await page.locator('#workspace-sidebar').boundingBox();
    const notice = await page.locator('#sync-notice').boundingBox();
    assert.ok(notice.x >= sidebar.x + sidebar.width - 1);
    assert.equal(await page.locator('.wordmark').evaluate((el) => getComputedStyle(el, '::after').height), '2px');
    await page.getByLabel('Unread', { exact: true }).check();
    await page.evaluate(() => { window.fixtureSyncDone = true; });
    await page.getByText('Outlook Inbox sync complete: 20 pages scanned, 111 messages added.', { exact: true }).waitFor();
    const logo = page.locator('.wordmark');
    assert.equal(await logo.evaluate((el) => getComputedStyle(el, '::after').content), 'none');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.wordmark-name'), '::after').opacity === '0.12');
    assert.equal(await page.locator('.wordmark-name').evaluate((el) => getComputedStyle(el, '::after').animationName), 'none');
    await page.getByLabel('Mail order').selectOption('oldest');
    await page.waitForFunction(() => window.searchFixture?.filters?.unread && window.searchFixture.filters.oldest);
    await button('Clear').click();
    await page.waitForFunction(() => !window.searchFixture?.filters?.unread && !window.searchFixture.filters.oldest);
    assert.equal(await page.locator('.masthead #search').count(), 1);
    await page.getByLabel('Search scope').selectOption('workspace');
    await page.getByLabel('Search workspace', { exact: true }).fill('fixture');
    await button('Search').click();
    for (const title of ['Contact result', 'Calendar result', 'Inbox folder']) await page.getByText(title, { exact: true }).waitFor();
    await page.waitForFunction(() => window.searchFixture?.search === 'fixture' && window.searchFixture.scope === 'all');
    await page.locator('.search-hit').filter({ hasText: 'Calendar result' }).click();
    assert.equal(await page.getByLabel('Calendar view').inputValue(), 'Day');
    await button('Mail').click();
    await page.getByLabel('Search workspace', { exact: true }).fill('tag:work');
    await page.getByLabel('Search scope', { exact: true }).selectOption('subfolders');
    await button('Search').click();
    await page.waitForFunction(() => window.searchFixture?.search === 'tag:work' && window.searchFixture.scope === 'subfolders');
    await page.locator('.mail-row').first().click();
    await button('Create event from email').click();
    assert.equal(await page.getByLabel('Title', { exact: true }).inputValue(), 'Fixture message');
    await page.locator('#cancel-event').click();
    await button('Compose').click();
    await page.waitForFunction(() => [...document.querySelector('#draft-to-addresses').options].some((option) => option.value === 'sent@example.test'));
    assert.equal(await page.locator('#draft-cc-addresses option').count(), 1);
    assert.equal(await page.locator('#draft-bcc-addresses option').count(), 1);
    await page.getByLabel('Subject', { exact: true }).fill('Draft smoke');
    await page.getByText('Draft saved locally.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.draftFixture.fields.subject), 'Draft smoke');
    await page.getByLabel('Message', { exact: true }).fill('Second version');
    await page.waitForFunction(() => window.draftFixture.fields.body === 'Second version' && window.draftFixture.expected?.revision === 1);
    await page.getByText('Draft saved locally.', { exact: true }).waitFor();
    const body = page.getByLabel('Message', { exact: true });
    await body.evaluate((el) => { el.focus(); el.select(); });
    await body.dispatchEvent('contextmenu', { clientX: 250, clientY: 250 });
    await page.getByLabel('Translate selection').selectOption('fr');
    assert.equal(await body.inputValue(), 'Texte de test');
    await page.once('dialog', (dialog) => dialog.accept());
    await button('Delete draft').click();
    await page.waitForFunction(() => window.deletedDraft?.id === 10);
    await button('Calendar').click();
    await page.locator('.calendar-month').waitFor();
    const bounds = await page.locator('.calendar-workspace').boundingBox();
    assert.ok(bounds.width > 900 && bounds.height > 700);
    await button('Next month').click();
    for (const view of ['Week', 'Day']) {
      await page.getByLabel('Calendar view').selectOption(view);
      await page.locator('.calendar-timeline').waitFor();
    }
    for (const view of ['Agenda', 'Month']) await page.getByLabel('Calendar view').selectOption(view);
    await button('Today').click();
    await button('New event').click();
    await page.getByLabel('Title', { exact: true }).fill('Calendar smoke');
    await button('Save event').click();
    const eventChip = () => page.getByRole('button', { name: /^Calendar smoke \|/ });
    await eventChip().click();
    await page.getByRole('heading', { name: 'Calendar smoke' }).waitFor();
    await button('Edit event').click();
    await page.getByLabel('Location', { exact: true }).fill('Library');
    await button('Save event').click();
    await eventChip().click();
    await page.getByText('Library', { exact: false }).waitFor();
    page.once('dialog', (dialog) => dialog.accept());
    await button('Edit event').click();
    await button('Delete event').click();
    await eventChip().waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
    console.log('Theme Studio smoke passed: exact default/dark tokens, preview/revert, legacy YAML, save/relaunch, export payload, library, narrow viewport, People, search scopes, draft autosave, and calendar create/edit/delete.');
  } finally {
    await browser?.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
