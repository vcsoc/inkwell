'use strict';
window.InkwellTagStyle = (color) => {
  if (!/^#[0-9a-f]{6}$/i.test(color || '')) color = '#486b54';
  const rgb = [1, 3, 5]
    .map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return `--tag-bg:${color};--tag-fg:${luminance > 0.179 ? '#000000' : '#ffffff'}`;
};
window.InkwellPaintTags = (root = document) => {
  root.querySelectorAll('.tag-pill[data-tag-color]').forEach((pill) => {
    for (const declaration of InkwellTagStyle(pill.dataset.tagColor).split(';')) {
      const [name, value] = declaration.split(':');
      pill.style.setProperty(name, value);
    }
  });
};
window.InkwellTagManager = async (
  root,
  { api, esc, toast, isCurrent, catalogChanged, openTag },
) => {
  let tags = await api('/tags'),
    selected = new Set(),
    anchor = null,
    editing = null,
    focusAfterSave = null;
  if (!isCurrent() || !root.isConnected) return;
  catalogChanged(tags);
  root.innerHTML = `<section id="tag-manager"><p class="notice">Manage local tags across every cached folder, including Drafts and Trash. Rename and merge update message labels; deleting tags never deletes mail. Changes apply immediately when saved.</p><div class="tag-manager-tools"><label>Find tags<input id="tag-search" type="search" placeholder="Find a tag…"></label><label>Show<select id="tag-usage"><option value="all">All tags</option><option value="used">Used tags</option><option value="unused">Unused tags</option></select></label><label>Sort<select id="tag-sort"><option value="name">Alphabetical</option><option value="count">Most used</option></select></label><span id="tag-summary" role="status"></span><button type="button" class="secondary" id="tag-create-shortcut">Create tag</button></div><div class="tag-manager-layout"><section class="card" id="tag-editor-panel" hidden><h2 id="tag-editor-title">Create tag</h2><form id="tag-editor"><label class="field">Tag name<input name="name" maxlength="32" required></label><label class="field color-field">Tag color<input name="color" aria-label="Tag color" value="#486b54" pattern="#[0-9a-fA-F]{6}" required spellcheck="false"></label><div id="tag-color-preview"></div><div class="form-actions"><button class="primary" type="submit">Save tag</button><button class="secondary" id="new-tag" type="button">New tag</button></div></form></section><section><div class="tag-bulk-tools"><label><input id="select-all-tags" type="checkbox"> Select visible tags</label><span id="selected-tags-count"></span><button class="secondary" id="clear-selected-tags" type="button">Clear selection</button><button class="secondary danger" id="delete-tags" disabled>Delete selected tags</button><form id="merge-tags"><label>Replacement tag<input name="name" maxlength="32" required list="manager-tag-names"></label><button class="secondary" disabled>Replace / merge selected</button></form><datalist id="manager-tag-names"></datalist></div><div id="tag-list"></div></section></div></section>`;
  const form = root.querySelector('#tag-editor'),
    list = root.querySelector('#tag-list');
  const updateColors = InkwellTagColorPicker(form);
  const preview = () => {
    updateColors();
    root.querySelector('#tag-color-preview').innerHTML =
      `<span class="mail-pill tag-pill" data-tag-color="${esc(form.elements.color.value)}">${esc(form.elements.name.value || 'Preview')}</span>`;
    InkwellPaintTags(root.querySelector('#tag-color-preview'));
  };
  form.oninput = preview;
  preview();
  const editor = (tag = null) => {
    root.querySelector('#tag-editor-panel').hidden = false;
    editing = tag?.id || null;
    form.elements.name.value = tag?.name || '';
    form.elements.color.value = tag?.color || '#486b54';
    root.querySelector('#tag-editor-title').textContent = tag ? 'Edit tag' : 'Create tag';
    preview();
    form.elements.name.focus();
  };
  root.querySelector('#new-tag').onclick = () => editor();
  root.querySelector('#tag-create-shortcut').onclick = () => editor();
  const visible = () =>
    tags
      .filter((t) =>
        t.name
          .toLocaleLowerCase()
          .includes(root.querySelector('#tag-search').value.trim().toLocaleLowerCase()),
      )
      .filter(
        (t) =>
          root.querySelector('#tag-usage').value === 'all' ||
          (root.querySelector('#tag-usage').value === 'used' ? t.count > 0 : t.count === 0),
      )
      .sort((a, b) =>
        root.querySelector('#tag-sort').value === 'count'
          ? b.count - a.count || a.name.localeCompare(b.name)
          : a.name.localeCompare(b.name),
      );
  const paint = () => {
    const shown = visible();
    root.querySelector('#tag-manager').classList.toggle('has-selected-tags', selected.size > 0);
    list.querySelectorAll('[data-tag-id]').forEach((row) => {
      const checked = selected.has(Number(row.dataset.tagId));
      row.classList.toggle('selected', checked);
      row.querySelector('input').checked = checked;
    });
    const hidden = selected.size - shown.filter((t) => selected.has(t.id)).length;
    root.querySelector('#selected-tags-count').textContent =
      selected.size + ' selected' + (hidden ? ' (' + hidden + ' hidden by filter)' : '');
    root.querySelector('#delete-tags').disabled = !selected.size;
    root.querySelector('#merge-tags button').disabled = selected.size < 2;
    const all = root.querySelector('#select-all-tags'),
      number = shown.filter((t) => selected.has(t.id)).length;
    all.checked = !!shown.length && number === shown.length;
    all.indeterminate = number > 0 && number < shown.length;
  };
  const render = () => {
    const shown = visible(),
      groups = new Map();
    for (const tag of shown) {
      const letter =
        root.querySelector('#tag-sort').value === 'count'
          ? 'Most used'
          : /^\p{L}/u.test(tag.name)
            ? Array.from(tag.name)[0].toLocaleUpperCase()
            : '#';
      if (!groups.has(letter)) groups.set(letter, []);
      groups.get(letter).push(tag);
    }
    list.innerHTML =
      [...groups]
        .map(
          ([letter, entries]) =>
            `<section class="tag-letter-group"><h2>${esc(letter)} <small>(${entries.length})</small></h2><div class="tag-letter-grid">${entries.map((t) => `<div class="tag-manager-item" data-tag-id="${t.id}" tabindex="0"><input type="checkbox" aria-label="Select ${esc(t.name)}"><button class="tag-manager-name" data-open-tag="${t.id}" aria-label="Show messages tagged ${esc(t.name)}" title="Show messages tagged ${esc(t.name)}"><span class="mail-pill tag-pill" data-tag-color="${esc(t.color)}">${esc(t.name)}</span></button><span class="tag-manager-count" title="Cached messages, including Trash and Drafts">${t.count}</span><button class="secondary tag-item-action" data-edit-tag="${t.id}" aria-label="Edit" title="Edit ${esc(t.name)}">✎</button><button class="secondary danger tag-item-action" data-delete-tag="${t.id}" aria-label="Delete tag ${esc(t.name)}" title="Delete ${esc(t.name)}">×</button></div>`).join('')}</div></section>`,
        )
        .join('') || '<p>No matching tags.</p>';
    root.querySelector('#tag-summary').textContent = `${shown.length} of ${tags.length} tags`;
    root.querySelector('#manager-tag-names').innerHTML = tags
      .map((t) => `<option value="${esc(t.name)}"></option>`)
      .join('');
    InkwellPaintTags(list);
    paint();
  };
  const reload = async () => {
    const fresh = await api('/tags');
    if (!isCurrent() || !root.isConnected) return;
    tags = fresh;
    catalogChanged(tags);
    selected = new Set([...selected].filter((id) => tags.some((t) => t.id === id)));
    render();
  };
  const action = async (work) => {
    const manager = root.querySelector('#tag-manager');
    manager.inert = true;
    try {
      await work();
      await reload();
    } catch (error) {
      toast(error.message);
    } finally {
      manager.inert = false;
      if (focusAfterSave) {
        if (isCurrent() && root.isConnected)
          list.querySelector(`[data-tag-id="${focusAfterSave}"]`)?.focus();
        focusAfterSave = null;
      }
    }
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    void action(async () => {
      const saved = await api('/tags' + (editing ? '/' + editing : ''), {
        method: editing ? 'PUT' : 'POST',
        body: { name: form.elements.name.value, color: form.elements.color.value },
      });
      if (isCurrent() && form.isConnected) {
        editing = null;
        root.querySelector('#tag-editor-title').textContent = 'Create tag';
        form.elements.name.value = '';
        preview();
      }
      if (isCurrent() && root.isConnected) root.querySelector('#tag-editor-panel').hidden = true;
      focusAfterSave = saved.id;
      toast('Tag saved across local mail.');
    });
  };
  const remove = (ids) =>
    action(async () => {
      await api('/tags/delete', { method: 'POST', body: { ids } });
      if (isCurrent() && form.isConnected && ids.includes(editing)) editor();
      toast('Tags removed; messages preserved.');
    });
  root.querySelector('#delete-tags').onclick = () => remove([...selected]);
  root.querySelector('#clear-selected-tags').onclick = () => {
    selected.clear();
    paint();
  };
  root.querySelector('#merge-tags').onsubmit = (event) => {
    event.preventDefault();
    const replacement = event.currentTarget.elements.name.value;
    void action(async () => {
      const result = await api('/tags/merge', {
        method: 'POST',
        body: { ids: [...selected], name: replacement },
      });
      if (isCurrent() && form.isConnected) {
        selected = new Set([result.id]);
        editing = null;
        root.querySelector('#tag-editor-title').textContent = 'Create tag';
        form.elements.name.value = '';
        preview();
      }
      toast('Tags merged across ' + result.updated_messages + ' messages.');
    });
  };
  const choose = (id, event) => {
    const ordered = visible().map((t) => t.id);
    if (event.shiftKey && ordered.includes(anchor)) {
      const a = ordered.indexOf(anchor),
        b = ordered.indexOf(id);
      ordered.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((id) => selected.add(id));
    } else {
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      anchor = id;
    }
    paint();
  };
  list.onclick = (event) => {
    const row = event.target.closest('[data-tag-id]');
    if (!row) return;
    const id = Number(row.dataset.tagId);
    if (event.target.closest('[data-edit-tag]')) editor(tags.find((t) => t.id === id));
    else if (event.target.closest('[data-delete-tag]')) void remove([id]);
    else if (
      event.target.closest('[data-open-tag]') &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey
    )
      void openTag(id);
    else choose(id, event);
  };
  list.onkeydown = (event) => {
    if (event.target.matches('input,button')) return;
    if (event.key === ' ') {
      event.preventDefault();
      choose(Number(event.target.closest('[data-tag-id]').dataset.tagId), event);
    }
    if (event.key === 'Delete' && selected.size) {
      event.preventDefault();
      void remove([...selected]);
    }
  };
  root.querySelector('#select-all-tags').onchange = (event) => {
    visible().forEach((t) => (event.target.checked ? selected.add(t.id) : selected.delete(t.id)));
    paint();
  };
  root.querySelector('#tag-search').oninput = render;
  root.querySelector('#tag-usage').onchange = render;
  root.querySelector('#tag-sort').onchange = render;
  render();
};
