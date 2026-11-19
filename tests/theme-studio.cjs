// Run with Playwright installed: node tests/theme-studio.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

(async () => {
  const files = { '/': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'],
    '/waypoint.css': ['waypoint.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'],
    '/theme-files.js': ['theme-files.js', 'text/javascript'], '/theme.js': ['theme.js', 'text/javascript'] };
  const server = http.createServer(async (request, response) => {
    const item = files[request.url];
    if (!item) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', item[1]);
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'");
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
      window.__TAURI__ = { core: { invoke: async (name, args) => {
        if (name === 'folders') return [{ key: 'inbox', label: 'Inbox' }];
        if (name === 'messages') return { rows: [], more: false };
        if (name === 'export_theme') { window.exportFixture = args; return true; }
        return [];
      } } };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
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
    assert.deepEqual(errors, []);
    console.log('Theme Studio smoke passed: exact default/dark tokens, preview/revert, legacy YAML, save/relaunch, export payload, library, narrow viewport.');
  } finally {
    await browser?.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
