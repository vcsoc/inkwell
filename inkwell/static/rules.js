'use strict';
window.InkwellRules = async (root, { api, esc, field, toast, reload, isCurrent }) => {
  const [rules, folders] = await Promise.all([api('/rules'), api('/local-folders')]);
  if (!isCurrent()) return;
  const targets = [
    ['inbox', 'Inbox'],
    ['archive', 'Archive'],
    ['trash', 'Local Trash'],
    ...folders.map((f) => ['local-' + f.id, f.name]),
  ];
  root.innerHTML = `<section class="card"><h2>Import rules</h2><p>Rules organize local copies as they are first imported. Server emails are never moved or deleted. First matching enabled rule wins, in creation order. Manually moved copies are not changed.</p><form id="local-folder-form">${field('New local folder', 'name', '', 'text', 'required maxlength="80"')}<button class="secondary">Create local folder</button></form><div id="rule-editor"></div><h3>Saved rules</h3>${rules.map((r) => `<div class="rule-row"><div><strong>${esc(r.name)}</strong><p>${r.enabled ? 'Enabled' : 'Disabled'} · ${esc(r.match)}: ${esc(r.value)} → ${esc(targets.find((f) => f[0] === r.folder)?.[1] || r.folder)}${r.exclude_unread ? ' · read messages only' : ''}${r.older_than_days ? ' · older than ' + r.older_than_days + ' days' : ''}</p></div><button class="secondary" data-edit-rule="${r.id}">Edit</button><button class="secondary danger" data-delete-rule="${r.id}">Delete</button></div>`).join('') || '<p>No rules yet.</p>'}<button class="secondary" id="apply-rules">Apply rules to existing imported copies…</button><p class="notice">Age and read/unread exceptions are evaluated at import time, or when you explicitly apply rules to existing copies. This is not a background ageing scheduler. Destinations are local folders, not server folder operations.</p></section>`;
  const editor = (r = {}) => {
    root.querySelector('#rule-editor').innerHTML =
      `<h3>${r.id ? 'Edit rule' : 'New rule'}</h3><form id="rule-form">${field('Rule name', 'name', r.name || '', 'text', 'required maxlength="100"')}<label class="check-label"><input type="checkbox" name="enabled" ${r.enabled !== false ? 'checked' : ''}> Enabled</label><label class="field">Match<select name="match" aria-label="Match"><option value="sender">Exact sender address</option><option value="domain">Exact sender domain</option></select></label>${field('Sender address or domain', 'value', r.value || '', 'text', 'required maxlength="254"')}<label class="field">Move local copy to<select name="folder" aria-label="Move local copy to">${targets.map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join('')}</select></label><label class="check-label"><input name="exclude_unread" type="checkbox" ${r.exclude_unread ? 'checked' : ''}> Exclude unread messages</label>${field('Only messages older than days (0 = any age)', 'older_than_days', r.older_than_days || 0, 'number', 'required min="0" max="36500"')}<div class="form-actions"><button class="secondary" id="new-rule" type="button">New rule</button><button class="primary">Save rule</button></div></form>`;
    const form = root.querySelector('#rule-form');
    form.elements.match.value = r.match || 'sender';
    form.elements.folder.value = r.folder || 'archive';
    root.querySelector('#new-rule').onclick = () => editor();
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const body = Object.fromEntries(new FormData(form));
        body.enabled = form.elements.enabled.checked;
        body.exclude_unread = form.elements.exclude_unread.checked;
        body.older_than_days = Number(body.older_than_days);
        await api('/rules' + (r.id ? '/' + r.id : ''), { method: r.id ? 'PUT' : 'POST', body });
        await reload();
        toast('Rule saved. Future imports use it immediately.');
      } catch (error) {
        toast(error.message);
      }
    };
  };
  editor();
  root.querySelector('#local-folder-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/local-folders', { method: 'POST', body: { name: e.target.elements.name.value } });
      await reload();
      toast('Local folder created.');
    } catch (error) {
      toast(error.message);
    }
  };
  root
    .querySelectorAll('[data-edit-rule]')
    .forEach(
      (b) => (b.onclick = () => editor(rules.find((r) => r.id === Number(b.dataset.editRule)))),
    );
  root.querySelectorAll('[data-delete-rule]').forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await api('/rules/' + b.dataset.deleteRule, { method: 'DELETE' });
          await reload();
        } catch (error) {
          toast(error.message);
        }
      }),
  );
  root.querySelector('#apply-rules').onclick = async () => {
    try {
      const result = await api('/rules/apply', { method: 'POST' });
      await reload();
      toast(result.moved + ' local copies organized.');
    } catch (error) {
      toast(error.message);
    }
  };
};
