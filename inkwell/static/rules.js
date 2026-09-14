'use strict';
window.InkwellRules = async (
  root,
  { api, esc, field, toast, isCurrent, sourceMessage = null, foldersChanged = async () => {} },
) => {
  const [rules, folders, remote, tags, accounts, safeSenders] = await Promise.all([
    api('/rules'),
    api('/local-folders'),
    api('/remote-folders'),
    api('/tags'),
    api('/accounts'),
    api('/not-junk-senders'),
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
    tld: 'Sender TLD',
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
  root.innerHTML = `<div class="rule-manager"><div class="rule-manager-shell"><aside class="rule-list-pane card" aria-label="Saved rules"><div class="rule-list-heading"><h2>Rules</h2><span id="rule-count"></span></div><div class="rule-create-actions"><button class="primary" id="create-rule">Create rule</button><button class="secondary" id="auto-tag-rule" aria-label="Create auto-tag rule" title="Create auto-tag rule">Auto-tag</button></div><label class="field rule-search-label">Find rules<input type="search" id="rules-search" placeholder="Find a rule…"></label><div id="rules-list"></div><div class="rule-list-footer"><button class="secondary" id="apply-rules" title="Apply all enabled rules to eligible existing imported copies">Apply to existing mail</button><details id="rule-help"><summary>How rules work</summary><p>First matching enabled rule wins, in the order shown. Rules run on newly imported local copies, never on the server. Match all conditions (AND) or any (OR).</p><p>Apply existing skips drafts, sent, Trash and already locally managed copies. Missing resources or more than 12 final tags skip the rule without partial actions.</p><p>Auto-tag: Sender domain is @example.com → Add tag example. Exact domains exclude subdomains. TLD is the last label: example.co.uk has TLD .uk. Sender conditions do not verify identity. Age conditions are not a scheduler.</p></details><details id="rule-sender-tools"><summary>Not Junk senders</summary></details></div></aside><div class="rule-editor-pane"><section class="card" id="rule-editor"></section><details class="card" id="rule-resource-tools"><summary>Tags and folders</summary><div class="rule-resource-forms"><form id="rule-tag-form">${field('New rule tag', 'name', '', 'text', 'required maxlength="32"')}<button class="secondary">Create tag</button></form><form id="local-folder-form">${field('New local folder', 'name', '', 'text', 'required maxlength="80"')}<button class="secondary">Create local folder</button></form></div><p class="fine-print">Create a destination or tag without losing your edits. Tag colors are in Tag Manager.</p></details></div></div></div>`;
  root
    .querySelector('#rule-sender-tools')
    .insertAdjacentHTML(
      'beforeend',
      `<div id="not-junk-senders"><p>Exact sender addresses remembered across this workspace. Their incoming copies use the first applicable non-junk rule, or Inbox. Junk/Trash destinations are skipped. Sender headers can be spoofed; this is local filing, not an authentication guarantee or a change to Outlook spam filtering.</p>${safeSenders.map((s) => `<div class="rule-row"><span>${esc(s.sender_key)}</span><button class="secondary" data-forget-sender="${esc(s.sender_key)}">Forget sender</button></div>`).join('') || '<p>No remembered senders.</p>'}<p class="fine-print">Forgetting affects future imports only; it does not undo earlier filing.</p></div>`,
    );
  root.querySelectorAll('[data-forget-sender]').forEach(
    (button) =>
      (button.onclick = async () => {
        button.disabled = true;
        try {
          await api('/not-junk-senders?sender=' + encodeURIComponent(button.dataset.forgetSender), {
            method: 'DELETE',
          });
          button.closest('.rule-row').remove();
          toast('Sender forgotten. Existing mail stays where it is.');
        } catch (error) {
          toast(error.message);
          button.disabled = false;
        }
      }),
  );
  const clean = (r) => {
    const { id, problem, ...data } = r;
    return data;
  };
  const renderList = () => {
    const q = root.querySelector('#rules-search').value.toLowerCase();
    const visible = rules.filter((r) => r.name.toLowerCase().includes(q));
    root.querySelector('#rule-count').textContent = q
      ? `${visible.length} / ${rules.length}`
      : String(rules.length);
    root.querySelector('#rules-list').innerHTML =
      visible
        .map((r) => {
          const description =
            r.conditions
              .map(
                (c) =>
                  fields[c.field] +
                  ' ' +
                  operations[c.operator] +
                  ' ' +
                  (c.field === 'tag'
                    ? tags.find((t) => String(t.id) === c.value)?.name || 'Missing tag'
                    : c.value),
              )
              .join(r.mode === 'any' ? ' OR ' : ' AND ') +
            ' → ' +
            r.actions
              .map(
                (a) =>
                  types[a.type] +
                  (a.type === 'move'
                    ? ': ' + (targets.find((t) => t[0] === a.value)?.[1] || 'Missing folder')
                    : a.type.endsWith('_tag')
                      ? ': ' + (tags.find((t) => String(t.id) === a.value)?.name || 'Missing tag')
                      : ''),
              )
              .join(' → ');
          return `<div class="rule-entry ${r.id === editingId ? 'active' : ''}" data-rule-entry="${r.id}"><button class="rule-choice" data-edit-rule="${r.id}" aria-label="Edit ${esc(r.name)}" aria-current="${r.id === editingId ? 'true' : 'false'}" title="${esc(r.name + ' — ' + description)}"><strong>${rules.indexOf(r) + 1}. ${esc(r.name)}</strong><small>${r.enabled ? 'Enabled' : 'Disabled'} · ${r.mode === 'any' ? 'ANY' : 'ALL'} of ${r.conditions.length} ${r.conditions.length === 1 ? 'condition' : 'conditions'} · ${r.actions.length} ${r.actions.length === 1 ? 'action' : 'actions'}</small></button>${r.problem ? `<p class="danger rule-problem">${esc(r.problem)}</p>` : ''}<div class="rule-entry-tools"><button class="secondary" data-toggle-rule="${r.id}">${r.enabled ? 'Disable' : 'Enable'}</button><button class="secondary" data-copy-rule="${r.id}">Duplicate</button><button class="secondary danger" data-delete-rule="${r.id}">Delete</button></div></div>`;
        })
        .join('') || '<p class="rule-empty">No matching rules.</p>';
  };
  let refreshTargets = () => {},
    selectCreatedTag = () => {},
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
  const paintSelection = () => {
    root.querySelectorAll('[data-rule-entry]').forEach((row) => {
      const active = Number(row.dataset.ruleEntry) === editingId;
      row.classList.toggle('active', active);
      row.querySelector('[data-edit-rule]').setAttribute('aria-current', String(active));
    });
  };
  const editor = (rule = {}, context = null) => {
    const epoch = ++editorEpoch;
    let savedId = rule.id;
    editingId = rule.id || null;
    paintSelection();
    let conditions = structuredClone(
      rule.conditions || [{ field: 'subject', operator: 'contains', value: '' }],
    );
    let actions = structuredClone(rule.actions || [{ type: 'move', value: 'archive' }]);
    root.querySelector('#rule-editor').innerHTML =
      `<h2>${rule.id ? 'Edit rule' : 'New rule'}</h2>${context ? `<p class="rule-context" title="${esc(context.subject)}">From message: ${esc(context.subject)}</p>` : ''}<form id="rule-form"><div class="rule-name-row">${field('Rule name', 'name', rule.name || '', 'text', 'required maxlength="100"')}<label class="check-label"><input type="checkbox" name="enabled" ${rule.enabled !== false ? 'checked' : ''}> Enabled</label></div><div class="rule-condition-heading"><h3>Conditions</h3><label class="field rule-match">Match<select name="mode" aria-label="Match conditions"><option value="all">All (AND)</option><option value="any">Any (OR)</option></select></label></div><div id="rule-conditions"></div><button type="button" class="secondary" id="add-condition">Add condition</button><h3>Actions</h3><div id="rule-actions"></div><button type="button" class="secondary" id="add-action">Add action</button><details id="rule-advanced" ${rule.exclude_unread || rule.older_than_days ? 'open' : ''}><summary>Advanced options</summary><label class="check-label"><input name="exclude_unread" type="checkbox" ${rule.exclude_unread ? 'checked' : ''}> Exclude unread messages</label>${field('Only messages older than days (0 = any age)', 'older_than_days', rule.older_than_days || 0, 'number', 'required min="0" max="36500"')}</details><div class="form-actions"><button class="primary">Save rule</button>${context ? `<button class="primary" name="apply_message" ${context.can_apply ? '' : 'disabled'}>Save and apply to this message</button><p class="fine-print">Only the selected cached incoming copy is applied now; future imports use normal rule priority. Drafts and sent copies are excluded.</p>` : ''}</div></form>`;
    const form = root.querySelector('#rule-form');
    form.addEventListener(
      'invalid',
      (event) => {
        const details = event.target.closest('details');
        if (details) details.open = true;
      },
      true,
    );
    form.elements.mode.value = rule.mode || 'all';
    const renderConditions = () => {
      form.querySelector('#rule-conditions').innerHTML = conditions
        .map((c, i) => {
          const ops =
            c.field === 'age_days'
              ? ['gt', 'lt']
              : ['tld', 'tag', 'unread', 'starred'].includes(c.field)
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
    selectCreatedTag = (tag, requestedEpoch) => {
      if (requestedEpoch !== epoch) return;
      const action = actions.find((a) => a.type === 'add_tag' && !a.value);
      if (action) action.value = String(tag.id);
    };
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
                : ['sender', 'domain', 'tld', 'tag', 'unread', 'starred'].includes(f)
                  ? 'is'
                  : 'contains',
            value:
              context?.values?.[f] ||
              (['unread', 'starred'].includes(f) ? 'true' : f === 'age_days' ? '0' : ''),
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
    renderConditions();
    renderActions();
    form.onsubmit = async (event) => {
      event.preventDefault();
      form.inert = true;
      try {
        const saved = await api('/rules' + (savedId ? '/' + savedId : ''), {
          method: savedId ? 'PUT' : 'POST',
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
        savedId = savedId || saved.id;
        if (epoch === editorEpoch) editingId = savedId;
        await reloadList();
        let applied = null;
        if (context && event.submitter?.name === 'apply_message') {
          try {
            applied = (
              await api('/rules/' + savedId + '/apply-message', {
                method: 'POST',
                body: { message_id: context.message_id },
              })
            ).applied;
            await foldersChanged();
          } catch (error) {
            toast('Rule saved, but applying failed: ' + error.message);
            return;
          }
        }
        if (isCurrent() && root.isConnected && epoch === editorEpoch) {
          editor(rules.find((r) => r.id === savedId) || {}, context);
          root.querySelector('#rule-form .primary:not([name])')?.focus({ preventScroll: true });
        }
        toast(
          applied === null
            ? 'Rule saved. Future imports use it immediately.'
            : applied
              ? 'Rule saved and applied to this local message.'
              : 'Rule saved; this message did not match, or action limits / Not Junk protection prevented applying it.',
        );
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
  root.querySelector('#auto-tag-rule').onclick = () => {
    editor({
      conditions: [{ field: 'domain', operator: 'is', value: '' }],
      actions: [{ type: 'add_tag', value: '' }],
    });
    root.querySelector('#rule-form [name=name]').focus();
  };
  root.querySelector('#rule-tag-form').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.target,
      epoch = editorEpoch;
    form.inert = true;
    try {
      const tag = await api('/tags', { method: 'POST', body: { name: form.elements.name.value } });
      if (!isCurrent() || !root.isConnected) return;
      const fresh = await api('/tags');
      if (!isCurrent() || !root.isConnected) return;
      tags.splice(0, tags.length, ...fresh);
      selectCreatedTag(tag, epoch);
      refreshTargets();
      renderList();
      form.reset();
      toast('Tag created. Save the rule to enable automatic tagging.');
    } catch (error) {
      toast(error.message);
    } finally {
      form.inert = false;
    }
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
        const epoch = editorEpoch,
          checkbox = editingId === r.id ? root.querySelector('#rule-form [name=enabled]') : null;
        b.disabled = true;
        if (checkbox) checkbox.disabled = true;
        try {
          await api('/rules/' + r.id, {
            method: 'PUT',
            body: { ...clean(r), enabled: !r.enabled },
          });
          await reloadList();
          if (isCurrent() && root.isConnected && epoch === editorEpoch) {
            if (checkbox) checkbox.checked = !r.enabled;
            root.querySelector(`[data-toggle-rule="${r.id}"]`)?.focus({ preventScroll: true });
          }
        } finally {
          b.disabled = false;
          if (checkbox) checkbox.disabled = false;
        }
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
  editor(sourceMessage?.rule || rules[0] || {}, sourceMessage);
  if (sourceMessage) root.querySelector('#rule-form [name=name]').focus();
};
