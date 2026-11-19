const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const protectedLink =
  'https://na01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fwww.aroac.com%2F&data=synthetic-only&reserved=0';

async function request(page, url, method = 'GET', body) {
  return page.evaluate(
    async ({ url, method, body }) => {
      const response = await fetch('/api' + url, {
        method,
        headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return response.json();
    },
    { url, method, body },
  );
}

test('Sent links are visible automatically; incoming Outlook Safe Links are readable after remote-content consent', async ({
  page,
}) => {
  if (!process.env.INKWELL_UI_DATA?.startsWith(path.join(os.tmpdir(), 'inkwell-ui-')))
    throw Error('Refusing to seed a non-test workspace');
  await page.goto('/#/inbox');
  const original = await request(page, '/preferences');
  await request(page, '/preferences', 'PUT', { ...original, preview_mode: 'html' });
  const ids = execFileSync(
    'uv',
    [
      'run',
      'python',
      '-c',
      `from inkwell import store
with store.db() as db:
 sent=db.execute('INSERT INTO messages(sender,recipient,subject,body,date,folder) VALUES (?,?,?,?,?,?)',('Me <me@example.org>','friend@example.org','Outbound link fixture','Find the project at https://www.aroac.com/ and source at https://github.com/vcsoc/aroac.','2099-01-01T12:00:00+00:00','sent')).lastrowid
 safe=${JSON.stringify(protectedLink)}
 markup='<p>Find the project at <a href="'+safe+'">'+safe+'</a>.</p><script>top.compromised=true</script>'
 incoming=db.execute('INSERT INTO messages(sender,recipient,subject,body,html_body,date,folder) VALUES (?,?,?,?,?,?,?)',('Me <me@example.org>','me@example.org','Incoming protected fixture','Find the project at '+safe,markup,'2099-01-01T12:00:01+00:00','inbox')).lastrowid
 print(sent,incoming)
`,
    ],
    {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, INKWELL_DATA_DIR: process.env.INKWELL_UI_DATA },
    },
  )
    .trim()
    .split(' ')
    .map(Number);
  try {
    await page.goto('/#/sent');
    await page.locator(`[data-message="${ids[0]}"]`).click();
    await expect(page.getByRole('switch', { name: 'Enable text links' })).toBeChecked();
    await expect(page.locator('.message-body a[href="https://www.aroac.com/"]')).toBeVisible();
    await expect(
      page.locator('.message-body a[href="https://github.com/vcsoc/aroac"]'),
    ).toBeVisible();

    await page.goto('/#/inbox');
    await page.locator(`[data-message="${ids[1]}"]`).click();
    const toggle = page.getByRole('switch', { name: 'Enable text links' });
    const frame = page.frameLocator('.html-message');
    await expect(toggle).not.toBeChecked(); // Spoofed From does not imply Sent ownership.
    await expect(frame.getByText('https://www.aroac.com/')).toBeVisible();
    await expect(frame.locator('a[href]')).toHaveCount(0);
    await page.getByLabel('Remote content options').selectOption('all');
    await expect(toggle).toBeChecked();
    await expect(frame.locator('a')).toHaveAttribute('href', protectedLink);
    await expect(frame.locator('a')).toHaveText('https://www.aroac.com/');
    await expect(page.locator('.html-message')).toHaveAttribute(
      'sandbox',
      'allow-popups allow-popups-to-escape-sandbox',
    );
    expect(await page.evaluate(() => window.compromised)).toBeUndefined();
    await page.screenshot({ path: `test-results/safe-links-${test.info().project.name}.png` });
    await page.reload();
    await page.locator(`[data-message="${ids[1]}"]`).click();
    await expect(page.getByRole('switch', { name: 'Enable text links' })).toBeChecked();
    await expect(page.frameLocator('.html-message').locator('a')).toHaveAttribute(
      'href',
      protectedLink,
    );
    await page.getByLabel('Remote content options').selectOption('block');
    await expect(page.getByRole('switch', { name: 'Enable text links' })).not.toBeChecked();
    await expect(page.frameLocator('.html-message').locator('a[href]')).toHaveCount(0);
  } finally {
    for (const id of ids) {
      await request(page, `/messages/${id}`, 'PATCH', { folder: 'trash' });
      await request(page, `/messages/${id}`, 'DELETE');
    }
    await request(page, '/preferences', 'PUT', original);
  }
});
