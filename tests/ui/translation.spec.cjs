const { test, expect } = require('@playwright/test');
const { DatabaseSync } = require('node:sqlite');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { sidebarClick } = require('./helpers.cjs');
let original, ids, files, calls;
const source = 'Before Hello world. After';
const translated = 'Bonjour le monde.';
async function api(page, url, method = 'GET', body) {
  return page.evaluate(
    async ({ url, method, body }) => {
      const response = await fetch('/api' + url, {
        method,
        headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw Error(await response.text());
      return response.json();
    },
    { url, method, body },
  );
}
async function createMail(page, folder = 'inbox', html = null) {
  const message = await api(page, '/drafts', 'POST', {
    subject: 'Translation ' + Date.now(),
    body: source,
  });
  ids.push(message.id);
  if (folder !== 'drafts') await api(page, '/messages/' + message.id, 'PATCH', { folder });
  const db = new DatabaseSync(path.join(process.env.INKWELL_UI_DATA, 'inkwell.db'));
  db.exec('PRAGMA busy_timeout=5000');
  db.prepare('UPDATE messages SET date=?, html_body=? WHERE id=?').run(
    '2099-01-01T12:00:00Z',
    html,
    message.id,
  );
  db.close();
  await page.goto('/#/' + folder);
  await page.reload();
  await expect(page.locator(`[data-message="${message.id}"]`)).toBeVisible();
  await page.locator(`[data-message="${message.id}"]`).click();
  return message.id;
}
async function selectText(locator, text = 'Hello world.') {
  await locator.evaluate((root, text) => {
    if (root.tagName === 'TEXTAREA') {
      root.focus();
      const start = root.value.indexOf(text);
      if (start < 0) throw Error('Missing fixture text');
      root.setSelectionRange(start, start + text.length);
    } else {
      const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const start = node.textContent.indexOf(text);
        if (start < 0) continue;
        const range = root.ownerDocument.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + text.length);
        const selection = root.ownerDocument.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        break;
      }
      if (!node) throw Error('Missing fixture text');
    }
    const box = root.getBoundingClientRect();
    root.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: box.left + 30,
        clientY: box.top + 30,
      }),
    );
  }, text);
}
async function chooseFrench(page) {
  await page.getByRole('menuitem', { name: 'Translate ▸', exact: true }).click();
  await page
    .getByRole('menu', { name: 'Translation languages' })
    .getByRole('menuitem', { name: 'French', exact: true })
    .click();
}
test.beforeEach(async ({ page }) => {
  ids = [];
  files = [];
  calls = [];
  if (!process.env.INKWELL_UI_DATA?.startsWith(path.join(os.tmpdir(), 'inkwell-ui-')))
    throw Error('Unsafe fixture path');
  await page.route('**/api/translation', (route) => {
    if (route.request().method() === 'POST') {
      calls.push(route.request().postDataJSON());
      return route.fulfill({ json: { translation: translated, language: 'fr', local: true } });
    }
    return route.fulfill({
      json: {
        ready: true,
        runtime_ready: true,
        model_ready: true,
        model: 'Local test model',
        downloading: false,
        downloaded: 0,
        size: 2497281120,
      },
    });
  });
  await page.goto('/');
  original = await api(page, '/preferences');
  await api(page, '/preferences', 'PUT', {
    ...original,
    layout: 'classic',
    form_mode: 'popup',
    preview_mode: 'html',
    mail_view: 'cards',
  });
  await page.reload();
});
test.afterEach(async ({ page }) => {
  // Close the composer through Save before cleanup so no close-time autosave races deletion.
  if (await page.locator('#modal[open] #compose-form').isVisible()) {
    await page.locator('#save-draft').click();
    await expect(page.locator('#modal')).not.toBeVisible();
  }
  for (const id of ids) {
    await api(page, '/messages/' + id, 'PATCH', { folder: 'trash' });
    await api(page, '/messages/' + id, 'DELETE');
  }
  for (const file of files)
    fs.rmSync(path.join(process.env.INKWELL_UI_DATA, 'Documents', file), { force: true });
  if (original) await api(page, '/preferences', 'PUT', original);
});
test('received text translates only the selection inline and toggles without changing cached mail', async ({
  page,
}) => {
  const id = await createMail(page);
  const body = page.locator('#reader .message-body');
  await selectText(body);
  await chooseFrench(page);
  await expect(body).toContainText('Before ' + translated + 'original After');
  expect(calls).toEqual([{ text: 'Hello world.', language: 'fr' }]);
  await body.getByRole('button', { name: 'Show original text' }).click();
  await expect(body).toContainText('Hello world.');
  await body.getByRole('button', { name: 'Show translated text' }).click();
  await expect(body).toContainText(translated);
  expect((await api(page, '/messages/' + id)).body).toBe(source);
});
test('opaque HTML mail allows only the trusted translation bridge and keeps remote content blocked', async ({
  page,
}) => {
  const id = await createMail(
    page,
    'inbox',
    '<p>Before <b>Hello world.</b> After</p><script>top.stolen=true</script><img src="https://evil.test/pixel">',
  );
  const frame = page.frameLocator('.html-message'),
    body = frame.locator('#inkwell-mail-body');
  await expect(body).toContainText('Hello world.');
  await expect(page.locator('.html-message')).toHaveAttribute('sandbox', 'allow-scripts');
  expect(await page.locator('.html-message').evaluate((frame) => frame.contentDocument)).toBeNull();
  await selectText(body);
  await chooseFrench(page);
  await expect(body).toContainText(translated);
  await body.getByRole('button', { name: 'Show original text' }).click();
  await expect(body.locator('b')).toContainText('Hello world.');
  await expect(frame.locator('img[src], #inkwell-mail-body script')).toHaveCount(0);
  expect(await page.evaluate(() => window.stolen)).toBeUndefined();
  expect((await api(page, '/messages/' + id)).body).toBe(source);
});
test('draft translation stays editable, autosaves the shown variant and never includes pill text', async ({
  page,
}) => {
  const id = await createMail(page, 'drafts');
  await selectText(page.locator('#compose-form textarea[name="body"]'));
  await chooseFrench(page);
  const editor = page.locator('#compose-form .translation-editor');
  await expect(editor).toContainText(translated);
  await expect
    .poll(async () => (await api(page, '/messages/' + id)).body)
    .toBe('Before ' + translated + ' After');
  await editor.getByRole('button', { name: 'Show original text' }).click();
  await expect.poll(async () => (await api(page, '/messages/' + id)).body).toBe(source);
  await editor.getByRole('button', { name: 'Show translated text' }).click();
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' More');
  await page.locator('#save-draft').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  const body = (await api(page, '/messages/' + id)).body;
  expect(body).toContain(translated);
  expect(body).toContain(' More');
  expect(body).not.toContain('original');
  expect(body).not.toContain('translated');
});
test('translated draft editors preserve trailing blank lines and Enter creates exactly one newline', async ({
  page,
}) => {
  await createMail(page, 'drafts');
  const field = page.locator('#compose-form textarea[name="body"]');
  await field.fill(source + '\n\n');
  await selectText(field);
  await chooseFrench(page);
  const editor = page.locator('#compose-form .translation-editor');
  await expect(field).toHaveValue('Before ' + translated + ' After\n\n');
  await editor.focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Next line');
  await expect(field).toHaveValue('Before ' + translated + ' After\n\n\nNext line');
});

test('a late translation never overwrites edits typed while the local model is working', async ({
  page,
}) => {
  await createMail(page, 'drafts');
  let finish;
  await page.route('**/api/translation', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await new Promise((resolve) => {
      finish = resolve;
    });
    return route.fulfill({ json: { translation: translated, language: 'fr', local: true } });
  });
  const body = page.locator('#compose-form textarea[name="body"]');
  await selectText(body);
  await chooseFrench(page);
  await expect.poll(() => !!finish).toBe(true);
  await body.fill(source + ' Unsaved edit');
  finish();
  await expect(page.locator('#toast')).toContainText('Your edits were kept');
  await expect(body).toHaveValue(source + ' Unsaved edit');
  await expect(page.locator('.translation-pill')).toHaveCount(0);
});
async function createDocument(page, extension, content) {
  const name = 'translation-' + Date.now() + '.' + extension;
  await api(page, '/documents/file', 'POST', { name });
  files.push(name);
  const doc = await api(page, '/documents/open?path=' + encodeURIComponent(name));
  await api(page, '/documents/content', 'PUT', { path: name, revision: doc.revision, content });
  await page.goto('/#/documents');
  await sidebarClick(page, '#doc-tree [data-doc-file="' + name + '"]');
  return name;
}
test('Word translation preserves formatting on toggle and saves only visible document content', async ({
  page,
}) => {
  const name = await createDocument(page, 'docx', '<p>Before <b>Hello world.</b> After</p>');
  const editor = page.locator('#doc-rich-editor');
  await selectText(editor);
  await chooseFrench(page);
  await expect(editor).toContainText(translated);
  await editor.getByRole('button', { name: 'Show original text' }).click();
  await expect(editor.locator('strong,b').first()).toContainText('Hello world.');
  await editor.getByRole('button', { name: 'Show translated text' }).click();
  await expect(editor).toContainText(translated);
  await page.locator('#doc-save').click();
  await expect(page.locator('#doc-status')).toContainText('Saved to Documents');
  const saved = (await api(page, '/documents/open?path=' + encodeURIComponent(name))).content;
  expect(saved).toContain(translated);
  expect(saved).not.toContain('original');
  expect(saved).not.toContain('translation-pill');
});
test('Markdown/text translation has a real inline toggle and keeps plain file serialization clean', async ({
  page,
}) => {
  const name = await createDocument(page, 'md', '# Heading\n\n' + source + '\n');
  await selectText(page.locator('#doc-code-editor'));
  await chooseFrench(page);
  const editor = page.locator('.translation-code-editor');
  await expect(editor).toContainText(translated);
  await editor.getByRole('button', { name: 'Show original text' }).click();
  await expect(page.locator('#doc-code-editor')).toHaveValue('# Heading\n\n' + source + '\n');
  await editor.getByRole('button', { name: 'Show translated text' }).click();
  await page.locator('#doc-save').click();
  await expect(page.locator('#doc-status')).toContainText('Saved to Documents');
  expect((await api(page, '/documents/open?path=' + encodeURIComponent(name))).content).toBe(
    '# Heading\n\nBefore ' + translated + ' After\n',
  );
});
test('PDF text can be highlighted and translated as a reversible view without changing original bytes', async ({
  page,
}) => {
  const name = 'translation-' + Date.now() + '.pdf';
  files.push(name);
  execFileSync(
    'uv',
    [
      'run',
      'python',
      '-c',
      'import pymupdf,os;from pathlib import Path;p=Path(os.environ["INKWELL_DOCUMENTS_DIR"]);p.mkdir(parents=True,exist_ok=True);d=pymupdf.open();d.new_page().insert_text((50,60),"Hello world.");d.save(p/' +
        JSON.stringify(name) +
        ')',
    ],
    {
      env: {
        ...process.env,
        INKWELL_DOCUMENTS_DIR: path.join(process.env.INKWELL_UI_DATA, 'Documents'),
      },
    },
  );
  const file = path.join(process.env.INKWELL_UI_DATA, 'Documents', name),
    originalBytes = fs.readFileSync(file);
  await page.goto('/#/documents');
  await sidebarClick(page, '#doc-tree [data-doc-file="' + name + '"]');
  const layer = page.locator('.doc-pdf-text-layer');
  await expect(layer).toContainText('Hello world.');
  await selectText(layer);
  await chooseFrench(page);
  const overlay = page.locator('.translation-pdf-overlay');
  await expect(overlay).toContainText(translated);
  await overlay.getByRole('button', { name: 'Show original text' }).click();
  await expect(overlay).toContainText('Hello world.');
  expect(fs.readFileSync(file).equals(originalBytes)).toBe(true);
  await expect(page.locator('#doc-save')).toBeDisabled();
});
test('model markup is rendered as literal text, not executable HTML', async ({ page }) => {
  await createMail(page);
  await page.route('**/api/translation', (route) =>
    route.fulfill({
      json: {
        translation: '<img src="https://evil.test" onerror="top.stolen=true">',
        language: 'fr',
        local: true,
      },
    }),
  );
  const body = page.locator('#reader .message-body');
  await selectText(body);
  await chooseFrench(page);
  await expect(body).toContainText('<img src=');
  await expect(body.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.stolen)).toBeUndefined();
});

test('Undo and redo retain the original toggle and plain draft content', async ({ page }) => {
  const id = await createMail(page, 'drafts');
  await selectText(page.locator('#compose-form textarea[name="body"]'));
  await chooseFrench(page);
  const editor = page.locator('#compose-form .translation-editor');
  await expect(editor).toContainText(translated);
  await editor.focus();
  await page.keyboard.press('Control+z');
  await expect(editor).toHaveText(source);
  await expect(page.locator('#compose-form textarea[name="body"]')).toHaveValue(source);
  await page.keyboard.press('Control+Shift+z');
  await expect(editor).toContainText(translated);
  await editor.getByRole('button', { name: 'Show original text' }).click();
  await expect.poll(async () => (await api(page, '/messages/' + id)).body).toBe(source);
});

test('first use explains the model download and translates only after explicit setup', async ({
  page,
}) => {
  let downloaded = false,
    downloads = 0;
  await page.route('**/api/translation', (route) => {
    if (route.request().method() === 'POST')
      return route.fulfill(
        downloaded
          ? { json: { translation: translated, language: 'fr', local: true } }
          : {
              status: 409,
              json: {
                detail:
                  'Local translation needs its model. Open Settings → AI assistant → Local translation.',
              },
            },
      );
    return route.fulfill({
      json: {
        ready: downloaded,
        model_ready: downloaded,
        runtime_ready: true,
        downloading: false,
        size: 2497281120,
      },
    });
  });
  await page.route('**/api/translation/install', (route) => {
    expect(route.request().postDataJSON()).toEqual({ download: true });
    downloaded = true;
    downloads++;
    return route.fulfill({
      json: {
        ready: true,
        model_ready: true,
        runtime_ready: true,
        downloading: false,
        size: 2497281120,
      },
    });
  });
  await createMail(page);
  const body = page.locator('#reader .message-body');
  await selectText(body);
  await chooseFrench(page);
  const dialog = page.locator('#translation-setup');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('2.5 GB');
  expect(downloads).toBe(0);
  await expect(body).toHaveText(source);
  await dialog.getByRole('button', { name: 'Download model and translate', exact: true }).click();
  await expect(body).toContainText(translated);
  expect(downloads).toBe(1);
});

test('closing model setup cancels automatic translation even if a pending status request finishes ready', async ({
  page,
}) => {
  let downloading = false,
    releaseStatus,
    requests = 0;
  await page.route('**/api/translation', async (route) => {
    if (route.request().method() === 'POST') {
      requests++;
      return route.fulfill({ status: 409, json: { detail: 'Local translation needs its model.' } });
    }
    if (downloading) {
      await new Promise((resolve) => {
        releaseStatus = resolve;
      });
      return route.fulfill({
        json: { ready: true, runtime_ready: true, downloading: false, size: 2497281120 },
      });
    }
    return route.fulfill({
      json: { ready: false, runtime_ready: true, downloading: false, size: 2497281120 },
    });
  });
  await page.route('**/api/translation/install', (route) => {
    downloading = true;
    return route.fulfill({
      json: {
        ready: false,
        runtime_ready: true,
        downloading: true,
        downloaded: 0,
        size: 2497281120,
      },
    });
  });
  await createMail(page);
  const body = page.locator('#reader .message-body');
  await selectText(body);
  await chooseFrench(page);
  const dialog = page.locator('#translation-setup');
  await dialog.getByRole('button', { name: 'Download model and translate', exact: true }).click();
  await expect.poll(() => !!releaseStatus).toBe(true);
  await dialog.getByRole('button', { name: 'Close (download continues)', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const reply = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/translation') && response.request().method() === 'GET',
  );
  releaseStatus();
  await reply;
  await expect(page.locator('#mail-activity')).toHaveAttribute('aria-hidden', 'true');
  await expect(body).toHaveText(source);
  expect(requests).toBe(1);
  await expect(body.locator('.translation-pill')).toHaveCount(0);
});
