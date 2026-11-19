const { test, expect } = require('@playwright/test');
const { readerAction } = require('./helpers.cjs');
let original, prefix;
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
async function compose(page, data = {}) {
  await expect(page.locator('#heading-compose')).toBeVisible();
  await page.evaluate((data) => window.compose(data), { subject: prefix, ...data });
  await expect(page.locator('#compose-form')).toBeVisible();
}
async function image(page) {
  const content = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    const c = canvas.getContext('2d');
    c.fillStyle = 'red';
    c.fillRect(0, 0, 200, 200);
    c.fillStyle = 'blue';
    c.fillRect(200, 0, 200, 200);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return { name: 'drop.png', mimeType: 'image/png', buffer: Buffer.from(content, 'base64') };
}
test.beforeEach(async ({ page }) => {
  prefix = 'Composer media ' + Date.now() + Math.random();
  await page.route('**/api/accounts', (route) =>
    route.fulfill({
      json: [{ id: 999, name: 'Test sender', email: 'sender@example.test', provider: 'imap' }],
    }),
  );
  await page.route('**/api/accounts/999/senders', (route) =>
    route.fulfill({
      json: {
        addresses: [{ address: 'sender@example.test', source: 'account' }],
        default_from: 'sender@example.test',
      },
    }),
  );
  await page.goto('/');
  original = await api(page, '/preferences');
  await api(page, '/preferences', 'PUT', {
    ...original,
    form_mode: 'popup',
    layout: 'classic',
    ui_zoom: 100,
  });
  await page.reload();
});
test.afterEach(async ({ page }) => {
  if (await page.locator('#compose-form').isVisible()) {
    const discard = page.getByRole('button', { name: 'Discard failed addition' });
    if (await discard.isVisible()) await discard.click();
    await page.evaluate(() => window.inkwellFlushBeforeClose());
  }
  for (const message of await api(page, '/messages?folder=drafts&q=' + encodeURIComponent(prefix)))
    await api(page, '/messages/' + message.id, 'DELETE');
  await api(page, '/preferences', 'PUT', original);
});
test('attachments survive autosave, reopen and removal for new messages, replies and forwards', async ({
  page,
}) => {
  for (const subject of [prefix, 'Re: ' + prefix, 'Fwd: ' + prefix]) {
    await compose(page, {
      subject,
      body: subject.startsWith('Re:')
        ? 'Quoted reply'
        : subject.startsWith('Fwd:')
          ? 'Forwarded text'
          : '',
    });
    await page.locator('#compose-files').setInputFiles({
      name: 'report.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Attachment contents'),
    });
    await expect(page.getByLabel('Outgoing attachments')).toContainText('report.txt');
    await page.locator('#save-draft').click();
    await expect(page.locator('#modal')).not.toBeVisible();
    const saved = (
      await api(page, '/messages?folder=drafts&q=' + encodeURIComponent(subject))
    ).find((m) => m.subject === subject);
    const detail = await api(page, '/messages/' + saved.id);
    expect(detail.compose_attachments[0].content).toBe(
      Buffer.from('Attachment contents').toString('base64'),
    );
    await compose(page, detail);
    await expect(page.getByLabel('Outgoing attachments')).toContainText('report.txt');
    await page.getByRole('button', { name: 'Remove attachment report.txt' }).click();
    await page.locator('#save-draft').click();
    await expect(page.locator('#modal')).not.toBeVisible();
    expect((await api(page, '/messages/' + saved.id)).compose_attachments).toEqual([]);
  }
});
test('dropping an image inserts at the actual text caret, supports resizing, real pixel cropping and draft recovery', async ({
  page,
}) => {
  await compose(page, { body: 'Before AFTER' });
  await page.locator('#compose-format').click();
  const rich = page.locator('#compose-rich-body');
  const file = await image(page);
  await rich.evaluate((editor, base64) => {
    const text = editor.firstChild,
      range = document.createRange();
    range.setStart(text, 7);
    range.setEnd(text, 8);
    const bounds = range.getBoundingClientRect();
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'drop.png', { type: 'image/png' }));
    editor.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: bounds.left + 0.2,
        clientY: bounds.top + bounds.height / 2,
        dataTransfer: transfer,
      }),
    );
  }, file.buffer.toString('base64'));
  const img = rich.locator('img');
  await expect(img).toBeVisible();
  const placement = await rich.evaluate((editor) => {
    const img = editor.querySelector('img');
    return { before: img.previousSibling.textContent, after: img.nextSibling.textContent };
  });
  expect(placement).toEqual({ before: 'Before ', after: 'AFTER' });
  await page.getByRole('spinbutton', { name: 'Image width', exact: true }).fill('120');
  await expect(img).toHaveAttribute('width', '120');
  await expect(img).toHaveAttribute('height', '60');
  const handle = await page.locator('#compose-image-resize').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 30, handle.y + handle.height / 2 + 15, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(img).toHaveAttribute('width', '150');
  await expect(img).toHaveAttribute('height', '75');
  await page.getByRole('spinbutton', { name: 'Image width', exact: true }).fill('120');
  await page.getByRole('button', { name: 'Crop image', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Crop left', exact: true }).fill('200');
  await page.getByRole('spinbutton', { name: 'Crop width', exact: true }).fill('200');
  await page.getByRole('button', { name: 'Apply crop', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Crop inline image' })).toHaveCount(0);
  await expect.poll(() => img.evaluate((img) => img.naturalWidth)).toBe(200);
  const pixel = await img.evaluate((img) => {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    c.getContext('2d').drawImage(img, 0, 0, 1, 1);
    return Array.from(c.getContext('2d').getImageData(0, 0, 1, 1).data);
  });
  expect(pixel).toEqual([0, 0, 255, 255]);
  await page.locator('#save-draft').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  const saved = (await api(page, '/messages?folder=drafts&q=' + encodeURIComponent(prefix)))[0];
  const detail = await api(page, '/messages/' + saved.id);
  expect(detail.html_body).toContain('cid:');
  expect(detail.html_body).not.toContain('data:image');
  expect(detail.compose_attachments).toHaveLength(1);
  expect(detail.compose_attachments[0].inline).toBe(true);
  await compose(page, detail);
  await expect(page.locator('#compose-rich-body img')).toBeVisible();
  await expect
    .poll(() => page.locator('#compose-rich-body img').evaluate((img) => img.naturalWidth))
    .toBe(200);
  await page.screenshot({
    path: `test-results/composer-media-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test('the message fills the remaining composer height in popup and inline modes without page scrolling', async ({
  page,
}) => {
  for (const form_mode of ['popup', 'inline']) {
    await api(page, '/preferences', 'PUT', {
      ...original,
      form_mode,
      layout: 'classic',
      ui_zoom: 100,
    });
    await page.reload();
    await compose(page);
    const geometry = await page.evaluate(() => {
      const body = document.querySelector('[name=body]').getBoundingClientRect(),
        modal = document.querySelector('#modal').getBoundingClientRect(),
        actions = document.querySelector('#compose-form .form-actions').getBoundingClientRect();
      return {
        body,
        modal,
        actions,
        h: innerHeight,
        scroll: document.documentElement.scrollHeight,
        client: document.documentElement.clientHeight,
        gap: actions.top - body.bottom,
      };
    });
    expect(geometry.modal.bottom).toBeLessThanOrEqual(geometry.h + 1);
    expect(geometry.actions.bottom).toBeLessThanOrEqual(geometry.h + 1);
    expect(geometry.body.height).toBeGreaterThan(110);
    expect(geometry.gap).toBeLessThan(70);
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
    await page.evaluate(() => window.inkwellFlushBeforeClose());
  }
});
test('composer remains full height when application zoom changes', async ({ page }) => {
  for (const form_mode of ['popup', 'inline']) {
    await api(page, '/preferences', 'PUT', {
      ...original,
      form_mode,
      layout: 'classic',
      ui_zoom: 100,
    });
    await page.reload();
    await compose(page);
    for (const zoom of [0.75, 1, 1.1]) {
      await page.evaluate((zoom) => {
        document.documentElement.style.zoom = zoom;
      }, zoom);
      await expect
        .poll(() =>
          page
            .locator('#modal')
            .evaluate((modal) =>
              Math.abs(
                (modal.classList.contains('inline-form') &&
                document.querySelector('.mobile-tabs').getBoundingClientRect().height
                  ? document.querySelector('.mobile-tabs').getBoundingClientRect().top
                  : innerHeight) - modal.getBoundingClientRect().bottom,
              ),
            ),
        )
        .toBeLessThan(42);
      expect(
        await page
          .locator('#compose-form .form-actions')
          .evaluate((actions) => actions.getBoundingClientRect().bottom <= innerHeight + 1),
      ).toBe(true);
    }
    await page.evaluate(() => window.inkwellFlushBeforeClose());
  }
});

test('send payload includes attached bytes, CID HTML and resized image dimensions', async ({
  page,
}) => {
  let sent;
  await page.route('**/api/send', async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ json: { id: 123 } });
  });
  await compose(page, { recipient: 'recipient@example.test', body: 'Hello' });
  await page
    .locator('#compose-files')
    .setInputFiles({ name: 'report.txt', mimeType: 'text/plain', buffer: Buffer.from('report') });
  await page.locator('#compose-insert-image').click();
  await expect(page.locator('#modal')).toBeVisible();
  await page.locator('#compose-images').setInputFiles(await image(page));
  await expect(page.locator('#compose-rich-body img')).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Image width', exact: true }).fill('100');
  await page.getByRole('button', { name: 'Send message', exact: false }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  expect(sent.attachments).toHaveLength(2);
  expect(sent.attachments.some((f) => f.name === 'report.txt' && !f.inline)).toBe(true);
  expect(sent.html_body).toContain('width="100"');
  expect(sent.html_body).toContain('cid:');
  expect(sent.html_body).not.toContain('data:image');
});

test('compact reply envelope and clean writing surface work in dark and light themes', async ({
  page,
}) => {
  if (test.info().project.name === 'desktop')
    await page.setViewportSize({ width: 1910, height: 1046 });
  const theme = {
    ...original.theme,
    name: 'Composer review',
    background: '#171c22',
    surface: '#1e232a',
    text: '#e8ecf3',
    muted: '#a4acb8',
    border: '#343b44',
    accent: '#76a88b',
    accent_text: '#17231c',
    selection: '#25382f',
    dark: true,
  };
  await api(page, '/preferences', 'PUT', {
    ...original,
    theme,
    form_mode: 'inline',
    layout: 'classic',
    ui_zoom: 100,
  });
  await page.reload();
  await expect(page.locator('#heading-compose')).toBeVisible();
  const data = await page.evaluate(() =>
    window.InkwellComposeQuote(
      {
        sender: 'Alex <alex@example.test>',
        account_id: 999,
        subject: 'Project update',
        date: '2026-10-27T14:30:00Z',
        body: '\n\n> \n> > \nHello team,\n\n\nHere is the project update.\n\nThank you,\nAlex\n\n',
      },
      'reply',
    ),
  );
  data.subject = 'Re: ' + prefix;
  await compose(page, data);
  await expect(page.locator('#modal-title')).toHaveText('Reply');
  await expect(page.locator('.compose-sender-info')).not.toHaveAttribute('open', '');
  const geometry = await page.evaluate(() => ({
    envelope: document.querySelector('.compose-envelope').getBoundingClientRect().height,
    body: document.querySelector('[name=body]').getBoundingClientRect().height,
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(geometry.envelope).toBeLessThan(170);
  expect(geometry.body).toBeGreaterThan(200);
  expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);
  const body = await page.locator('[name=body]').inputValue();
  expect(body).not.toMatch(/\n{3}/);
  expect(body).not.toMatch(/^[> \t]+$/m);
  await page.screenshot({
    path: `test-results/composer-redesign-dark-${test.info().project.name}.png`,
    fullPage: false,
  });
  await page.getByRole('button', { name: 'Cc', exact: true }).click();
  await expect(page.locator('[name=cc]')).toBeVisible();
  await page.getByLabel('Sender information', { exact: true }).click();
  await expect(page.locator('#sender-status')).toContainText('exact From address');
  await page.evaluate(() => window.inkwellFlushBeforeClose());
  await api(page, '/preferences', 'PUT', {
    ...original,
    form_mode: 'popup',
    layout: 'classic',
    ui_zoom: 100,
  });
  await page.reload();
  await compose(page, { ...data, compose_action: 'forward' });
  await expect(page.locator('#modal-title')).toHaveText('Forward');
  await page.screenshot({
    path: `test-results/composer-redesign-light-${test.info().project.name}.png`,
    fullPage: false,
  });
});

test('both reply entry points and forwards compact quotes while leaving received text untouched', async ({
  page,
}) => {
  const originalBody = '\n\n> \n> > \nFirst paragraph\n\n\nSecond paragraph\n\n';
  const source = await api(page, '/drafts', 'POST', {
    subject: prefix + ' source',
    body: originalBody,
    from_address: 'alex@example.test',
  });
  await api(page, '/messages/' + source.id, 'PATCH', { folder: 'inbox' });
  try {
    for (const entry of ['reply', 'forward', 'reader-reply', 'reader-forward']) {
      const action = entry.replace('reader-', '');
      if (entry.startsWith('reader-')) {
        await page.evaluate((id) => window.openMessage(id), source.id);
        const name = action === 'reply' ? 'Reply' : 'Forward';
        await readerAction(page, name, name);
      } else
        await page.evaluate(({ action, id }) => window.messageAction(action, id), {
          action,
          id: source.id,
        });
      await expect(page.locator('#compose-form')).toBeVisible();
      const body = await page.locator('[name=body]').inputValue();
      expect(body).not.toMatch(/\n{3}/);
      expect(body).not.toMatch(/^[> \t]+$/m);
      expect(body).toContain('First paragraph');
      expect(body).toContain('Second paragraph');
      await page.evaluate(() => window.inkwellFlushBeforeClose());
    }
    expect((await api(page, '/messages/' + source.id)).body).toBe(originalBody);
  } finally {
    await api(page, '/messages/' + source.id, 'PATCH', { folder: 'trash' });
    await api(page, '/messages/' + source.id, 'DELETE');
  }
});

test('formatting controls work without changing intentional draft spacing', async ({ page }) => {
  const typed = 'Hello\n\n\nKeep my spacing\n';
  await compose(page, { body: typed });
  await expect(page.locator('[name=body]')).toHaveValue(typed);
  await page.locator('#compose-format').click();
  const rich = page.locator('#compose-rich-body');
  await rich.evaluate((editor) => {
    editor.focus();
    const range = document.createRange();
    range.setStart(editor.firstChild, 0);
    range.setEnd(editor.firstChild, 5);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(rich.locator('b,strong')).toHaveText('Hello');
  await page.locator('#save-draft').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  const draft = (await api(page, '/messages?folder=drafts&q=' + encodeURIComponent(prefix)))[0];
  const saved = await api(page, '/messages/' + draft.id);
  expect(saved.body).toBe(typed);
  expect(saved.html_body).toMatch(/<(b|strong)>Hello<\/(b|strong)>/);
});

test('wide composers retain a readable list and adapt without losing edits or attachments', async ({
  page,
}) => {
  test.skip(
    test.info().project.name === 'mobile',
    'Wide desktop layout; narrow composers are covered separately',
  );
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1910, height: 1046 });
  const source = await api(page, '/drafts', 'POST', {
    subject: prefix + ' inbox reference',
    body: 'A reference conversation.',
    from_address: 'alex@example.test',
  });
  await api(page, '/messages/' + source.id, 'PATCH', { folder: 'inbox' });
  try {
    for (const [mode, layout] of ['inline', 'popup'].flatMap((mode) =>
      ['classic', 'focus', 'stacked', 'list'].map((layout) => [mode, layout]),
    )) {
      await api(page, '/preferences', 'PUT', {
        ...original,
        form_mode: mode,
        layout,
        mail_view: layout === 'list' ? 'table' : 'cards',
        ui_zoom: 100,
      });
      await page.reload();
      for (const action of layout === 'classic' ? ['new', 'reply', 'forward'] : ['new']) {
        const data =
          action === 'new'
            ? {}
            : await page.evaluate(
                ({ source, action }) => window.InkwellComposeQuote(source, action),
                { source: { ...source, sender: 'Alex <alex@example.test>' }, action },
              );
        await compose(page, { ...data, subject: prefix + ' ' + mode + ' ' + action });
        await expect(page.locator('html')).toHaveAttribute('data-compose-split', mode);
        const list = await page.locator('#message-list').boundingBox(),
          dialog = await page.locator('#modal').boundingBox();
        expect(list.width).toBeGreaterThan(270);
        expect(list.x + list.width).toBeLessThanOrEqual(dialog.x + 1);
        expect(dialog.width).toBeGreaterThan(550);
        await expect(page.locator('#message-list')).toContainText('inbox reference');
        const typed = 'My ' + action + ' draft\n\nKeep this paragraph';
        await page.locator('[name=body]').fill(typed);
        await page.locator('#compose-files').setInputFiles({
          name: 'reference.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('reference'),
        });
        await expect(page.locator('.compose-file')).toHaveCount(1);
        if (action === 'reply')
          await page.screenshot({ path: `test-results/composer-list-${mode}.png` });
        await page.setViewportSize({ width: 900, height: 800 });
        await expect(page.locator('html')).not.toHaveAttribute('data-compose-split');
        await expect(page.locator('[name=body]')).toHaveValue(typed);
        await expect(page.locator('.compose-file')).toHaveCount(1);
        await page.setViewportSize({ width: 1910, height: 1046 });
        await expect(page.locator('html')).toHaveAttribute('data-compose-split', mode);
        await expect(page.locator('[name=body]')).toHaveValue(typed);
        await page.evaluate(() => {
          document.documentElement.style.zoom = '2';
        });
        await expect(page.locator('html')).not.toHaveAttribute('data-compose-split');
        await page.evaluate(() => {
          document.documentElement.style.zoom = '1';
        });
        await expect(page.locator('html')).toHaveAttribute('data-compose-split', mode);
        if (action !== 'forward') {
          await page.locator('#delete-draft').click();
          await expect(page.locator('#modal')).not.toBeVisible();
        } else {
          const row = await page.locator(`[data-message="${source.id}"]`).boundingBox();
          await page.mouse.click(row.x + 50, row.y + 20);
          await expect(page.locator('#modal')).not.toBeVisible();
          const drafts = await api(
            page,
            '/messages?folder=drafts&q=' + encodeURIComponent(prefix + ' ' + mode + ' ' + action),
          );
          expect(drafts).toHaveLength(1);
          const saved = await api(page, '/messages/' + drafts[0].id);
          expect(saved.body).toBe(typed);
          expect(saved.compose_attachments).toHaveLength(1);
        }
        await expect(page.locator('html')).not.toHaveAttribute('data-compose-split');
        await expect(page.locator('#workspace')).toBeVisible();
      }
    }
  } finally {
    await api(page, '/messages/' + source.id, 'PATCH', { folder: 'trash' });
    await api(page, '/messages/' + source.id, 'DELETE');
  }
});
