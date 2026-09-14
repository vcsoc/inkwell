'use strict';
window.InkwellRules = async (
  root,
  { api, esc, field, toast, isCurrent, foldersChanged = async () => {} },
) => {
  const [rules, folders, remote, tags, accounts] = await Promise.all([
    api('/rules'),
    api('/local-folders'),
    api('/remote-folders'),
    api('/tags'),
    api('/accounts'),
  ]);
  if (!isCurrent() || !root.isConnected) return;
  const targets = [
    ['inbox', 'Inbox'],
    ['archive', 'Archive'],
    ['trash', 'Trash'],
    ...folders.map((f) => ['local-' + f.id, f.name]),
    ...remote.map((f) => [
      'remote:' + f.id,
      (accounts.find((a) => a.id === f.account_id)?.email || 'Account') +
        ' / ' +
        f.path +
        ' (local view)',
    ]),
  ];
  const fields = {
    sender: 'Sender address',
    domain: 'Sender domain',
    subject: 'Subject',
    recipient: 'To recipients',
    body: 'Message text',
    tag: 'Tag',
    unread: 'Unread',
    starred: 'Starred',
    age_days: 'Age in days',
  };
  const operations = {
    is: 'is',
    not_is: 'is not',
    contains: 'contains',
    not_contains: 'does not contain',
    starts_with: 'starts with',
    ends_with: 'ends with',
    gt: 'older than',
    lt: 'newer than',
  };
  const types = {
    move: 'Move local copy',
    mark_read: 'Mark read',
    mark_unread: 'Mark unread',
    star: 'Star',
    unstar: 'Unstar',
    add_tag: 'Add tag',
    remove_tag: 'Remove tag',
  };
  const options = (entries, value) =>
    entries
      .map(
        ([id, label]) =>
          `<option value="${esc(id)}" ${String(id) === String(value) ? 'selected' : ''}>${esc(label)}</option>`,
      )
      .join('');
  root.innerHTML = `<section class="card"><h2>Rule Manager</h2><p>First matching enabled rule wins, in the order shown. All conditions can match (AND), or any condition can match (OR). Text matching is case-insensitive. All actions in the matching rule are applied locally. No server mail is moved or deleted.</p><label class="field">Find rules<input type="search" id="rules-search" placeholder="Find a rule…"></label><div id="rules-list"></div><button class="secondary" id="create-rule">Create rule</button><button class="secondary" id="apply-rules">Apply rules to existing imported copies…</button><p class="notice">Imports run rules immediately on new copies. Apply existing skips drafts, sent, Trash and already locally managed copies. Age/read conditions are not a periodic scheduler. Rules with missing folders/tags or overflowing 12 tags are skipped without partial actions.</p></section><section class="card"><form id="local-folder-form">${field('New local folder', 'name', '', 'text', 'required maxlength="80"')}<button class="secondary">Create local folder</button></form></section><section class="card" id="rule-editor"></section>`;
  const clean = (r) => {
    const { id, problem, ...data } = r;
    return data;
  };
  const renderList = () => {
    const q = root.querySelector('#rules-search').value.toLowerCase();
    root.querySelector('#rules-list').innerHTML =
      rules
        .filter((r) => r.name.toLowerCase().includes(q))
        .map(
          (r) =>
            `<div class="rule-row"><div><strong>${rules.indexOf(r) + 1}. ${esc(r.name)}</strong><p>${r.enabled ? 'Enabled' : 'Disabled'} · ${r.mode === 'any' ? 'ANY' : 'ALL'} of ${r.conditions.length} conditions · ${r.actions.length} actions</p><small>${r.conditions.map((c) => esc(fields[c.field] + ' ' + operations[c.operator] + ' ' + (c.field === 'tag' ? tags.find((t) => String(t.id) === c.value)?.name || 'Missing tag' : c.value))).join(r.mode === 'any' ? ' OR ' : ' AND ')}</small><p>${r.actions.map((a) => esc(types[a.type] + (a.type === 'move' ? ': ' + (targets.find((t) => t[0] === a.value)?.[1] || 'Missing folder') : a.type.endsWith('_tag') ? ': ' + (tags.find((t) => String(t.id) === a.value)?.name || 'Missing tag') : ''))).join(' → ')}</p>${r.problem ? `<p class="danger">Needs attention: ${esc(r.problem)}</p>` : ''}</div><button class="secondary" data-toggle-rule="${r.id}">${r.enabled ? 'Disable' : 'Enable'}</button><button class="secondary" data-edit-rule="${r.id}">Edit</button><button class="secondary" data-copy-rule="${r.id}">Duplicate</button><button class="secondary danger" data-delete-rule="${r.id}">Delete</button></div>`,
        )
        .join('') || '<p>No matching rules.</p>';
  };
  let refreshTargets = () => {},
    editorEpoch = 0,
    editingId = null,
    listEpoch = 0;
  const reloadList = async () => {
    const epoch = ++listEpoch;
    const fresh = await api('/rules');
    if (isCurrent() && root.isConnected && epoch === listEpoch) {
      rules.splice(0, rules.length, ...fresh);
      renderList();
    }
  };
  const editor = (rule = {}) => {
    const epoch = ++editorEpoch;
    editingId = rule.id || null;
    let conditions = structuredClone(
      rule.conditions || [{ field: 'subject', operator: 'contains', value: '' }],
    );
    let actions = structuredClone(rule.actions || [{ type: 'move', value: 'archive' }]);
    root.querySelector('#rule-editor').innerHTML =
      `<h2>${rule.id ? 'Edit rule' : 'New rule'}</h2><form id="rule-form">${field('Rule name', 'name', rule.name || '', 'text', 'required maxlength="100"')}<label class="check-label"><input type="checkbox" name="enabled" ${rule.enabled !== false ? 'checked' : ''}> Enabled</label><label class="field">Match conditions<select name="mode" aria-label="Match conditions"><option value="all">All conditions (AND)</option><option value="any">Any condition (OR)</option></select></label><h3>Conditions</h3><div id="rule-conditions"></div><button type="button" class="secondary" id="add-condition">Add condition</button><h3>Actions</h3><div id="rule-actions"></div><button type="button" class="secondary" id="add-action">Add action</button><h3>Additional exclusions</h3><label class="check-label"><input name="exclude_unread" type="checkbox" ${rule.exclude_unread ? 'checked' : ''}> Exclude unread messages</label>${field('Only messages older than days (0 = any age)', 'older_than_days', rule.older_than_days || 0, 'number', 'required min="0" max="36500"')}<div class="form-actions"><button class="secondary" id="new-rule" type="button">New rule</button><button class="primary">Save rule</button></div></form>`;
    const form = root.querySelector('#rule-form');
    form.elements.mode.value = rule.mode || 'all';
    const renderConditions = () => {
      form.querySelector('#rule-conditions').innerHTML = conditions
        .map((c, i) => {
          const ops =
            c.field === 'age_days'
              ? ['gt', 'lt']
              : ['tag', 'unread', 'starred'].includes(c.field)
                ? ['is', 'not_is']
                : ['contains', 'not_contains', 'is', 'not_is', 'starts_with', 'ends_with'];
          return `<div class="rule-builder-row" data-condition="${i}"><label>Field<select aria-label="Condition ${i + 1} field" data-part="field">${options(Object.entries(fields), c.field)}</select></label><label>Operator<select aria-label="Condition ${i + 1} operator" data-part="operator">${options(
            ops.map((op) => [op, operations[op]]),
            c.operator,
          )}</select></label><label>Value${
            c.field === 'tag'
              ? `<select aria-label="Condition ${i + 1} value" data-part="value"><option value="">Choose tag…</option>${options(
                  tags.map((t) => [String(t.id), t.name]),
                  c.value,
                )}</select>`
              : ['unread', 'starred'].includes(c.field)
                ? `<select aria-label="Condition ${i + 1} value" data-part="value">${options(
                    [
                      ['true', 'Yes'],
                      ['false', 'No'],
                    ],
                    c.value,
                  )}</select>`
                : `<input aria-label="Condition ${i + 1} value" data-part="value" value="${esc(c.value)}" maxlength="500" required ${c.field === 'age_days' ? 'type="number" min="0" max="36500"' : ''}>`
          }</label><button type="button" class="secondary danger" data-remove-condition="${i}" ${conditions.length === 1 ? 'disabled' : ''}>Remove</button></div>`;
        })
        .join('');
    };
    const renderActions = () => {
      form.querySelector('#rule-actions').innerHTML = actions
        .map(
          (a, i) =>
            `<div class="rule-builder-row" data-action-index="${i}"><label>Action<select data-part="type" aria-label="Action ${i + 1} type">${options(Object.entries(types), a.type)}</select></label>${a.type === 'move' || a.type.endsWith('_tag') ? `<label>Destination / tag<select data-part="value" aria-label="Action ${i + 1} value"><option value="">Choose…</option>${options(a.type === 'move' ? targets : tags.map((t) => [String(t.id), t.name]), a.value)}</select></label>` : ''}<button type="button" class="secondary" data-up-action="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move action ${i + 1} up">↑</button><button type="button" class="secondary danger" data-remove-action="${i}" ${actions.length === 1 ? 'disabled' : ''}>Remove</button></div>`,
        )
        .join('');
    };
    refreshTargets = renderActions;
    form.addEventListener('input', (event) => {
      const row = event.target.closest('[data-condition]');
      if (row && event.target.dataset.part === 'value')
        conditions[Number(row.dataset.condition)].value = event.target.value;
    });
    form.addEventListener('change', (event) => {
      let row = event.target.closest('[data-condition]');
      const part = event.target.dataset.part;
      if (row) {
        const index = Number(row.dataset.condition);
        if (part === 'field') {
          const f = event.target.value;
          conditions[index] = {
            field: f,
            operator:
              f === 'age_days'
                ? 'gt'
                : ['tag', 'unread', 'starred'].includes(f)
                  ? 'is'
                  : 'contains',
            value: ['unread', 'starred'].includes(f) ? 'true' : f === 'age_days' ? '0' : '',
          };
          renderConditions();
        } else if (part) conditions[index][part] = event.target.value;
      }
      row = event.target.closest('[data-action-index]');
      if (row) {
        const index = Number(row.dataset.actionIndex);
        if (part === 'type') {
          const type = event.target.value;
          actions[index] = { type, value: type === 'move' ? 'archive' : '' };
          renderActions();
        } else if (part) actions[index][part] = event.target.value;
      }
    });
    form.addEventListener('click', (event) => {
      const b = event.target.closest('button');
      if (!b) return;
      if (b.dataset.removeCondition !== undefined) {
        conditions.splice(Number(b.dataset.removeCondition), 1);
        renderConditions();
      }
      if (b.dataset.removeAction !== undefined) {
        actions.splice(Number(b.dataset.removeAction), 1);
        renderActions();
      }
      if (b.dataset.upAction !== undefined) {
        const i = Number(b.dataset.upAction);
        [actions[i - 1], actions[i]] = [actions[i], actions[i - 1]];
        renderActions();
      }
    });
    form.querySelector('#add-condition').onclick = () => {
      if (conditions.length >= 20) {
        toast('Maximum 20 conditions');
        return;
      }
      conditions.push({ field: 'subject', operator: 'contains', value: '' });
      renderConditions();
    };
    form.querySelector('#add-action').onclick = () => {
      if (actions.length >= 20) {
        toast('Maximum 20 actions');
        return;
      }
      actions.push({ type: 'star', value: '' });
      renderActions();
    };
    form.querySelector('#new-rule').onclick = () => {
      editor();
      root.querySelector('#rule-form [name=name]').focus();
    };
    renderConditions();
    renderActions();
    form.onsubmit = async (event) => {
      event.preventDefault();
      form.inert = true;
      try {
        await api('/rules' + (rule.id ? '/' + rule.id : ''), {
          method: rule.id ? 'PUT' : 'POST',
          body: {
            name: form.elements.name.value,
            enabled: form.elements.enabled.checked,
            mode: form.elements.mode.value,
            conditions,
            actions,
            exclude_unread: form.elements.exclude_unread.checked,
            older_than_days: Number(form.elements.older_than_days.value),
          },
        });
        await reloadList();
        if (isCurrent() && root.isConnected && epoch === editorEpoch) {
          editor();
          root.querySelector('#rules-list').scrollIntoView({ block: 'nearest' });
        }
        toast('Rule saved. Future imports use it immediately.');
      } catch (error) {
        toast(error.message);
      } finally {
        form.inert = false;
      }
    };
  };
  root.querySelector('#rules-search').oninput = renderList;
  root.querySelector('#create-rule').onclick = () => {
    editor();
    root.querySelector('#rule-form [name=name]').focus();
  };
  root.querySelector('#rules-list').onclick = async (event) => {
    const b = event.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.editRule) editor(rules.find((r) => r.id === Number(b.dataset.editRule)));
      if (b.dataset.copyRule) {
        const r = clean(rules.find((r) => r.id === Number(b.dataset.copyRule)));
        editor({ ...r, name: ('Copy of ' + r.name).slice(0, 100) });
      }
      if (b.dataset.editRule || b.dataset.copyRule)
        root.querySelector('#rule-form [name=name]').focus();
      if (b.dataset.deleteRule) {
        const epoch = editorEpoch;
        await api('/rules/' + b.dataset.deleteRule, { method: 'DELETE' });
        await reloadList();
        if (
          isCurrent() &&
          root.isConnected &&
          epoch === editorEpoch &&
          editingId === Number(b.dataset.deleteRule)
        )
          editor();
      }
      if (b.dataset.toggleRule) {
        const r = rules.find((r) => r.id === Number(b.dataset.toggleRule));
        await api('/rules/' + r.id, { method: 'PUT', body: { ...clean(r), enabled: !r.enabled } });
        await reloadList();
      }
    } catch (error) {
      toast(error.message);
    }
  };
  root.querySelector('#local-folder-form').onsubmit = async (event) => {
    event.preventDefault();
    try {
      const name = event.target.elements.name.value;
      const result = await api('/local-folders', {
        method: 'POST',
        body: { name },
      });
      if (isCurrent()) {
        targets.push(['local-' + result.id, name]);
        refreshTargets();
        event.target.reset();
        await foldersChanged();
      }
      toast('Local folder created.');
    } catch (error) {
      toast(error.message);
    }
  };
  root.querySelector('#apply-rules').onclick = async () => {
    const b = root.querySelector('#apply-rules');
    b.disabled = true;
    try {
      const result = await api('/rules/apply', { method: 'POST' });
      toast(result.matched + ' local copies matched.');
      if (isCurrent() && root.isConnected) {
        await foldersChanged();
        await reloadList();
      }
    } catch (error) {
      toast(error.message);
    } finally {
      b.disabled = false;
    }
  };
  renderList();
  editor();
};
