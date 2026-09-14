const { test, expect } = require('@playwright/test');
let prefix, ids;
async function api(page, path, method = 'GET', body) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const r = await fetch('/api' + path, {
        method,
        headers: { 'X-Inkwell': '1', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!r.ok) throw Error(await r.text());
      return r.json();
    },
    { path, method, body },
  );
}
const node = (page, id) => page.locator(`#navigation [data-view="local-${id}"]`);
async function sidebar(page) {
  if (!(await node(page, ids[0]).isVisible())) await page.locator('#menu').click();
}
test.beforeEach(async ({ page }) => {
  prefix = 'Drag folders ' + Date.now();
  ids = [];
  await page.goto('/');
  for (const name of ['A', 'B', 'C', 'Leaf']) {
    const r = await api(page, '/local-folders', 'POST', {
      name: prefix + ' ' + name,
      parent: name === 'Leaf' ? 'local-' + ids[0] : '',
    });
    ids.push(r.id);
  }
  await page.reload();
  await expect(node(page, ids[0])).toBeAttached();
  await sidebar(page);
  await node(page, ids[0]).scrollIntoViewIfNeeded();
});
test.afterEach(async ({ page }) => {
  let rows = (await api(page, '/local-folders')).filter((f) => f.name.startsWith(prefix));
  while (rows.length) {
    const leaves = rows.filter((f) => !rows.some((c) => c.parent === 'local-' + f.id));
    if (!leaves.length) throw Error('Cyclic fixture');
    for (const f of leaves) await api(page, '/local-folders/' + f.id, 'DELETE');
    rows = rows.filter((f) => !leaves.includes(f));
  }
});
async function begin(page, id) {
  await node(page, id).scrollIntoViewIfNeeded();
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await node(page, id).dispatchEvent('dragstart', { dataTransfer: transfer });
  return transfer;
}
async function point(target, ratio = 0.5) {
  const box = await target.boundingBox();
  return { clientX: box.x + box.width / 2, clientY: box.y + box.height * ratio };
}
test('Folder drag shows an exact before/after placeholder and commits only on drop', async ({
  page,
}, info) => {
  const original = await api(page, '/local-folders');
  const transfer = await begin(page, ids[2]),
    target = node(page, ids[0]),
    position = await point(target, 0.1);
  await target.dispatchEvent('dragover', { dataTransfer: transfer, ...position });
  const marker = page.locator('#folder-drop-placeholder');
  await expect(marker).toBeVisible();
  await expect(marker).toHaveAttribute('data-placement', 'before');
  const box = await marker.boundingBox(),
    anchor = await target.boundingBox();
  expect(Math.abs(box.y - anchor.y)).toBeLessThan(2);
  expect(await api(page, '/local-folders')).toEqual(original);
  await page.screenshot({
    path: 'test-results/' + info.project.name + '-folder-drop-placeholder.png',
  });
  await target.dispatchEvent('drop', { dataTransfer: transfer, ...position });
  await expect(marker).not.toBeVisible();
  await expect
    .poll(async () =>
      (await api(page, '/local-folders'))
        .filter((f) => !f.parent && f.name.startsWith(prefix))
        .map((f) => f.id),
    )
    .toEqual([ids[2], ids[0], ids[1]]);
  await expect(node(page, ids[2])).toBeAttached();
  const second = await begin(page, ids[2]),
    after = await point(node(page, ids[1]), 0.9);
  await node(page, ids[1]).dispatchEvent('dragover', { dataTransfer: second, ...after });
  await expect(marker).toHaveAttribute('data-placement', 'after');
  await node(page, ids[1]).dispatchEvent('drop', { dataTransfer: second, ...after });
  await expect
    .poll(async () =>
      (await api(page, '/local-folders'))
        .filter((f) => !f.parent && f.name.startsWith(prefix))
        .map((f) => f.id),
    )
    .toEqual(ids.slice(0, 3));
});
test('Invalid descendant drops and Escape leave hierarchy unchanged; valid nesting moves the whole branch', async ({
  page,
}) => {
  const original = await api(page, '/local-folders');
  let transfer = await begin(page, ids[0]);
  const leaf = node(page, ids[3]),
    invalid = await point(leaf);
  await leaf.dispatchEvent('dragover', { dataTransfer: transfer, ...invalid });
  await expect(page.locator('#folder-drop-placeholder')).not.toBeVisible();
  await leaf.dispatchEvent('drop', { dataTransfer: transfer, ...invalid });
  expect(await api(page, '/local-folders')).toEqual(original);
  transfer = await begin(page, ids[0]);
  const target = node(page, ids[1]),
    position = await point(target);
  await target.dispatchEvent('dragover', { dataTransfer: transfer, ...position });
  await expect(page.locator('#folder-drop-placeholder')).toHaveAttribute(
    'data-placement',
    'inside',
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('#folder-drop-placeholder')).not.toBeVisible();
  expect(await api(page, '/local-folders')).toEqual(original);
  if (!(await target.isVisible())) await page.locator('#menu').click();
  transfer = await begin(page, ids[0]);
  const next = await point(target);
  await target.dispatchEvent('dragover', { dataTransfer: transfer, ...next });
  await target.dispatchEvent('drop', { dataTransfer: transfer, ...next });
  await expect(
    page.locator(`[data-local-branch="local-${ids[1]}"] [data-view="local-${ids[3]}"]`),
  ).toBeAttached();
  const saved = await api(page, '/local-folders');
  expect(saved.find((f) => f.id === ids[0]).parent).toBe('local-' + ids[1]);
  expect(saved.find((f) => f.id === ids[3]).parent).toBe('local-' + ids[0]);
  await page.reload();
  await expect(
    page.locator(`[data-local-branch="local-${ids[1]}"] [data-view="local-${ids[3]}"]`),
  ).toBeAttached();
});
test('Top-level drop has a preview, preserves the tree on failure, and can be retried', async ({
  page,
}) => {
  const original = await api(page, '/local-folders');
  await page.route('**/api/local-folders/move', (r) =>
    r.fulfill({ status: 503, json: { detail: 'Folder move failed' } }),
  );
  let transfer = await begin(page, ids[3]);
  const target = page.locator('#folder-root-drop');
  await target.scrollIntoViewIfNeeded();
  let location = await point(target);
  await target.dispatchEvent('dragover', { dataTransfer: transfer, ...location });
  await expect(page.locator('#folder-drop-placeholder')).toContainText('Top level');
  await target.dispatchEvent('drop', { dataTransfer: transfer, ...location });
  await expect(page.locator('#toast')).toContainText('Folder move failed');
  expect(await api(page, '/local-folders')).toEqual(original);
  await page.unroute('**/api/local-folders/move');
  transfer = await begin(page, ids[3]);
  await target.scrollIntoViewIfNeeded();
  location = await point(target);
  await target.dispatchEvent('dragover', { dataTransfer: transfer, ...location });
  await target.dispatchEvent('drop', { dataTransfer: transfer, ...location });
  await expect
    .poll(async () => (await api(page, '/local-folders')).find((f) => f.id === ids[3]).parent)
    .toBe('');
});
test('Move folder menu provides a keyboard and touch alternative with a placement preview', async ({
  page,
}) => {
  await node(page, ids[2]).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move folder…', exact: true }).click();
  await page.getByLabel('Placement', { exact: true }).selectOption('before');
  await page.getByLabel('Target folder', { exact: true }).selectOption('local-' + ids[0]);
  await expect(page.locator('#folder-move-preview')).toContainText('before ' + prefix + ' A');
  await page.getByRole('button', { name: 'Move folder', exact: true }).click();
  await expect(page.locator('#folder-move-form')).not.toBeVisible();
  expect(
    (await api(page, '/local-folders'))
      .filter((f) => !f.parent && f.name.startsWith(prefix))
      .map((f) => f.id),
  ).toEqual([ids[2], ids[0], ids[1]]);
});
