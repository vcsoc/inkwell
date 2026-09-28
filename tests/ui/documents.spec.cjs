const { test, expect } = require('@playwright/test');

async function revealTree(page) {
  await expect(page.locator('#doc-tree')).toBeAttached();
  if (!(await page.locator('#doc-tree').isVisible())) await page.locator('#menu').click();
  await expect(page.locator('#doc-tree')).toBeVisible();
}

test('Documents rail, folder tree, recent files, text editing and conflict-safe save', async ({
  page,
}, info) => {
  const file = `notes-${info.project.name}-${Date.now()}.md`;
  await page.goto('/#/documents');
  await expect(page.locator('#documents-workspace')).toBeVisible();
  await revealTree(page);
  await expect(page.locator(`[data-view="documents"]:visible`)).toHaveClass(/active/);
  page.once('dialog', (dialog) => dialog.accept(file));
  await page.locator('#doc-new-file').click();
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

test('Nested folders expand and newly created files open from their selected folder', async ({
  page,
}, info) => {
  const folder = `drafts-${info.project.name}-${Date.now()}`;
  await page.goto('/#/documents');
  await revealTree(page);
  page.once('dialog', (dialog) => dialog.accept(folder));
  await page.locator('#doc-new-folder').click();
  const row = page.locator('#doc-tree').getByRole('button', { name: new RegExp(folder) });
  await expect(row).toBeVisible();
  await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  // Background mail refreshes call navigation(); they must not replace this tree.
  await page.evaluate(() => navigation());
  await page.evaluate(() => navigation());
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#doc-new-file')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept('work.txt'));
  await page.locator('#doc-new-file').click();
  await expect(page.locator('#doc-file-name')).toHaveText('work.txt');
  await expect(page.locator('#doc-recent [data-doc-file]').first()).toHaveAttribute(
    'data-doc-file',
    `${folder}/work.txt`,
  );
  await revealTree(page);
  await expect(page.locator('[data-doc-file="' + folder + '/work.txt"]:visible')).toBeVisible();
});

test('PDF page previews, permanent redaction and image signatures save separate copies', async ({
  page,
}, info) => {
  const original = `pdf-${info.project.name}-${Date.now()}.pdf`;
  await page.goto('/#/documents');
  await revealTree(page);
  page.once('dialog', (dialog) => dialog.accept(original));
  await page.locator('#doc-new-file').click();
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

test('Rich document formatting, table insertion and round-trip', async ({ page }, info) => {
  const file = `letter-${info.project.name}-${Date.now()}.docx`;
  await page.goto('/#/documents');
  await revealTree(page);
  await expect(page.locator('#doc-new-file')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept(file));
  await page.locator('#doc-new-file').click();
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
