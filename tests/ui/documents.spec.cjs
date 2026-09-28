const { test, expect } = require('@playwright/test');

async function revealTree(page) {
  await expect(page.locator('#doc-tree')).toBeAttached();
  if (!(await page.locator('#doc-tree').isVisible())) await page.locator('#menu').click();
  await expect(page.locator('#doc-tree')).toBeVisible();
}

async function createItem(page, kind, name) {
  await page.locator(kind === 'folder' ? '#doc-new-folder' : '#doc-new-file').click();
  await expect(page.locator('#doc-create-dialog')).toBeVisible();
  await page.locator('#doc-create-name').fill(name);
  await page.locator('#doc-create-submit').click();
  await expect(page.locator('#doc-create-dialog')).not.toBeVisible();
}

test('Documents rail, folder tree, recent files, text editing and conflict-safe save', async ({
  page,
}, info) => {
  const file = `notes-${info.project.name}-${Date.now()}.md`;
  await page.goto('/#/documents');
  await expect(page.locator('#documents-workspace')).toBeVisible();
  await revealTree(page);
  await expect(page.locator(`[data-view="documents"]:visible`)).toHaveClass(/active/);
  await createItem(page, 'file', file);
  await expect(page.locator('#doc-file-name')).toHaveText(file);
  await expect(page.locator('#doc-code-editor')).toBeVisible();
  await page.locator('#doc-code-editor').fill('# My notes\nA working draft');
  await expect(page.locator('#doc-save')).toBeEnabled();
  await page.locator('#doc-line-numbers').check();
  await expect(page.locator('#doc-code-lines')).toContainText('2');
  await page.locator('#doc-code-editor').press('ControlOrMeta+s');
  await expect(page.locator('#doc-status')).toHaveText('Saved to Documents');
  await page.reload();
  await revealTree(page);
  await page
    .locator('#doc-recent')
    .getByRole('button', { name: new RegExp(file) })
    .click();
  await expect(page.locator('#doc-code-editor')).toHaveValue('# My notes\nA working draft');
  await page.locator('#doc-preview').click();
  await expect(page.locator('#doc-markdown-preview h1')).toHaveText('My notes');
  await page.locator('#doc-code-editor').fill('Unsaved');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('[data-view="inbox"]:visible').click();
  await expect(page).toHaveURL(/#\/documents$/);
});

test('New document dialog validates names, protects unsaved edits and preserves existing files', async ({
  page,
}, info) => {
  const name = `safe-${info.project.name}-${Date.now()}.md`;
  await page.goto('/#/documents');
  await revealTree(page);
  await page.locator('#doc-new-file').click();
  await expect(page.locator('#doc-create-name')).toHaveValue('Untitled.docx');
  await page.locator('#doc-create-cancel').click();
  await expect(page.locator('#doc-create-dialog')).not.toBeVisible();
  await page.locator('#doc-new-file').click();
  await page.locator('#doc-create-name').fill('no-extension');
  await page.locator('#doc-create-submit').click();
  await expect(page.locator('#doc-create-error')).toContainText('supported document format');
  await page.locator('#doc-create-name').fill(name);
  await page.locator('#doc-create-submit').click();
  await expect(page.locator('#doc-file-name')).toHaveText(name);
  await page.locator('#doc-code-editor').fill('Keep this draft');
  await revealTree(page);
  await page.locator('#doc-new-file').click();
  await page.locator('#doc-create-name').fill('other.md');
  await page.locator('#doc-create-submit').click();
  await expect(page.locator('#doc-create-error')).toContainText('Save your current document');
  await page.locator('#doc-create-cancel').click();
  await expect(page.locator('#doc-code-editor')).toHaveValue('Keep this draft');
  await page.keyboard.press('Escape');
  await page.locator('#doc-save').click();
  await revealTree(page);
  await page.locator('#doc-new-file').click();
  await page.locator('#doc-create-name').fill(name);
  await page.locator('#doc-create-submit').click();
  await expect(page.locator('#doc-create-error')).toContainText('already has that name');
  await page.locator('#doc-create-cancel').click();
  await expect(page.locator('#doc-file-name')).toHaveText(name);
  await expect(page.locator('#doc-code-editor')).toHaveValue('Keep this draft');
});

test('Nested folders expand and newly created files open from their selected folder', async ({
  page,
}, info) => {
  const folder = `drafts-${info.project.name}-${Date.now()}`;
  await page.goto('/#/documents');
  await revealTree(page);
  await createItem(page, 'folder', folder);
  const row = page.locator('#doc-tree').getByRole('button', { name: new RegExp(folder) });
  await expect(row).toBeVisible();
  await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  // Background mail refreshes call navigation(); they must not replace this tree.
  await page.evaluate(() => navigation());
  await page.evaluate(() => navigation());
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#doc-new-file')).toBeVisible();
  await createItem(page, 'file', 'work.txt');
  await expect(page.locator('#doc-file-name')).toHaveText('work.txt');
  await expect(page.locator('#doc-recent [data-doc-file]').first()).toHaveAttribute(
    'data-doc-file',
    `${folder}/work.txt`,
  );
  await revealTree(page);
  await expect(
    page.locator('#doc-tree [data-doc-file="' + folder + '/work.txt"]:visible'),
  ).toBeVisible();
});

test('Document zoom keys, wheel and controls stay scoped; title follows the open file', async ({
  page,
}, info) => {
  const name = `zoom-${info.project.name}-${Date.now()}.md`;
  await page.goto('/#/documents');
  await revealTree(page);
  await createItem(page, 'file', name);
  await expect(page.locator('#breadcrumb')).toHaveText(`documents. ${name}`);
  const paper = page.locator('.doc-code-shell');
  const before = await paper.boundingBox();
  const appZoom = await page.locator('html').evaluate((element) => element.style.zoom);
  await page.locator('#doc-zoom-in').click();
  await expect(page.locator('#doc-zoom-label')).toHaveText('110%');
  expect((await paper.boundingBox()).width).toBeGreaterThan(before.width);
  await page.keyboard.press('ControlOrMeta+-');
  await expect(page.locator('#doc-zoom-label')).toHaveText('100%');
  await page.locator('#doc-editor-viewport').hover();
  await page.keyboard.down('ControlOrMeta');
  await page.mouse.wheel(0, -140);
  await page.keyboard.up('ControlOrMeta');
  await expect(page.locator('#doc-zoom-label')).toHaveText('110%');
  expect(await page.locator('html').evaluate((element) => element.style.zoom)).toBe(appZoom);
  await page.keyboard.press('ControlOrMeta+Shift+-');
  expect(await page.locator('html').evaluate((element) => element.style.zoom)).not.toBe(appZoom);
  await page.keyboard.press('ControlOrMeta+Shift+0');
});

test('Multiple selection and context-menu copy/paste preserve originals', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'Desktop pointer and modifier gesture');
  const suffix = `${info.project.name}-${Date.now()}`;
  await page.goto('/#/documents');
  await revealTree(page);
  for (const name of [`first-${suffix}.txt`, `second-${suffix}.txt`, `third-${suffix}.txt`]) {
    await createItem(page, 'file', name);
  }
  const first = page.locator(`#doc-tree [data-doc-file="first-${suffix}.txt"]`);
  const second = page.locator(`#doc-tree [data-doc-file="second-${suffix}.txt"]`);
  const third = page.locator(`#doc-tree [data-doc-file="third-${suffix}.txt"]`);
  await first.click({ modifiers: ['Control'] });
  await third.click({ modifiers: ['Control'] });
  await expect(first).toHaveClass(/doc-selected/);
  await expect(third).toHaveClass(/doc-selected/);
  await first.click({ button: 'right' });
  await page.locator('[data-doc-menu="copy"]').click();
  await createItem(page, 'folder', `destination-${suffix}`);
  const destination = page.locator(`#doc-tree [data-doc-folder="destination-${suffix}"]`);
  await destination.click({ button: 'right' });
  await page.locator('[data-doc-menu="paste"]').click();
  await destination.click();
  await expect(
    page.locator(`#doc-tree [data-doc-file="destination-${suffix}/first-${suffix} (copy).txt"]`),
  ).toBeVisible();
  await expect(
    page.locator(`#doc-tree [data-doc-file="destination-${suffix}/third-${suffix} (copy).txt"]`),
  ).toBeVisible();
  await expect(first).toBeVisible();
  await second.click({ modifiers: ['Control'] });
  await third.click({ modifiers: ['Shift'] });
  await expect(second).toHaveClass(/doc-selected/);
  await expect(third).toHaveClass(/doc-selected/);
});

test('PDF page previews, permanent redaction and image signatures save separate copies', async ({
  page,
}, info) => {
  const original = `pdf-${info.project.name}-${Date.now()}.pdf`;
  await page.goto('/#/documents');
  await revealTree(page);
  await createItem(page, 'file', original);
  await expect(page.locator('#doc-pdf-image')).toBeVisible();
  if (!(await page.locator('[data-doc-page="0"]').isVisible()))
    await page.locator('#doc-show-pages').click();
  await expect(page.locator('[data-doc-page="0"]')).toBeVisible();
  if (await page.locator('#doc-hide-pages').isVisible())
    await page.locator('#doc-hide-pages').click();
  await expect
    .poll(() =>
      page.locator('#doc-pdf-image').evaluate((image) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
  await page.locator('[data-pdf-tool="redact"]').click();
  const box = await page.locator('#doc-pdf-overlay').boundingBox();
  await page.mouse.move(box.x + 50, box.y + 55);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 125);
  await page.mouse.up();
  await expect(page.locator('#doc-pdf-apply')).toBeEnabled();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#doc-pdf-apply').click();
  await expect(page.locator('#doc-file-name')).toContainText('.redacted.pdf');
  const originalResponse = await page.request.get(
    '/api/documents/download?path=' + encodeURIComponent(original),
  );
  expect(originalResponse.ok()).toBe(true);
  await page.locator('#doc-signature').click();
  await expect(page.locator('#doc-sign-dialog')).toBeVisible();
  const canvas = await page.locator('#doc-sign-canvas').boundingBox();
  await page.mouse.move(canvas.x + 40, canvas.y + 80);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 200, canvas.y + 55, { steps: 12 });
  await page.mouse.up();
  await page.locator('#doc-sign-use-drawing').click();
  const second = await page.locator('#doc-pdf-overlay').boundingBox();
  await page.mouse.move(second.x + 55, second.y + 90);
  await page.mouse.down();
  await page.mouse.move(second.x + 220, second.y + 170);
  await page.mouse.up();
  await page.locator('#doc-pdf-apply').click();
  await expect(page.locator('#doc-file-name')).toContainText('.signed-image.pdf');
  await page.locator('#doc-pdf-compress').click();
  await expect(page.locator('#doc-status')).toContainText(/already as small|Saved|new PDF copy/i);
});

test('PDF text editing and staged image/signature placement work without browser prompts', async ({
  page,
}, info) => {
  const name = `pdf-tools-${info.project.name}-${Date.now()}.pdf`;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAQCAYAAAB3AH1ZAAAAlElEQVR4nN2USw6AIAxEoRdw49r7n4s1G06gK4yBTj+kJsbZkFhm+qDElP6qbT/O54pEUUGSR/KKAJ4gK5QZYLWZ18cCSCGrNVSfACJP3mrJ2j71EbZa8hhkgeweDYJQAZm5vZpPyrkBtFOhEOvI0C1mFLLa0HprXeRprknzcaMhz7ykuhV6fJzEfXxbIX0ifs+f0AVXmW9Yksy07AAAAABJRU5ErkJggg==',
    'base64',
  );
  const drawArea = async () => {
    const box = await page.locator('#doc-pdf-overlay').boundingBox();
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + Math.min(185, box.width - 20), box.y + 95, { steps: 5 });
    await page.mouse.up();
  };
  await page.goto('/#/documents');
  await revealTree(page);
  await createItem(page, 'file', name);
  const original = await (await page.request.get('/api/documents/download?path=' + name)).body();
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await drawArea();
  await page.locator('#doc-pdf-apply').click();
  await expect(page.locator('#doc-pdf-text-dialog')).toBeVisible();
  await page.locator('#doc-pdf-text-value').fill('Editable example');
  await page.locator('#doc-pdf-text-submit').click();
  await expect(page.locator('#doc-file-name')).toContainText('.annotated.pdf');
  await expect(page.locator('#doc-pdf-text-dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Replace text' }).click();
  await drawArea();
  await page.locator('#doc-pdf-apply').click();
  await expect(page.locator('#doc-pdf-text-hint')).toContainText('permanently removed');
  await page.locator('#doc-pdf-text-value').fill('Updated example');
  await page.locator('#doc-pdf-text-submit').click();
  await expect(page.locator('#doc-file-name')).toContainText('.replaced-text.pdf');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Place image' }).click();
  await (await chooser).setFiles({ name: 'stamp.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('#doc-status')).toContainText('Draw an area');
  await drawArea();
  const preview = page.locator('.doc-selection-preview');
  await expect(preview.locator('img')).toBeVisible();
  const before = await preview.boundingBox();
  await page.mouse.move(before.x + 25, before.y + 20);
  await page.mouse.down();
  await page.mouse.move(before.x + 55, before.y + 42, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await preview.boundingBox()).x).toBeGreaterThan(before.x + 10);
  const moved = await preview.boundingBox();
  const resize = await preview.locator('.doc-selection-resize').boundingBox();
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2);
  await page.mouse.down();
  await page.mouse.move(resize.x + resize.width / 2 + 30, resize.y + resize.height / 2 + 20, {
    steps: 5,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await preview.boundingBox()).width)
    .toBeGreaterThan(moved.width + 10);
  await page.locator('#doc-pdf-apply').click();
  await expect(page.locator('#doc-file-name')).toContainText('.image.pdf');
  await page.getByRole('button', { name: 'Signature' }).click();
  await page.locator('[data-sign-tab="image"]').click();
  await page
    .locator('#doc-sign-file')
    .setInputFiles({ name: 'signature.png', mimeType: 'image/png', buffer: png });
  await page.locator('#doc-sign-use-image').click();
  await drawArea();
  await expect(page.locator('.doc-selection-preview img')).toBeVisible();
  await page.locator('#doc-pdf-apply').click();
  await expect(page.locator('#doc-file-name')).toContainText('.signed-image.pdf');
  const unchanged = await (await page.request.get('/api/documents/download?path=' + name)).body();
  expect(unchanged).toEqual(original);
});

test('Folder search, sorting, visible path and drag-drop move preserve open document', async ({
  page,
}, info) => {
  const suffix = `${info.project.name}-${Date.now()}`;
  const from = `alpha-${suffix}`;
  const into = `beta-${suffix}`;
  await page.goto('/#/documents');
  await revealTree(page);
  for (const folder of [from, into]) {
    await createItem(page, 'folder', folder);
    await expect(page.locator(`#doc-tree [data-doc-folder="${folder}"]`)).toBeVisible();
  }
  await page.locator(`#doc-tree [data-doc-folder="${from}"]`).click();
  await expect(page.locator('#doc-nav-path')).toContainText(from);
  await createItem(page, 'file', 'move-me.txt');
  await page.locator('#doc-code-editor').fill('Preserved during move');
  await page.locator('#doc-save').click();
  await page.locator('#doc-code-editor').fill('Unsaved work survives a move');
  await expect(page.locator('#doc-save')).toBeEnabled();
  await revealTree(page);
  await page.locator('#doc-sort').click();
  await page.locator('[data-doc-order="name-desc"]').click();
  const names = await page
    .locator('#doc-root-children > .doc-tree-entry > .doc-folder-row .doc-item-label')
    .allTextContents();
  expect(names.indexOf(into)).toBeLessThan(names.indexOf(from));
  await page.locator('#doc-search').fill('move-me');
  await expect(
    page.locator(`#doc-search-results [data-doc-file="${from}/move-me.txt"]`),
  ).toBeVisible();
  await page.locator('#doc-search').fill('');
  await expect(page.locator(`#doc-tree [data-doc-file="${from}/move-me.txt"]`)).toBeVisible();
  if (info.project.name === 'desktop') {
    await page
      .locator(`#doc-tree [data-doc-file="${from}/move-me.txt"]`)
      .dragTo(page.locator(`#doc-tree [data-doc-folder="${into}"]`));
    await expect(page.locator(`#doc-tree [data-doc-file="${into}/move-me.txt"]`)).toBeVisible();
    await expect(page.locator('#doc-code-editor')).toHaveValue('Unsaved work survives a move');
    await expect(page.locator('#doc-save')).toBeEnabled();
    await page.locator('#doc-save').click();
    const movedFile = await page.request.get(
      `/api/documents/open?path=${encodeURIComponent(`${into}/move-me.txt`)}`,
    );
    expect((await movedFile.json()).content).toBe('Unsaved work survives a move');
    await expect(page.locator('#doc-recent [data-doc-file]').first()).toHaveAttribute(
      'data-doc-file',
      `${into}/move-me.txt`,
    );
  }
});

test('PDF export, scoped zoom, print options and password retry dialog', async ({ page }, info) => {
  const file = `print-${info.project.name}-${Date.now()}.txt`;
  await page.goto('/#/documents');
  await revealTree(page);
  await createItem(page, 'file', file);
  await page.locator('#doc-code-editor').fill('A print test');
  await page.locator('#doc-export-pdf').click();
  await expect(page.locator('#doc-file-name')).toHaveText(file.replace('.txt', '.export.pdf'));
  await expect(page.locator('#doc-pdf-image')).toBeVisible();
  const originalWidth = (await page.locator('#doc-pdf-paper').boundingBox()).width;
  await page.locator('#doc-zoom-in').click();
  expect((await page.locator('#doc-pdf-paper').boundingBox()).width).toBeGreaterThan(originalWidth);
  await expect(page.locator('#doc-zoom-label')).toHaveText('110%');
  await page.keyboard.press('ControlOrMeta+-');
  await expect(page.locator('#doc-zoom-label')).toHaveText('100%');
  await expect(page.locator('#doc-editor-viewport')).toHaveCSS('zoom', '1');
  await expect(page.locator('#doc-ribbon-tools')).toBeAttached();
  const toolbar = await page.locator('#doc-pdf-tools').boundingBox();
  const exportButton = await page.locator('#doc-export-pdf').boundingBox();
  expect(toolbar.y).toBeGreaterThan(exportButton.y + exportButton.height - 3);

  await page.route('**/api/documents/printers', (route) =>
    route.fulfill({ json: { printers: ['TestQueue'], default: 'TestQueue' } }),
  );
  let printed;
  await page.route('**/api/documents/print', async (route) => {
    printed = route.request().postDataJSON();
    await route.fulfill({ json: { message: 'Queued print job' } });
  });
  await page.locator('#doc-print').click();
  await expect(page.locator('#doc-print-dialog')).toBeVisible();
  await expect(page.locator('#doc-print-preview-image')).toHaveJSProperty('complete', true);
  await page.locator('#doc-print-pages').fill('1');
  await page.locator('#doc-print-paper').selectOption('Letter');
  await page.locator('#doc-print-copies').fill('2');
  await page.locator('#doc-print-duplex').selectOption('long');
  await page.locator('#doc-print-submit').click();
  await expect(page.locator('#doc-print-dialog')).not.toBeVisible();
  expect(printed).toMatchObject({
    printer: 'TestQueue',
    pages: '1',
    copies: 2,
    paper: 'Letter',
    duplex: 'long',
  });

  const pdf = file.replace('.txt', '.export.pdf');
  let locked = true;
  await page.route('**/api/documents/open?path=' + encodeURIComponent(pdf), (route) =>
    locked
      ? route.fulfill({ status: 423, json: { detail: 'Document password required' } })
      : route.continue(),
  );
  await page.route('**/api/documents/unlock', (route) => {
    const password = route.request().postDataJSON().password;
    if (password !== 'correct')
      return route.fulfill({ status: 401, json: { detail: 'Incorrect document password' } });
    locked = false;
    return route.fulfill({ json: { unlocked: true } });
  });
  await revealTree(page);
  await page.locator(`#doc-tree [data-doc-file="${pdf}"]`).click();
  await expect(page.locator('#doc-password-dialog')).toBeVisible();
  await page.locator('#doc-password-input').fill('wrong');
  await page.locator('#doc-password-submit').click();
  await expect(page.locator('#doc-password-error')).toContainText(
    'previous password was incorrect',
  );
  expect(
    await page
      .locator('#doc-password-input')
      .evaluate((input) => input.selectionEnd - input.selectionStart),
  ).toBe(5);
  await page.locator('#doc-password-input').fill('correct');
  await page.locator('#doc-password-submit').click();
  await expect(page.locator('#doc-password-dialog')).not.toBeVisible();
  await expect(page.locator('#doc-file-name')).toHaveText(pdf);
});

test('Inserting an image into a rich document survives save and reopening', async ({
  page,
}, info) => {
  const name = `embedded-${info.project.name}-${Date.now()}.docx`;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAQCAYAAAB3AH1ZAAAAlElEQVR4nN2USw6AIAxEoRdw49r7n4s1G06gK4yBTj+kJsbZkFhm+qDElP6qbT/O54pEUUGSR/KKAJ4gK5QZYLWZ18cCSCGrNVSfACJP3mrJ2j71EbZa8hhkgeweDYJQAZm5vZpPyrkBtFOhEOvI0C1mFLLa0HprXeRprknzcaMhz7ykuhV6fJzEfXxbIX0ifs+f0AVXmW9Yksy07AAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.goto('/#/documents');
  await revealTree(page);
  await createItem(page, 'file', name);
  await page.locator('#doc-rich-editor').fill('Before the picture');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Insert an image' }).click();
  await (await chooser).setFiles({ name: 'sample.png', mimeType: 'image/png', buffer: png });
  const image = page.locator('#doc-rich-editor img');
  await expect(image).toBeVisible();
  await image.click();
  await page.locator('#doc-image-width').evaluate((slider) => {
    slider.value = '240';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#doc-image-wrap').selectOption('doc-float-right');
  await page.locator('#doc-save').click();
  await page.reload();
  await revealTree(page);
  await page.locator(`#doc-tree [data-doc-file="${name}"]`).click();
  await expect(page.locator('#doc-rich-editor img')).toBeVisible();
  await expect(page.locator('#doc-rich-editor img')).toHaveAttribute('width', '240');
});

test('Rich document formatting, table insertion and round-trip', async ({ page }, info) => {
  const file = `letter-${info.project.name}-${Date.now()}.docx`;
  await page.goto('/#/documents');
  await revealTree(page);
  await expect(page.locator('#doc-new-file')).toBeVisible();
  await createItem(page, 'file', file);
  await expect(page.locator('#doc-rich-editor')).toBeVisible();
  await page.locator('#doc-rich-editor').fill('Hello world');
  await page.locator('#doc-rich-editor').press('End');
  await page.locator('[data-doc-command="bold"]').click();
  await page.keyboard.type(' Bold text');
  await expect(page.locator('#doc-rich-editor')).toContainText('Hello world');
  page.on('dialog', (dialog) => dialog.accept('2'));
  await page.locator('#doc-table').click();
  await expect(page.locator('#doc-rich-editor table')).toBeVisible();
  await page.locator('#doc-save').click();
  await expect(page.locator('#doc-status')).toHaveText('Saved to Documents');
  await page.reload();
  await revealTree(page);
  await page
    .locator('#doc-recent')
    .getByRole('button', { name: new RegExp(file) })
    .click();
  await expect(page.locator('#doc-rich-editor')).toContainText('Hello world');
  await expect(page.locator('#doc-rich-editor table')).toBeVisible();
});
