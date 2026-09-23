'use strict';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
let preferences = { form_mode: 'popup', layout: 'focus', theme: { ...InkwellAppearance.defaults } };
let workspaceTimer;
let pendingWorkspace = {};
function saveWorkspace(patch) {
  Object.assign(preferences, patch);
  if (patch.ui_zoom && $('#form-mode-settings [name=ui_zoom]'))
    $('#form-mode-settings [name=ui_zoom]').value = patch.ui_zoom;
  Object.assign(pendingWorkspace, patch);
  applyLayout();
  clearTimeout(workspaceTimer);
  workspaceTimer = setTimeout(() => {
    const body = pendingWorkspace;
    pendingWorkspace = {};
    api('/preferences/workspace', { method: 'PATCH', body }).catch((error) => toast(error.message));
  }, 250);
}
const bindWorkspaceControls = InkwellWorkspaceControls(() => preferences, saveWorkspace);
function applyLayout() {
  const keys = preferences.shortcuts || InkwellHotkeys.defaults;
  window.inkwellShortcuts?.configure(keys);
  $('#sync').title = 'Sync email' + (keys.sync ? ' (' + keys.sync + ')' : '');
  if (keys.sync)
    $('#sync').setAttribute('aria-keyshortcuts', keys.sync.replace('Ctrl+', 'Control+'));
  else $('#sync').removeAttribute('aria-keyshortcuts');
  document.documentElement.style.setProperty(
    '--sidebar-width',
    (preferences.sidebar_width || 260) + 'px',
  );
  document.documentElement.style.setProperty(
    '--message-list-width',
    (preferences.message_list_width || 380) + 'px',
  );
  document.documentElement.style.zoom = (preferences.ui_zoom || 100) / 100;
  bindWorkspaceControls();
  document.documentElement.dataset.layout = preferences.layout || 'focus';
}
const state = {
  view: 'inbox',
  settingsPage: 'overview',
  route: '#/inbox',
  messages: [],
  selected: null,
  accounts: [],
  remoteFolders: [],
  searchScope: 'folder',
  events: [],
  contacts: [],
  counts: [],
  pinnedFolders: [],
  filter: 'all',
  query: '',
  offset: 0,
  month: new Date(),
  aiAnswer: '',
  generation: 0,
};
const messageMenu = InkwellMessageMenu(async (kind, id) => {
  if (!['sender', 'organisation', 'subject'].includes(kind)) return messageAction(kind, id);
  const generation = state.generation;
  const descriptor = await api('/collections/from-message/' + id + '?kind=' + kind);
  if (generation !== state.generation) return;
  state.collection = descriptor;
  await navigate('collection');
}, toast);
const selection = InkwellMessageSelection({
  state,
  api,
  esc,
  toast,
  refresh: async ({ generation = state.generation, affected = null } = {}) => {
    await refreshCounts();
    if (generation !== state.generation) return;
    if (affected && state.selected && !affected.includes(state.selected.id)) {
      await renderMail({ listOnly: true });
      return;
    }
    state.selected = null;
    await renderMail();
  },
});
function closeMessageMenu() {
  messageMenu.close();
}
function canMarkNotJunk(message) {
  if (
    !message ||
    !message.sender?.includes('@') ||
    message.draft_revision ||
    ['drafts', 'sent'].includes(message.folder) ||
    ['drafts', 'sent'].includes(message.restore_folder)
  )
    return false;
  const folder = state.remoteFolders.find((f) => f.id === message.remote_folder_id);
  return !(
    ['drafts', 'sentitems'].includes(folder?.well_known) ||
    ['drafts', 'sent', 'sent items'].includes(folder?.name?.toLowerCase())
  );
}
function showMessageMenu(id, trigger, event) {
  $('#message-menu [data-action=delete]').hidden = !['trash', 'drafts'].includes(
    (state.messages.find((m) => m.id === id) || state.selected)?.folder,
  );
  $('#message-menu [data-action=restore]').hidden =
    (state.messages.find((m) => m.id === id) || state.selected)?.folder !== 'trash';
  $('#message-menu [data-action=not-junk]').hidden = !canMarkNotJunk(
    state.messages.find((m) => m.id === id) || state.selected,
  );
  $('#message-menu [data-action=appearance]').hidden = state.selected?.id !== id;
  const rect = trigger.getBoundingClientRect();
  messageMenu.show(id, trigger, event?.clientX || rect.left, event?.clientY || rect.bottom);
}
const folders = [
  ['inbox', '▤', 'Inbox'],
  ['starred', '☆', 'Starred'],
  ['sent', '↗', 'Sent'],
  ['drafts', '▧', 'Drafts'],
  ['archive', '▣', 'Archive'],
  ['trash', '♧', 'Trash'],
  ['calendar', '▦', 'Calendar'],
  ['contacts', '♙', 'People'],
];
let toastTimer;
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.add('hidden'), 6500);
}
let pendingWork = 0;
function activity() {
  document.documentElement.dataset.busy = String(pendingWork > 0);
  $('#mail-activity')?.setAttribute('aria-hidden', String(pendingWork === 0));
}
async function api(path, options = {}) {
  pendingWork++;
  activity();
  try {
    const response = await fetch('/api' + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'X-Inkwell': '1', ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const data = await response.json().catch(() => ({ detail: 'Unexpected server response' }));
    if (!response.ok)
      throw new Error(
        Array.isArray(data.detail)
          ? data.detail.map((e) => e.msg).join('; ')
          : data.detail || 'Request failed',
      );
    return data;
  } finally {
    pendingWork--;
    activity();
  }
}
function on(target, event, handler) {
  target.addEventListener(event, async (e) => {
    try {
      await handler(e);
    } catch (error) {
      toast(error.message);
    }
  });
}
function initials(name) {
  return name
    .replace(/<.*>/, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0] || '')
    .join('')
    .toUpperCase();
}
function displayName(sender) {
  return sender.replace(/<.*>/, '').replaceAll('"', '').trim();
}
function timeLabel(date) {
  const d = new Date(date);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function localInput(date) {
  const d = new Date(date);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function field(label, name, value = '', type = 'text', extra = '') {
  return `<label class="field">${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function textarea(label, name, value = '', extra = '') {
  return `<label class="field">${esc(label)}<textarea name="${name}" rows="4" ${extra}>${esc(value)}</textarea></label>`;
}
function modal(title, html, { calendar = false } = {}) {
  const dialog = $('#modal');
  state.formCleanup?.();
  state.formCleanup = null;
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  InkwellAddressAutocomplete($('#modal-body'), api);
  if (!dialog.open) {
    state.formReturnFocus = document.activeElement;
    if (preferences.form_mode === 'inline') {
      $('#sidebar').classList.remove('open');
      $('#ai-panel').classList.add('hidden');
      dialog.classList.add('inline-form');
      if (calendar) {
        const wrapper = document.createElement('div');
        wrapper.id = 'calendar-editor-layout';
        $('main').insertBefore(wrapper, $('#workspace'));
        wrapper.append($('#workspace'), dialog);
      } else $('main').insertBefore(dialog, $('#workspace'));
      dialog.show();
      dialog.scrollIntoView({ block: 'start' });
    } else {
      dialog.showModal();
    }
  }
  $('input, select, textarea, button', $('#modal-body'))?.focus();
}
$('#modal').addEventListener('close', () => {
  if ($('#modal').open) return;
  state.formCleanup?.();
  state.formCleanup = null;
  $('#modal').classList.remove('inline-form');
  document.body.append($('#modal'));
  const calendarLayout = $('#calendar-editor-layout');
  if (calendarLayout) {
    calendarLayout.before($('#workspace'));
    calendarLayout.remove();
  }
  if (state.formReturnFocus?.isConnected) state.formReturnFocus.focus();
  const next = state.afterFormClose;
  state.afterFormClose = null;
  if (next) next();
});
let closingForm = null;
function requestModalClose() {
  if (closingForm) return closingForm;
  closingForm = (async () => {
    const dialog = $('#modal'),
      form = $('#modal-body form'),
      composer = state.composer;
    const willNavigate = !!state.afterFormClose;
    if (form) form.inert = true;
    try {
      if (composer) {
        if (composer.sending) await composer.sending;
        await composer.flush();
        composer.stop();
        if (state.composer === composer) state.composer = null;
      }
      if (dialog.open) {
        const closed = new Promise((resolve) =>
          dialog.addEventListener('close', resolve, { once: true }),
        );
        dialog.close();
        await closed;
      }
      if (composer && !willNavigate && state.view === 'drafts') await renderMail();
      return true;
    } catch (error) {
      if (form) form.inert = false;
      state.afterFormClose = null;
      if (location.hash !== state.route) history.replaceState({ inkwell: true }, '', state.route);
      toast(error.message);
      return false;
    }
  })().finally(() => {
    closingForm = null;
  });
  return closingForm;
}
window.inkwellFlushBeforeClose = () =>
  state.composer ? requestModalClose() : Promise.resolve(true);
const collapsedFolders = new Set();
const folderIcon = () =>
  '<svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path class="folder-closed" d="M2.5 6.5a2 2 0 0 1 2-2h5l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z"/><path class="folder-open" d="M2.5 8.5v-2a2 2 0 0 1 2-2h5l2 2h8a2 2 0 0 1 2 2v2M2.5 20.5l3-9h16l-3 9z"/></svg>';
function pinnedRows() {
  const builtins = new Set(['inbox', 'archive', 'sent', 'drafts', 'trash']);
  const rows = state.pinnedFolders
    .map((key) => {
      const local = state.localFolders?.find((f) => 'local-' + f.id === key);
      const remote = state.remoteFolders.find((f) => 'remote:' + f.id === key);
      if (!local && !remote && !builtins.has(key)) return '';
      const name = local?.name || remote?.name || folders.find((f) => f[0] === key)?.[2] || key;
      const path = (local?.path || remote?.path || name).replace(/\s*\/\s*/g, ' \\ ');
      const total = remote
        ? remote.cached_total || 0
        : state.counts.find((c) => c.folder === key)?.total || 0;
      const target = remote ? `data-remote-folder="${remote.id}"` : `data-view="${key}"`;
      return `<button class="nav-item pinned-link" ${target} title="${esc(path)}" aria-label="${esc(name + ' (' + path + ') ' + total)}"><span>${folderIcon()}</span><span class="pinned-label">${esc(name)} <span class="pinned-path">(${esc(path)})</span></span><small class="pinned-count">${total}</small></button>`;
    })
    .filter(Boolean)
    .join('');
  return `<section class="pinned-folders" aria-label="Pinned folders"><h3>Pinned</h3>${rows || '<p class="pinned-empty">Right-click a folder to pin it here.</p>'}</section>`;
}
function localChildren(parent, seen = new Set()) {
  return (state.localFolders || [])
    .filter((f) => f.parent === parent && !seen.has(f.id))
    .map((f) => {
      const next = new Set(seen);
      next.add(f.id);
      const key = 'local-' + f.id;
      const button = `<button class="nav-item ${state.view === key ? 'active' : ''}" data-view="${key}" aria-label="${esc(f.path || f.name)}" title="${esc(f.path || f.name)} · Local folder"><span>${folderIcon()}</span><span class="folder-name">${esc(f.name)}</span></button>`;
      return localBranch(key, button, localChildren(key, next));
    })
    .join('');
}
function localBranch(key, button, children = localChildren(key)) {
  return children
    ? `<details data-local-branch="${key}" ${collapsedFolders.has(key) ? '' : 'open'}><summary>${button}</summary><div class="folder-children">${children}</div></details>`
    : button;
}
function remoteTree() {
  return state.accounts
    .filter((a) => state.remoteFolders.some((f) => f.account_id === a.id))
    .map((account, index) => {
      const entries = state.remoteFolders.filter((f) => f.account_id === account.id);
      const seen = new Set();
      const branch = (parent, depth = 0) =>
        depth > 40
          ? ''
          : entries
              .filter((f) => f.parent_remote_id === parent)
              .map((folder) => {
                if (seen.has(folder.id)) return '';
                seen.add(folder.id);
                const button = `<button class="nav-item remote-folder ${state.remoteFolder?.id === folder.id && state.view === 'remote' ? 'active' : ''}" data-remote-folder="${folder.id}" title="${esc(folder.path)} · ${folder.cached_total ?? 0} cached · ${folder.total_count} server items (may include non-mail) · ${folder.unread_count || 0} unread items on server" aria-label="${esc(folder.path)}"><span>${folderIcon()}</span><span class="folder-name">${esc(folder.name)}</span><small>${(folder.cached_unread ?? folder.unread_count) || ''}</small></button>`;
                const children =
                  branch(folder.remote_id, depth + 1) + localChildren('remote:' + folder.id);
                return children
                  ? `<details data-folder-branch="${folder.id}" ${collapsedFolders.has(folder.id) ? '' : 'open'}><summary>${button}</summary><div class="folder-children">${children}</div></details>`
                  : button;
              })
              .join('');
      return `<section class="server-folders" aria-label="${esc(account.email)} server folders"><details data-account-folder-group="${account.id}" ${collapsedFolders.has('account:' + account.id) ? '' : 'open'}><summary class="folder-account-heading" title="${esc(account.email)}"><span>${account.provider === 'microsoft' ? 'Outlook' : 'Server'}${state.accounts.length > 1 ? ' ' + (index + 1) : ''}</span></summary>${branch('')}</details></section>`;
    })
    .join('');
}
let navigationKey = '';
function paintNavigation() {
  for (const b of $$('#navigation [data-view]'))
    b.classList.toggle('active', b.dataset.view === state.view);
  for (const b of $$('#navigation [data-remote-folder]')) {
    const f = state.remoteFolders.find((f) => f.id === Number(b.dataset.remoteFolder));
    b.classList.toggle('active', state.view === 'remote' && state.remoteFolder?.id === f?.id);
    if (f && !b.classList.contains('pinned-link')) {
      b.querySelector('small').textContent = (f.cached_unread ?? f.unread_count) || '';
      b.title = `${f.path} · ${f.cached_total ?? 0} cached · ${f.total_count} server items (may include non-mail) · ${f.unread_count || 0} unread items on server`;
    }
  }
  $$('#navigation .pinned-link').forEach((button) => {
    const key = button.dataset.view || 'remote:' + button.dataset.remoteFolder;
    const remote = state.remoteFolders.find((f) => 'remote:' + f.id === key);
    button.querySelector('.pinned-count').textContent = remote
      ? remote.cached_total || 0
      : state.counts.find((c) => c.folder === key)?.total || 0;
  });
  const inbox = $('#navigation [data-view=inbox]:not(.pinned-link)'),
    unread = state.counts.find((c) => c.folder === 'inbox')?.unread || 0;
  let count = inbox?.querySelector('.nav-count');
  if (unread && !count) {
    count = document.createElement('span');
    count.className = 'nav-count';
    inbox.append(count);
  }
  if (count) {
    count.textContent = unread || '';
    count.hidden = !unread;
  }
  $$('.mobile-tabs button, .app-rail button').forEach((b) =>
    b.classList.toggle(
      'active',
      b.dataset.view === state.view ||
        (b.dataset.view === 'inbox' &&
          !['calendar', 'contacts', 'settings', 'tags', 'rules'].includes(state.view)),
    ),
  );
  $('#tag-manager-link').classList.toggle('active', state.view === 'tags');
  $('#rule-manager-link').classList.toggle('active', state.view === 'rules');
}
$('#navigation').addEventListener('dblclick', (event) => {
  if (event.button !== 0) return;
  const summary = event.target.closest('summary');
  if (!summary || summary.parentElement.tagName !== 'DETAILS') return;
  event.preventDefault();
  event.stopPropagation();
  summary.parentElement.open = !summary.parentElement.open;
});
function navigation() {
  const key = JSON.stringify([
    state.localFolders,
    state.pinnedFolders,
    state.accounts.map((a) => [a.id, a.email, a.provider]),
    state.remoteFolders.map((f) => [
      f.id,
      f.account_id,
      f.remote_id,
      f.parent_remote_id,
      f.name,
      f.path,
    ]),
  ]);
  if (key === navigationKey && $('#navigation').children.length) {
    paintNavigation();
    return;
  }
  navigationKey = key;
  $('#navigation').innerHTML =
    pinnedRows() +
    folders
      .map(([id, icon, name], i) => {
        const local = state.localFolders?.find((f) => 'local-' + f.id === id);
        const parent = local?.parent;
        const divider =
          i === 6
            ? '<div class="nav-divider"></div>' +
              (state.localFolders?.length
                ? '<div id="folder-root-drop" aria-label="Move folder to top level" title="Move folder to top level"></div>'
                : '')
            : '';
        if (
          parent &&
          (['inbox', 'archive', 'sent', 'drafts', 'trash'].includes(parent) ||
            state.localFolders.some((f) => 'local-' + f.id === parent) ||
            state.remoteFolders.some((f) => 'remote:' + f.id === parent))
        )
          return divider;
        const button = `<button class="nav-item ${state.view === id ? 'active' : ''}" data-view="${id}" aria-label="${esc(name)}"><span aria-hidden="true">${local || ['inbox', 'sent', 'drafts', 'archive', 'trash'].includes(id) ? folderIcon() : icon}</span>${local ? `<span class="folder-name">${esc(local.name)}</span>` : esc(name)}${id === 'inbox' && state.counts.find((c) => c.folder === id)?.unread ? `<span class="nav-count">${state.counts.find((c) => c.folder === id).unread}</span>` : ''}</button>`;
        return divider + localBranch(id, button);
      })
      .join('');
  const serverTree = remoteTree();
  if (serverTree)
    $('#navigation [data-view=calendar]').insertAdjacentHTML(
      'beforebegin',
      '<div class="nav-divider"></div>' + serverTree,
    );
  $('#navigation [data-view=inbox]:not(.pinned-link)').title =
    'All cached Inbox mail in inkwell, across accounts';
  $('#navigation [data-view=drafts]:not(.pinned-link)').title =
    'Editable drafts saved locally in inkwell';
  $$('#navigation [data-account-folder-group]').forEach((d) =>
    d.addEventListener('toggle', () => {
      const key = 'account:' + d.dataset.accountFolderGroup;
      if (d.open) collapsedFolders.delete(key);
      else collapsedFolders.add(key);
    }),
  );
  $$('#navigation [data-remote-folder]').forEach((b) =>
    on(b, 'click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      return navigate('remote/' + b.dataset.remoteFolder);
    }),
  );
  $$('#navigation [data-folder-branch]').forEach((d) =>
    d.addEventListener('toggle', () => {
      const id = Number(d.dataset.folderBranch);
      if (d.open) collapsedFolders.delete(id);
      else collapsedFolders.add(id);
    }),
  );
  $$('#navigation [data-local-branch]').forEach((d) =>
    d.addEventListener('toggle', () => {
      if (d.open) collapsedFolders.delete(d.dataset.localBranch);
      else collapsedFolders.add(d.dataset.localBranch);
    }),
  );
  $$('#navigation [data-view]').forEach((b) =>
    on(b, 'click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      return navigate(b.dataset.view);
    }),
  );
  $$('#navigation .server-folders .nav-item').forEach((button) => {
    let depth = 1;
    for (
      let p = button.parentElement;
      p && !p.classList.contains('server-folders');
      p = p.parentElement
    )
      if (p.classList.contains('folder-children')) depth++;
    const indent = 8 + Math.min(depth, 6) * 10;
    button.style.paddingInlineStart = indent + 16 + 'px';
    if (button.parentElement.tagName === 'SUMMARY')
      button.parentElement.style.setProperty('--folder-indent', indent + 'px');
  });
  $$('.mobile-tabs button, .app-rail button').forEach((b) =>
    b.classList.toggle(
      'active',
      b.dataset.view === state.view ||
        (b.dataset.view === 'inbox' &&
          !['calendar', 'contacts', 'settings', 'tags', 'rules'].includes(state.view)),
    ),
  );
  $('#account-status').textContent = state.accounts.length
    ? `${state.accounts.length} connected account${state.accounts.length === 1 ? '' : 's'}`
    : 'No account connected';
  $('#tag-manager-link').classList.toggle('active', state.view === 'tags');
  $('#rule-manager-link').classList.toggle('active', state.view === 'rules');
  paintNavigation();
  selection.bindFolders();
  folderDrag.bind();
}
function installLocalFolders(localFolders) {
  state.localFolders = localFolders;
  for (let i = folders.length - 1; i >= 0; i--)
    if (folders[i][0].startsWith('local-')) folders.splice(i, 1);
  folders.splice(
    6,
    0,
    ...localFolders.map((folder) => ['local-' + folder.id, '▱', folder.path || folder.name]),
  );
}
async function applyFolderMove(data) {
  await api('/local-folders/move', { method: 'POST', body: data });
  const destination =
    data.placement === 'inside'
      ? data.target
      : state.localFolders.find((f) => 'local-' + f.id === data.target)?.parent;
  if (destination)
    collapsedFolders.delete(
      destination.startsWith('remote:') ? Number(destination.slice(7)) : destination,
    );
  await refreshCounts();
  $('#rule-editor')?.dispatchEvent(
    new CustomEvent('inkwell-folders-changed', { detail: state.localFolders }),
  );
  if (state.view.startsWith('local-')) {
    const title = folders.find((f) => f[0] === state.view)?.[2];
    if (title) {
      $('#breadcrumb').textContent = title;
      $('#page-title').innerHTML = esc(title) + '<span>.</span>';
      document.title = title + ' — inkwell';
    }
  }
  toast('Local folder moved. Mail and rules were preserved.');
}
const folderDrag = InkwellFolderDrag($('#navigation'), {
  folders: () => state.localFolders || [],
  onMove: applyFolderMove,
  onError: toast,
});
async function moveFolderForm(selected) {
  if (!(await requestModalClose())) return;
  const source = state.localFolders.find((f) => 'local-' + f.id === selected.key);
  if (!source) return;
  const excluded = new Set([selected.key]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of state.localFolders)
      if (excluded.has(f.parent) && !excluded.has('local-' + f.id)) {
        excluded.add('local-' + f.id);
        changed = true;
      }
  }
  modal(
    'Move folder',
    `<form id="folder-move-form"><p>${esc(source.path || source.name)}</p><p class="fine-print">Local folders only. Mail stays in the same folder; server folders are unchanged.</p><label class="field">Placement<select name="placement" aria-label="Placement"><option value="inside">Inside folder</option><option value="before">Before folder</option><option value="after">After folder</option></select></label><label class="field">Target folder<select name="target" aria-label="Target folder"></select></label><p id="folder-move-preview" class="notice" aria-live="polite"></p><div class="form-actions"><button class="primary">Move folder</button></div></form>`,
  );
  const form = $('#folder-move-form');
  const update = () => {
    const previous = form.elements.target.value;
    const choices =
      form.elements.placement.value === 'inside'
        ? [
            ['', 'Top level'],
            ...['inbox', 'archive', 'sent', 'drafts', 'trash'].map((k) => [
              k,
              k[0].toUpperCase() + k.slice(1),
            ]),
            ...state.remoteFolders.map((f) => ['remote:' + f.id, f.path + ' (local view)']),
          ]
        : [];
    choices.push(
      ...state.localFolders
        .filter((f) => !excluded.has('local-' + f.id))
        .map((f) => ['local-' + f.id, f.path || f.name]),
    );
    form.elements.target.innerHTML = choices
      .map(([key, label]) => `<option value="${key}">${esc(label)}</option>`)
      .join('');
    if (choices.some(([key]) => key === previous)) form.elements.target.value = previous;
    $('button', form).disabled = !choices.length;
    preview();
  };
  const preview = () => {
    $('#folder-move-preview').textContent =
      'Place ' +
      source.name +
      ' ' +
      form.elements.placement.value +
      ' ' +
      (form.elements.target.selectedOptions[0]?.textContent || '—');
  };
  form.elements.placement.onchange = update;
  form.elements.target.onchange = preview;
  update();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = $('button', form);
    if (button.disabled) return;
    button.disabled = true;
    try {
      await applyFolderMove({
        id: source.id,
        target: form.elements.target.value,
        placement: form.elements.placement.value,
      });
      if (form.isConnected) await requestModalClose();
    } catch (error) {
      toast(error.message);
      button.disabled = false;
    }
  };
}
InkwellFolderMenu(
  $('#navigation'),
  async (parent) => {
    if (!(await requestModalClose())) return;
    modal(
      'New subfolder',
      `<form id="subfolder-form"><p>Under: <strong>${esc(parent.name)}</strong></p><p class="fine-print">Local to inkwell. No server folders are created or changed.</p>${field('Folder name', 'name', '', 'text', 'required maxlength="80"')}<div class="form-actions"><button class="primary">Create subfolder</button></div></form>`,
    );
    const form = $('#subfolder-form');
    form.onsubmit = async (event) => {
      event.preventDefault();
      const button = $('button', form);
      if (button.disabled) return;
      button.disabled = true;
      try {
        await api('/local-folders', {
          method: 'POST',
          body: { name: form.elements.name.value, parent: parent.key },
        });
        collapsedFolders.delete(
          parent.key.startsWith('remote:') ? Number(parent.key.slice(7)) : parent.key,
        );
        if (form.isConnected) await requestModalClose();
        await refreshCounts();
        $('#rule-editor')?.dispatchEvent(
          new CustomEvent('inkwell-folders-changed', { detail: state.localFolders }),
        );
        toast('Local subfolder created.');
      } catch (error) {
        toast(error.message);
        button.disabled = false;
      }
    };
  },
  toast,
  moveFolderForm,
  async (key) => {
    const pinned = state.pinnedFolders.includes(key);
    const next = pinned
      ? state.pinnedFolders.filter((item) => item !== key)
      : [...state.pinnedFolders, key];
    state.pinnedFolders = await api('/pinned-folders', { method: 'PUT', body: { folders: next } });
    navigation();
    toast(pinned ? 'Folder unpinned.' : 'Folder pinned for quick access.');
  },
  (key) => state.pinnedFolders.includes(key),
);
async function refreshCounts() {
  const [counts, accounts, remoteFolders, localFolders, pinnedFolders] = await Promise.all([
    api('/counts'),
    api('/accounts'),
    api('/remote-folders'),
    api('/local-folders'),
    api('/pinned-folders'),
  ]);
  Object.assign(state, { counts, accounts, remoteFolders, localFolders, pinnedFolders });
  installLocalFolders(localFolders);
  navigation();
}
function routeFromLocation() {
  const legacy = location.hash.match(/^#settings-(layout|forms|theme|mail|assistant)$/);
  if (legacy) return 'settings/' + legacy[1];
  return location.hash.startsWith('#/') ? location.hash.slice(2) : 'inbox';
}
async function navigate(route, { historyMode = 'push' } = {}) {
  if ($('#modal').open) {
    state.afterFormClose = () =>
      navigate(route, { historyMode }).catch((error) => toast(error.message));
    requestModalClose();
    return;
  }
  if (!['settings', 'rules', 'tags', 'calendar', 'contacts'].includes(state.view)) {
    const folder = state.remoteFolder
      ? 'remote:' + state.remoteFolder.id
      : /^(inbox|archive|trash|sent|drafts|local-[1-9][0-9]*)$/.test(state.view)
        ? state.view
        : null;
    state.ruleExecutionContext = {
      folder,
      message_id: state.selected?.id || null,
      subject: state.selected?.subject || '',
    };
  }
  const [requestedView, requestedPage] = route.split('/');
  const allowedViews = [
    ...folders.map((folder) => folder[0]),
    'settings',
    'collection',
    'remote',
    'tags',
    'rules',
  ];
  let view = allowedViews.includes(requestedView) ? requestedView : 'inbox';
  if (view === 'collection' && !state.collection) view = 'inbox';
  state.remoteFolder =
    view === 'remote' ? state.remoteFolders.find((f) => f.id === Number(requestedPage)) : null;
  if (view === 'remote' && !state.remoteFolder) view = 'inbox';
  const settingsPage = InkwellSettings.pages.find((page) => page.id === requestedPage);
  state.settingsPage = view === 'settings' ? settingsPage?.id || 'overview' : 'overview';
  const nextRoute =
    '#/' +
    view +
    (view === 'settings' && settingsPage
      ? '/' + settingsPage.id
      : view === 'remote'
        ? '/' + state.remoteFolder.id
        : '');
  if (historyMode === 'replace' || !history.state?.inkwell)
    history.replaceState({ inkwell: true }, '', nextRoute);
  else if (historyMode === 'push' && location.hash !== nextRoute)
    history.pushState({ inkwell: true }, '', nextRoute);
  else if (location.hash !== nextRoute) history.replaceState({ inkwell: true }, '', nextRoute);
  state.route = nextRoute;
  InkwellAppearance.apply(preferences.theme);
  applyLayout();
  document.documentElement.dataset.mail = String(
    !['calendar', 'contacts', 'settings', 'tags', 'rules'].includes(view),
  );
  state.view = view;
  state.selected = null;
  state.query = '';
  state.searchScope = 'folder';
  $('#search-scope').value = 'all';
  $('#global-search').value = '';
  state.dateFrom = state.dateTo = '';
  state.dateSearch = false;
  $('#search-date-from').value = '';
  $('#search-date-to').value = '';
  $('#search-date-from').setCustomValidity('');
  $('#search-date-to').setCustomValidity('');
  paintDateSearch();
  state.offset = 0;
  if (!preferences.quick_filter_pinned) {
    state.filter = 'all';
    state.quick = {};
  }
  state.generation++;
  $('#sidebar').classList.remove('open');
  navigation();
  closeMessageMenu();
  const title =
    folders.find((f) => f[0] === view)?.[2] ||
    (view === 'remote'
      ? state.remoteFolder.name
      : view === 'collection'
        ? 'Grouped mail'
        : view === 'tags'
          ? 'Tag Manager'
          : view === 'rules'
            ? 'Rule Manager'
            : 'Settings');
  $('#breadcrumb').textContent =
    view === 'settings' && settingsPage ? 'Settings / ' + settingsPage.name : title;
  document.title =
    (view === 'settings' && settingsPage ? settingsPage.name + ' · Settings' : title) +
    ' — inkwell';
  $('#page-title').innerHTML =
    esc(
      {
        inbox: 'Your inbox',
        calendar: 'Room for what matters',
        contacts: 'Your people',
        settings: settingsPage?.name || 'Settings',
      }[view] || title,
    ) + '<span>.</span>';
  $('#page-description').textContent = {
    inbox: 'Good conversations start here.',
    calendar: 'Less juggling. More being present.',
    contacts: 'Keep your favorite connections close.',
    tags: 'Organize, recolor and manage local message tags.',
    rules: 'Build conditions and actions for your local email copies.',
    settings: settingsPage?.description || 'Choose a category to make inkwell yours.',
    starred: 'The conversations worth keeping close.',
    sent: 'Your words, out in the world.',
    drafts: 'Good thoughts, still in progress.',
    archive: 'Out of the way. Never out of reach.',
    trash: 'Local trash. Your server mailbox is unchanged.',
    collection: state.collection?.label || 'Associated messages across your workspace.',
    remote: state.remoteFolder
      ? `${state.remoteFolder.path} · ${state.remoteFolder.total_count} server items · available mail downloads in the background`
      : '',
  }[view];
  $('#page-actions').innerHTML =
    view === 'calendar'
      ? '<button class="primary" id="add-event">＋ New event</button>'
      : view === 'contacts'
        ? '<button class="primary" id="add-contact">＋ Add person</button>'
        : !['settings', 'tags', 'rules'].includes(view)
          ? '<button class="secondary" id="heading-compose">＋ Compose</button>'
          : '';
  if ($('#add-event')) on($('#add-event'), 'click', () => eventForm());
  if ($('#add-contact')) on($('#add-contact'), 'click', () => contactForm());
  if ($('#heading-compose')) on($('#heading-compose'), 'click', () => compose());
  $('#workspace').innerHTML = '<div class="skeleton">Getting your workspace ready…</div>';
  if (view === 'calendar') await renderCalendar();
  else if (view === 'contacts') await renderContacts();
  else if (view === 'settings') await renderSettings();
  else if (view === 'rules') {
    const generation = state.generation;
    const sourceMessage = state.ruleSeed;
    state.ruleSeed = null;
    await InkwellRules($('#workspace'), {
      sourceMessage,
      executionContext: state.ruleExecutionContext || {},
      foldersChanged: refreshCounts,
      api,
      esc,
      field,
      toast,
      isCurrent: () => state.generation === generation && state.view === 'rules',
      reload: async () => {
        await refreshCounts();
        if (state.generation === generation) await navigate('rules', { historyMode: 'replace' });
      },
    });
  } else if (view === 'tags') {
    const generation = state.generation;
    await InkwellTagManager($('#workspace'), {
      api,
      esc,
      toast,
      isCurrent: () => state.generation === generation && state.view === 'tags',
      catalogChanged: (tags) => {
        state.tagCatalog = tags;
      },
      openTag: async (id) => {
        await navigate('inbox');
        state.searchScope = 'all';
        $('#search-scope').value = 'all';
        state.filter = 'all';
        state.quick = { tag_id: id };
        await refreshQuickMail();
      },
    });
  } else await renderMail();
  if (view === 'remote' && state.route === nextRoute && !backgroundSync.active) {
    const generation = state.generation;
    api('/remote-folders/' + state.remoteFolder.id + '/sync', { method: 'POST' })
      .then(async () => {
        if (generation === state.generation && !$('#modal').open) await renderMail();
      })
      .catch((error) => toast(error.message));
  }
  if (state.route === nextRoute) {
    window.scrollTo(0, 0);
    $('#page-title').focus({ preventScroll: true });
  }
}
async function refreshQuickMail() {
  const focus = document.activeElement?.id;
  state.offset = 0;
  state.selected = null;
  state.generation++;
  await renderMail();
  if (focus) document.getElementById(focus)?.focus({ preventScroll: true });
}
async function renderMail({ listOnly = false } = {}) {
  const generation = state.generation;
  const ticket = (state.mailRequest = (state.mailRequest || 0) + 1);
  const catalog = await api('/tags');
  if (generation !== state.generation || ticket !== state.mailRequest) return;
  state.tagCatalog = catalog;
  if (state.quick?.tag_id && !catalog.some((t) => t.id === state.quick.tag_id))
    state.quick.tag_id = null;
  const filters = InkwellMailFilters.payload(state, preferences);
  const collection =
    state.view === 'collection'
      ? await api('/collections/query', {
          method: 'POST',
          body: {
            ...filters,
            kind: state.collection.kind,
            key: state.collection.key,
            q: state.query,
            offset: state.offset,
          },
        })
      : null;
  const response = collection
    ? collection
    : await api(
        `/messages?folder=${state.view}&q=${encodeURIComponent(state.query)}&offset=${state.offset}&scope=${state.searchScope}&summary=true&${new URLSearchParams(filters)}${state.remoteFolder ? '&remote_folder_id=' + state.remoteFolder.id : ''}`,
      );
  if (generation !== state.generation || ticket !== state.mailRequest) return;
  const messages = Array.isArray(response) ? response : response.messages;
  state.total = Array.isArray(response) ? null : response.total;
  state.messages = messages;
  if (listOnly && $('#message-list')) {
    renderMessageList();
    $('.mail-footer > span').textContent =
      `${messages.length}${state.total !== null ? ' of ' + state.total : ''} conversations${state.offset ? ' · page ' + (state.offset / 100 + 1) : ''} · ${collection ? 'grouped collection' : 'local mailbox'}`;
    $('#prev-page').disabled = state.offset === 0;
    $('#next-page').disabled =
      state.total !== null ? state.offset + messages.length >= state.total : messages.length < 100;
    return;
  }
  const persistentReader = ['classic', 'stacked'].includes(preferences.layout);
  $('#workspace').innerHTML =
    `<div class="mail-shell ${state.selected ? 'has-selection' : ''}"><div id="mail-activity" class="mail-activity" role="progressbar" aria-label="Background activity" aria-hidden="${pendingWork === 0}"><span></span></div>${collection ? `<section class="collection-banner" aria-label="Grouped collection"><div><strong>${esc(state.collection.label)}</strong><p>${collection.total} messages · all local folders and accounts, including Trash</p><div>${collection.folders.map((f) => `<span class="folder-badge">${esc(f.folder)} · ${f.total}</span>`).join('')}</div></div><button class="secondary" id="exit-collection">Back to inbox</button></section>` : ''}<div class="mail-toolbar"><div class="filter-tabs"><button class="filter-tab ${state.filter === 'all' ? 'active' : ''}" data-filter="all">All mail</button><button class="filter-tab ${state.filter === 'unread' ? 'active' : ''}" data-filter="unread">Unread</button></div></div><div class="mail-columns"><div class="message-list" id="message-list"></div><div id="message-resizer" class="pane-resizer" role="separator" aria-label="Resize message list" aria-orientation="vertical" tabindex="0"></div><article class="reader ${state.selected || persistentReader ? '' : 'hidden'}" id="reader"><div class="empty-state reader-placeholder"><div class="empty-icon">▤</div><h2>Select a conversation</h2><p>Your message will appear here. Remote content stays blocked.</p></div></article></div><div class="mail-footer"><span>${messages.length}${state.total !== null ? ' of ' + state.total : ''} conversations${state.offset ? ' · page ' + (state.offset / 100 + 1) : ''} · ${collection ? 'grouped collection' : 'local mailbox'}</span><div><button id="prev-page" ${state.offset === 0 ? 'disabled' : ''}>← Previous</button> <button id="next-page" ${(state.total !== null ? state.offset + messages.length >= state.total : messages.length < 100) ? 'disabled' : ''}>Next →</button></div></div></div><div class="quiet-note"><span>♧</span> A little less noise. A little more room to think.</div>`;
  if ($('#exit-collection')) on($('#exit-collection'), 'click', () => navigate('inbox'));
  renderMessageList();
  bindWorkspaceControls();
  if (state.selected) renderReader();
  InkwellMailFilters.mount({
    state,
    preferences,
    esc,
    saveWorkspace,
    refresh: refreshQuickMail,
    refreshGroups: async () => {
      state.offset = 0;
      state.generation++;
      try {
        await renderMail({ listOnly: true });
      } catch (error) {
        toast(error.message);
      }
    },
  });
  $$('[data-filter]').forEach((b) =>
    on(b, 'click', () => {
      state.filter = b.dataset.filter;
      state.offset = 0;
      state.generation++;
      $$('[data-filter]').forEach((button) => {
        const active = button.dataset.filter === state.filter;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      return renderMail({ listOnly: true });
    }),
  );
  on($('#prev-page'), 'click', async () => {
    state.offset = Math.max(0, state.offset - 100);
    state.selected = null;
    await renderMail();
  });
  on($('#next-page'), 'click', async () => {
    state.offset += 100;
    state.selected = null;
    await renderMail();
  });
}
function paintMessageAttachment(icon, present) {
  icon.dataset.attachmentState = present === true ? 'yes' : present === false ? 'no' : 'unknown';
  icon.title =
    present === true
      ? 'Attachments recorded for this message'
      : present === false
        ? 'No attachments reported for this message'
        : 'Attachment status not yet checked';
  icon.setAttribute('aria-label', icon.title);
}
window.addEventListener('InkwellAttachmentStatus', (event) => {
  const { id, present } = event.detail;
  const message = state.messages.find((m) => m.id === id);
  if (message) message.has_attachments = present;
  const icon = $(`[data-message="${Number(id)}"] .message-paperclip`);
  if (icon) paintMessageAttachment(icon, present);
});
function renderMessageList() {
  const messages = state.messages;
  const dateGroup = InkwellDateGroups();
  let previousGroup = null;
  const groupHeading = (message) => {
    if (!preferences.group_messages_by_date) return '';
    const label = dateGroup(message.date);
    if (label === previousGroup) return '';
    previousGroup = label;
    return `<div class="mail-date-heading" role="heading" aria-level="3">${esc(label)}</div>`;
  };
  $('#message-list').dataset.mailView = preferences.mail_view || 'cards';
  $('#message-list').innerHTML = messages.length
    ? messages
        .map(
          (m) =>
            `${groupHeading(m)}<div class="message-row ${m.unread ? 'unread' : ''} ${state.selected?.id === m.id ? 'selected' : ''}" data-message="${m.id}" role="button" tabindex="0" aria-label="${esc(m.subject)}">${m.unread ? '<span class="unread-dot"></span>' : ''}<div class="avatar">${esc(initials(m.sender))}</div><div class="message-content"><div class="message-top"><span class="sender-wrap"><span class="sender">${esc(displayName(['sent', 'drafts'].includes(state.view) ? m.recipient || 'New draft' : m.sender))}</span>${m.sender_key && m.sender_key.includes('@') && !['sent', 'drafts'].includes(state.view) ? `<button type="button" class="sender-bell" data-sender-key="${esc(m.sender_key)}" aria-pressed="${notifications.senders.includes(m.sender_key)}" aria-label="${notifications.senders.includes(m.sender_key) ? 'Stop notifying for this sender' : 'Notify for this sender'}" title="${notifications.senders.includes(m.sender_key) ? 'Stop notifying for this sender' : 'Notify for this sender'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9ZM10 21h4"/></svg></button>` : ''}</span><time class="message-date">${esc(timeLabel(m.date))}</time></div><div class="subject">${state.view === 'collection' || state.searchScope !== 'folder' ? `<span class="folder-badge">${esc(['inbox', 'remote'].includes(m.folder) ? state.remoteFolders.find((f) => f.id === (m.local_folder_override ? m.local_destination_id : m.remote_folder_id))?.path || m.folder : m.folder)}</span>` : ''}${esc(m.subject || '(No subject)')}</div><div class="message-pills">${m.unread ? '<span class="mail-pill unread-pill">Unread</span>' : ''}${tagPills(m)}</div><div class="preview">${esc(m.preview)}</div></div><button class="star-button ${m.starred ? 'on' : ''}" data-star="${m.id}" aria-label="${m.starred ? 'Unstar' : 'Star'} message" aria-pressed="${!!m.starred}">${m.starred ? '★' : '☆'}</button><button class="message-more" data-more="${m.id}" aria-label="More email actions" aria-haspopup="menu" aria-expanded="false">⋯</button></div>`,
        )
        .join('')
    : `<div class="empty-state"><div class="empty-icon">▤</div><h2>${state.query ? 'Nothing found.' : 'A little breathing room.'}</h2><p>${state.query ? 'Try a sender, subject, phrase or tag name. Use tag:Work to search only tags. Folder scope and quick filters still apply.' : state.accounts.length ? 'There are no messages here. Sync your account or start a new conversation.' : 'Connect your email to get started, or explore a sample workspace first.'}</p><div class="empty-actions">${!state.accounts.length && !state.query ? '<button class="primary" id="connect-empty">Connect email</button><button class="secondary" id="demo-empty">Explore demo</button>' : ''}</div></div>`;
  $$('[data-message]').forEach((row) => {
    on(row, 'click', (event) => {
      if (!selection.rowClick(row, event)) return openMessage(Number(row.dataset.message));
    });
    on(row, 'contextmenu', (e) => {
      e.preventDefault();
      showMessageMenu(Number(row.dataset.message), row, e);
    });
    on(row, 'keydown', (e) => {
      if (e.target === row && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
        e.preventDefault();
        showMessageMenu(Number(row.dataset.message), row);
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && e.target === row) {
        e.preventDefault();
        return openMessage(Number(row.dataset.message));
      }
    });
  });
  $$('[data-more]').forEach((b) =>
    on(b, 'click', (e) => {
      e.stopPropagation();
      showMessageMenu(Number(b.dataset.more), b);
    }),
  );
  $$('.sender-bell').forEach((button) =>
    on(button, 'click', async (event) => {
      event.stopPropagation();
      await notifications.toggleSender(button.dataset.senderKey);
    }),
  );
  $$('[data-star]').forEach((b) =>
    on(b, 'click', async (e) => {
      e.stopPropagation();
      const m = state.messages.find((m) => m.id === Number(b.dataset.star));
      await api(`/messages/${m.id}`, { method: 'PATCH', body: { starred: !m.starred } });
      m.starred = !m.starred;
      if (state.selected?.id === m.id) state.selected.starred = m.starred;
      if (state.view === 'starred' || state.quick?.starred || preferences.mail_sort === 'starred')
        await renderMail();
      else {
        renderMessageList();
        if (state.selected?.id === m.id) paintReaderStar($('#reader-star'), m.starred);
      }
    }),
  );
  if ($('#connect-empty')) on($('#connect-empty'), 'click', () => navigate('settings/mail'));
  if ($('#demo-empty')) on($('#demo-empty'), 'click', loadDemo);
  InkwellPaintTags($('#message-list'));
  for (const row of $$('[data-message]')) {
    const message = messages.find((m) => m.id === Number(row.dataset.message));
    row.classList.toggle('flagged-message', !!message.flagged);
    const flag = document.createElement('button');
    flag.type = 'button';
    flag.className = 'flag-button';
    flag.dataset.flag = message.id;
    flag.innerHTML =
      '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 21V3h14l-3 5 3 5H5"/></svg>';
    const paperclip = document.createElement('span');
    paperclip.className = 'message-paperclip';
    paperclip.setAttribute('role', 'img');
    paperclip.innerHTML =
      '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m21 11-9 9a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>';
    paintMessageAttachment(paperclip, message.has_attachments);
    row.querySelector('.message-more').before(flag, paperclip);
    paintFlagButton(flag, !!message.flagged);
    on(flag, 'click', async (event) => {
      event.stopPropagation();
      flag.disabled = true;
      try {
        await setMessageFlag(message.id, !message.flagged);
      } finally {
        flag.disabled = false;
      }
    });
  }
  InkwellHighlight($('#message-list'), state.query);
  selection.bindRows(messages);
  if (preferences.mail_view === 'table') {
    $('#message-list').insertAdjacentHTML(
      'afterbegin',
      '<div class="message-table-header"><span></span><button data-table-sort="sender">From</button><button data-table-sort="subject">Subject / tags</button><button data-table-sort="date">Date</button><span>★</span><span>⚑</span><span></span></div>',
    );
    $$('[data-table-sort]').forEach((button) =>
      on(button, 'click', () => {
        if (preferences.group_messages_by_date && button.dataset.tableSort !== 'date') {
          toast('Turn off Group by date to sort by another field.');
          return;
        }
        saveWorkspace({ mail_sort: button.dataset.tableSort });
        return refreshQuickMail();
      }),
    );
  }
}
function messageTags(message) {
  try {
    const tags = typeof message.tags === 'string' ? JSON.parse(message.tags) : message.tags;
    return Array.isArray(tags) ? tags.filter((tag) => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}
function tagPills(message) {
  return messageTags(message)
    .map(
      (tag) =>
        `<span class="mail-pill tag-pill" data-tag-color="${esc(state.tagCatalog?.find((t) => t.name === tag || t.key === tag.toLowerCase())?.color || '#486b54')}">${esc(tag)}</span>`,
    )
    .join('');
}
async function editTags(message) {
  const generation = state.generation;
  const existing = await api('/tags');
  if (generation !== state.generation) return;
  state.tagCatalog = existing;
  modal(
    'Email tags',
    `<form id="tags-form">${field('Tags (comma-separated)', 'tags', messageTags(message).join(', '), 'text', 'maxlength="406" list="known-tags"')}<datalist id="known-tags">${existing.map((tag) => `<option value="${esc(tag.name)}"></option>`).join('')}</datalist><div class="message-pills" role="group" aria-label="Existing tags">${existing
      .slice(0, 30)
      .map(
        (tag) =>
          `<button type="button" class="secondary" data-use-tag="${esc(tag.name)}">${esc(tag.name)}</button>`,
      )
      .join(
        '',
      )}</div><p class="notice">Up to 12 local tags, 32 characters each. Clear the field to remove tags. Server messages are unchanged.</p><button class="primary" type="submit">Save tags</button></form>`,
  );
  $$('#tags-form [data-use-tag]').forEach((button) =>
    on(button, 'click', () => {
      const input = $('#tags-form').elements.tags;
      const tags = input.value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
      if (!tags.some((tag) => tag.toLowerCase() === button.dataset.useTag.toLowerCase()))
        tags.push(button.dataset.useTag);
      input.value = tags.join(', ');
    }),
  );
  $('#tags-form').onsubmit = async (event) => {
    event.preventDefault();
    try {
      const value = $('#tags-form').elements.tags.value;
      const tags = value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
      await api('/messages/' + message.id, { method: 'PATCH', body: { tags } });
      $('#modal').close();
      if (generation !== state.generation) return;
      if (state.selected?.id === message.id) {
        const updated = await api('/messages/' + message.id);
        if (generation !== state.generation) return;
        state.selected = updated;
      }
      await renderMail();
      toast('Tags saved locally.');
    } catch (error) {
      toast(error.message);
    }
  };
}
async function messageAction(action, id) {
  const generation = state.generation;
  if (action === 'open') return openMessage(id);
  if (action === 'flag' || action === 'unflag') return setMessageFlag(id, action === 'flag');
  if (action === 'save-eml') return InkwellDownloadEmail(id);
  if (action === 'calendar-invite') return calendarImport.message(id);
  if (action === 'apply-rule') {
    const seed = await api('/rules/from-message/' + id);
    if (generation !== state.generation) return;
    state.ruleSeed = seed;
    return navigate('rules');
  }
  if (['star', 'unstar'].includes(action) && state.selected?.id === id)
    return setReaderStar(state.selected, action === 'star');
  if (action === 'appearance') {
    if (state.selected?.id === id) $('#reader-appearance')?.click();
    return;
  }
  const m = await api('/messages/' + id);
  if (generation !== state.generation) return;
  if (action === 'tags') return editTags(m);
  if (action === 'not-junk') {
    const result = await api('/messages/' + id + '/not-junk', { method: 'POST' });
    await refreshCounts();
    if (generation === state.generation) {
      state.selected = null;
      await renderMail();
    }
    toast(
      result.updated_messages +
        ' incoming copies from ' +
        result.sender +
        ' filed locally. Future imports use rules or Inbox.',
    );
    return;
  }
  const address = m.sender.match(/<([^>]+)>/)?.[1] || m.sender;
  const refresh = async () => {
    await refreshCounts();
    if (generation === state.generation) {
      state.selected = null;
      await renderMail();
    }
  };
  const patch = async (changes) => {
    await api('/messages/' + id, { method: 'PATCH', body: changes });
    await refresh();
  };
  if (action === 'reply')
    return compose({
      account_id: m.account_id,
      recipient: address,
      subject: /^re:/i.test(m.subject) ? m.subject : 'Re: ' + m.subject,
      body:
        '\n\n' +
        m.sender +
        ' wrote:\n' +
        m.body
          .split('\n')
          .map((line) => '> ' + line)
          .join('\n'),
    });
  if (action === 'forward')
    return compose({
      account_id: m.account_id,
      subject: 'Fwd: ' + m.subject,
      body:
        '\n\n---------- Forwarded message ----------\nFrom: ' +
        m.sender +
        '\nSubject: ' +
        m.subject +
        '\n\n' +
        m.body,
    });
  if (action === 'write') return compose({ account_id: m.account_id, recipient: address });
  if (action === 'contact') return contactForm({ name: displayName(m.sender), email: address });
  if (action === 'copy') {
    modal(
      'Copy sender address',
      `${field('Sender address', 'copy_address', address, 'text', 'readonly')}<p>Select and copy this address using Ctrl+C (Command+C on macOS).</p>`,
    );
    $('#modal-body input').select();
    return;
  }
  if (action === 'save') {
    const url = URL.createObjectURL(
      new Blob(
        [
          `From: ${m.sender}\nTo: ${m.recipient}\nDate: ${m.date}\nSubject: ${m.subject}\n\n${m.body}`,
        ],
        { type: 'text/plain;charset=utf-8' },
      ),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `inkwell-message-${id}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  if (action === 'move') {
    modal(
      'Move local copy',
      `<form id="move-local-form"><p>The Outlook server copy will not be moved or removed.</p><label class="field">Local destination<select name="folder"><option value="inbox">Inbox</option><option value="archive">Archive</option><option value="trash">Trash</option>${folders
        .filter((f) => f[0].startsWith('local-'))
        .map((f) => `<option value="${f[0]}">${esc(f[2])}</option>`)
        .join(
          '',
        )}${state.remoteFolders.map((f) => `<option value="remote:${f.id}">${esc(f.path)}</option>`).join('')}</select></label><button class="primary" type="submit">Move local copy</button></form>`,
    );
    on($('#move-local-form'), 'submit', async (event) => {
      event.preventDefault();
      const folder = event.currentTarget.elements.folder.value;
      await api('/messages/move', { method: 'POST', body: { ids: [id], folder } });
      $('#modal').close();
      await refresh();
    });
    return;
  }
  if (action === 'restore') {
    await api('/messages/restore', { method: 'POST', body: { ids: [id] } });
    await refresh();
    toast('Restored locally. Server mail is unchanged.');
    return;
  }
  if (action === 'delete') {
    if (!['trash', 'drafts'].includes(m.folder)) {
      toast(
        'Move the local copy to Trash before permanently deleting it. The server copy is preserved.',
      );
      return;
    }
    await api('/messages/' + id, { method: 'DELETE' });
    await refresh();
    return;
  }
  const changes = {
    read: { unread: false },
    unread: { unread: true },
    star: { starred: true },
    unstar: { starred: false },
    archive: { folder: 'archive' },
    trash: { folder: 'trash' },
  }[action];
  if (changes) {
    await patch(changes);
    toast('Local copy updated. Server mail is unchanged.');
  }
}
async function loadDemo() {
  await api('/demo', { method: 'POST' });
  await refreshCounts();
  await navigate('inbox');
  toast('Sample workspace ready. No real emails are sent in demo mode.');
}
async function openMessage(id) {
  if ($('#modal').open && !(await requestModalClose())) return;
  state.readerAppearance = 'theme';
  const generation = state.generation;
  const ticket = (state.messageRequest = (state.messageRequest || 0) + 1);
  const m = await api('/messages/' + id);
  if (generation !== state.generation || ticket !== state.messageRequest) return;
  if (m.folder === 'drafts') {
    compose(m);
    return;
  }
  state.selected = m;
  await api('/messages/' + id, { method: 'PATCH', body: { unread: false } });
  if (generation !== state.generation || ticket !== state.messageRequest) return;
  const local = state.messages.find((x) => x.id === id);
  if (local) local.unread = 0;
  m.unread = 0;
  if (state.filter === 'unread' || preferences.mail_sort === 'unread') {
    await refreshCounts();
    await renderMail();
    return;
  }
  $('.mail-shell').classList.add('has-selection');
  $('#reader').classList.remove('hidden');
  renderMessageList();
  renderReader();
  await refreshCounts();
}
function paintFlagButton(button, flagged) {
  button.setAttribute('aria-pressed', String(flagged));
  button.setAttribute('aria-label', flagged ? 'Unflag message' : 'Flag message');
  button.title = (flagged ? 'Unflag' : 'Flag') + ' message (local)';
}
async function setMessageFlag(id, flagged) {
  await api('/messages/' + id, { method: 'PATCH', body: { flagged } });
  state.mailRequest = (state.mailRequest || 0) + 1;
  const listed = state.messages.find((m) => m.id === id);
  if (listed) listed.flagged = flagged;
  if (state.selected?.id === id) {
    state.selected.flagged = flagged;
    const pill = $('#reader-flag-status');
    if (pill) pill.hidden = !flagged;
  }
  const row = $(`[data-message="${id}"]`);
  if (row) {
    row.classList.toggle('flagged-message', flagged);
    const button = row.querySelector('[data-flag]');
    if (button) paintFlagButton(button, flagged);
  }
}
async function setReaderStar(m, starred) {
  const button = $('#reader-star');
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try {
    await api('/messages/' + m.id, { method: 'PATCH', body: { starred } });
    m.starred = starred;
    const listed = state.messages.find((row) => row.id === m.id);
    if (listed) listed.starred = starred;
    if (state.selected === m) {
      renderMessageList();
      if (button) paintReaderStar(button, starred);
    }
    await refreshCounts();
    if (
      state.selected === m &&
      (state.view === 'starred' || state.quick?.starred || preferences.mail_sort === 'starred')
    )
      await renderMail();
  } finally {
    if (button) button.disabled = false;
  }
}
function paintReaderStar(button, starred) {
  if (!button) return;
  button.setAttribute('aria-pressed', String(starred));
  button.setAttribute('aria-label', starred ? 'Unstar message' : 'Star message');
  button.title = starred ? 'Unstar message' : 'Star message';
  button.querySelector('span').textContent = starred ? 'Unstar' : 'Star';
}
function renderReader() {
  const m = state.selected;
  if (!m) return;
  const view = state.readerAppearance || 'theme',
    dark = view === 'dark' || (view === 'theme' && preferences.theme.dark);
  const pane = $('#reader');
  const readerColors = [
    '--bg',
    '--surface',
    '--ink',
    '--muted',
    '--line',
    '--accent',
    '--accent-light',
    '--accent-text',
    '--danger',
  ];
  readerColors.forEach((name) => pane.style.removeProperty(name));
  pane.style.colorScheme = dark ? 'dark' : 'light';
  if (view !== 'theme' && dark !== preferences.theme.dark) {
    const colors = dark
      ? [
          '#171d25',
          '#202731',
          '#edf1f7',
          '#a5b2c3',
          '#394452',
          '#9bbacb',
          '#303e4b',
          '#17212b',
          '#ff9990',
        ]
      : [
          '#f6f6f1',
          '#ffffff',
          '#292e2b',
          '#697264',
          '#e7e8e1',
          '#486b54',
          '#eaf0e8',
          '#ffffff',
          '#ac4c45',
        ];
    readerColors.forEach((name, index) => pane.style.setProperty(name, colors[index]));
  }
  $('.reader-tools-dock')?.replaceChildren();
  $('#reader').innerHTML =
    `${InkwellReaderToolbar(m, dark, canMarkNotJunk(m))}<h2>${esc(m.subject || '(No subject)')}</h2><div class="reader-tags">${tagPills(m)}</div><div class="reader-meta"><div class="avatar">${esc(initials(m.sender))}</div><div><strong>${esc(m.sender)}</strong>${m.demo ? '<span class="badge">SAMPLE</span>' : ''}<small>To ${esc(m.recipient)}</small>${m.cc ? `<small>Cc ${esc(m.cc)}</small>` : ''}${m.bcc ? `<small>Bcc ${esc(m.bcc)}</small>` : ''}<small>${esc(new Date(m.date).toLocaleString())}</small></div></div><section id="message-attachments" aria-label="Email attachments"></section><div id="message-preview"></div>`;
  const flagStatus = document.createElement('span');
  flagStatus.id = 'reader-flag-status';
  flagStatus.className = 'mail-pill flagged-pill';
  flagStatus.textContent = 'Flagged';
  flagStatus.hidden = !m.flagged;
  $('#reader .reader-tags').prepend(flagStatus);
  InkwellPaintTags($('#reader'));
  on($('#edit-tags'), 'click', () => editTags(m));
  for (const [id, action] of [
    ['reader-move', 'move'],
    ['reader-not-junk', 'not-junk'],
    ['reader-save', 'save'],
    ['reader-contact', 'contact'],
    ['reader-copy', 'copy'],
  ])
    on($('#' + id), 'click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await messageAction(action, m.id);
      } finally {
        button.disabled = false;
      }
    });
  let dock = $('.reader-tools-dock');
  if (!dock) {
    dock = document.createElement('div');
    dock.className = 'reader-tools-dock';
    $('#selection-tools').append(dock);
  }
  dock.replaceChildren(pane.querySelector('.reader-actions'));
  for (const selector of ['h2', '.reader-meta', '.reader-tags'])
    InkwellHighlight(pane.querySelector(selector), state.query);
  on($('#reader-star'), 'click', () => setReaderStar(m, !m.starred));
  void InkwellAttachments($('#message-attachments'), m, {
    api,
    esc,
    toast,
    isCurrent: () => state.selected?.id === m.id,
  });
  void InkwellHtmlPreview($('#message-preview'), m, {
    linksControl: dock.querySelector('[data-email-links]'),
    api,
    navigate,
    esc,
    mode: preferences.preview_mode || 'html',
    appearance: view,
    query: state.query,
    isCurrent: () => state.selected?.id === m.id,
  });
  on($('#reader-appearance'), 'click', () => {
    state.readerAppearance = dark ? 'light' : 'dark';
    renderReader();
  });
  on($('#reader-menu'), 'click', (e) => showMessageMenu(m.id, e.currentTarget));
  on($('#reader-back'), 'click', async () => {
    state.selected = null;
    await renderMail();
  });
  const change = async (data) => {
    await api('/messages/' + m.id, { method: 'PATCH', body: data });
    state.selected = null;
    await refreshCounts();
    await renderMail();
  };
  on($('#archive-message'), 'click', async () => {
    if (m.folder === 'trash') {
      await api('/messages/restore', { method: 'POST', body: { ids: [m.id] } });
      state.selected = null;
      await refreshCounts();
      await renderMail();
    } else await change({ folder: m.folder === 'archive' ? 'inbox' : 'archive' });
  });
  on($('#unread-message'), 'click', () => change({ unread: true }));
  on($('#trash-message'), 'click', async () => {
    if (m.folder === 'trash') {
      await api('/messages/' + m.id, { method: 'DELETE' });
      state.selected = null;
      await refreshCounts();
      await renderMail();
    } else await change({ folder: 'trash' });
  });
  on($('#reply'), 'click', () =>
    compose({
      account_id: m.account_id,
      recipient: m.sender.match(/<([^>]+)>/)?.[1] || m.sender,
      subject: /^re:/i.test(m.subject) ? m.subject : 'Re: ' + m.subject,
      body:
        '\n\nOn ' +
        new Date(m.date).toLocaleString() +
        ', ' +
        m.sender +
        ' wrote:\n' +
        m.body
          .split('\n')
          .map((l) => '> ' + l)
          .join('\n'),
    }),
  );
  on($('#forward'), 'click', () =>
    compose({
      account_id: m.account_id,
      subject: 'Fwd: ' + m.subject,
      body:
        '\n\n---------- Forwarded message ----------\nFrom: ' +
        m.sender +
        '\nSubject: ' +
        m.subject +
        '\n\n' +
        m.body,
    }),
  );
}
let notJunkPolling = false;
const notifications = InkwellMailNotifications({
  api,
  toast,
  pinnedFolders: () => state.pinnedFolders,
});
const backgroundSync = InkwellBackgroundSync({
  onComplete: () => notifications.completed(),
  hasAccounts: () => state.routerReady && state.accounts.length > 0,
  api,
  toast,
  refresh: async () => {
    await refreshCounts();
    if (
      !state.composer &&
      !$('#modal').open &&
      !['settings', 'calendar', 'contacts', 'tags', 'rules'].includes(state.view)
    )
      await renderMail({ listOnly: true });
  },
});
async function pollNotJunkMail() {
  if (notJunkPolling || !state.routerReady || !state.accounts.length) return;
  notJunkPolling = true;
  try {
    if (!(await api('/not-junk-senders')).length) return;
    const generation = state.generation;
    await api('/sync', { method: 'POST' });
    await refreshCounts();
    if (
      generation === state.generation &&
      !$('#modal').open &&
      !state.selected &&
      !['settings', 'calendar', 'contacts', 'tags', 'rules'].includes(state.view)
    )
      await renderMail();
  } catch {
    /* Retry at the next interval; manual Sync exposes connection errors. */
  } finally {
    notJunkPolling = false;
    if (state.accounts.length && !backgroundSync.active) void backgroundSync.start();
  }
}
setInterval(pollNotJunkMail, 120000);
async function compose(data = {}) {
  if ($('#modal').open && !(await requestModalClose())) return;
  InkwellComposer(data, {
    state,
    modal,
    field,
    textarea,
    esc,
    api,
    toast,
    refreshCounts,
    renderMail,
  });
}
const calendarImport = InkwellCalendarImport({
  api,
  modal,
  esc,
  toast,
  refresh: async (event, { openCalendar = false } = {}) => {
    if (openCalendar && state.view !== 'calendar') await navigate('calendar');
    if (state.view === 'calendar') {
      if (event)
        state.month = new Date(
          event.all_day ? event.start.slice(0, 10) + 'T12:00:00' : event.start,
        );
      await renderCalendar();
    }
  },
});
if (window.inkwellCalendarFiles) {
  let waiting = true,
    taking = false,
    pendingFile = null,
    fileGeneration = 0;
  window.addEventListener('InkwellCalendarFilesReady', () => {
    waiting = true;
    fileGeneration++;
    if ($('#modal').open)
      toast('Calendar file queued. Finish or close the current form to review it.');
  });
  setInterval(async () => {
    if (!waiting || taking || !state.routerReady || $('#modal').open || calendarImport.busy) return;
    taking = true;
    const generation = fileGeneration;
    try {
      if (!pendingFile) pendingFile = await window.inkwellCalendarFiles.next();
      if (!pendingFile) {
        if (generation === fileGeneration) waiting = false;
        return;
      }
      if ($('#modal').open || calendarImport.busy) return;
      const file = pendingFile;
      pendingFile = null;
      if (file.error) toast(file.error);
      else calendarImport.native(file);
    } catch (error) {
      waiting = false;
      toast(error.message);
    } finally {
      taking = false;
    }
  }, 500);
}
const calendarEditor = InkwellCalendar({
  api,
  modal,
  state,
  esc,
  field,
  textarea,
  toast,
  importCalendar: calendarImport.file,
});
async function renderCalendar() {
  return calendarEditor.render();
}
function eventForm(event = {}) {
  if ($('#modal').open && $('#event-form')) {
    state.afterFormClose = () => eventForm(event);
    requestModalClose();
    return;
  }
  return calendarEditor.form(event);
}
window.inkwellEventForm = eventForm;
async function renderContacts() {
  const generation = state.generation;
  const contacts = await api('/contacts');
  if (generation !== state.generation) return;
  state.contacts = contacts;
  $('#workspace').innerHTML =
    `<div class="contacts-grid">${contacts.map((c) => `<article class="card contact-card"><div class="avatar">${esc(initials(c.name))}</div><h2>${esc(c.name)}</h2><p>${esc(c.company || 'A good connection')}</p><p>${esc(c.email)}</p><div class="contact-actions"><button class="secondary" data-write="${c.id}">↗ Write email</button><button class="secondary" data-contact="${c.id}">Edit</button></div></article>`).join('')}</div>${contacts.length ? '' : '<div class="empty-state"><div class="empty-icon">♙</div><h2>Better, together.</h2><p>Add your first contact to keep a good connection close.</p></div>'}`;
  $$('[data-contact]').forEach((b) =>
    on(b, 'click', () => contactForm(contacts.find((c) => c.id === Number(b.dataset.contact)))),
  );
  $$('[data-write]').forEach((b) =>
    on(b, 'click', () =>
      compose({ recipient: contacts.find((c) => c.id === Number(b.dataset.write)).email }),
    ),
  );
}
function contactForm(contact = {}) {
  modal(
    contact.id ? 'Edit person' : 'A new connection',
    `<form id="contact-form">${field('Full name', 'name', contact.name || '', 'text', 'required maxlength="200"')}${field('Email', 'email', contact.email || '', 'email', 'required maxlength="254"')}${field('Company', 'company', contact.company || '', 'text', 'maxlength="200"')}${textarea('Notes', 'notes', contact.notes || '', 'maxlength="10000"')}<div class="form-actions">${contact.id ? '<button type="button" class="secondary danger" id="delete-contact">Delete person</button>' : ''}<button class="primary" type="submit">Save person</button></div></form>`,
  );
  on($('#contact-form'), 'submit', async (e) => {
    e.preventDefault();
    await api('/contacts' + (contact.id ? '/' + contact.id : ''), {
      method: contact.id ? 'PUT' : 'POST',
      body: Object.fromEntries(new FormData(e.target)),
    });
    $('#modal').close();
    await renderContacts();
    toast('Connection saved.');
  });
  if ($('#delete-contact'))
    on($('#delete-contact'), 'click', async () => {
      await api('/contacts/' + contact.id, { method: 'DELETE' });
      $('#modal').close();
      await renderContacts();
    });
}
async function renderSettings() {
  const generation = state.generation;
  const page = state.settingsPage || 'overview';
  await InkwellSettings.mount($('#workspace'), page, {
    executionContext: state.ruleExecutionContext || {},
    foldersChanged: refreshCounts,
    api,
    esc,
    field,
    textarea,
    on,
    toast,
    preferences,
    accountForm,
    loadDemo,
    notifications,
    navigate: (section) => navigate(section === 'overview' ? 'settings' : 'settings/' + section),
    isCurrent: () =>
      state.generation === generation && state.view === 'settings' && state.settingsPage === page,
    accountsChanged: (accounts) => {
      state.accounts = accounts;
      navigation();
    },
    reload: async () => {
      await refreshCounts();
      if (state.generation === generation) await renderSettings();
    },
    savePreferences: async (value) => {
      preferences = await api(value.shortcuts ? '/preferences/workspace' : '/preferences', {
        method: value.shortcuts ? 'PATCH' : 'PUT',
        body: value.shortcuts ? { shortcuts: value.shortcuts } : { ...preferences, ...value },
      });
      window.inkwellShortcuts?.configure(preferences.shortcuts || InkwellHotkeys.defaults);
      if (state.generation === generation) {
        InkwellAppearance.apply(preferences.theme);
        applyLayout();
        navigation();
      }
    },
  });
}
function accountForm() {
  modal(
    'Bring your email along',
    `<form id="account-form"><label class="field">Quick setup<select id="provider"><option value="custom">Custom IMAP / SMTP</option><optgroup label="Microsoft — connects to inkwell"><option value="outlook">Outlook.com / Hotmail — Sign in with Microsoft</option><option value="microsoft365">Microsoft 365 — Sign in with Microsoft</option></optgroup><optgroup label="Microsoft webmail — opens your browser"><option value="outlookweb">Outlook.com / Hotmail — webmail only</option><option value="microsoft365web">Microsoft 365 — webmail only</option></optgroup><option value="gmail">Gmail (app password required)</option><option value="icloud">iCloud (app-specific password)</option><option value="fastmail">Fastmail (app password)</option></select></label><fieldset id="webmail-account-fields" hidden disabled><h3>Use Microsoft's official webmail</h3><p>Read and send your mail in Outlook, using your browser's Microsoft sign-in. No inkwell application ID is needed.</p><a id="open-webmail" class="secondary" href="https://outlook.live.com/mail/" target="_blank" rel="noopener noreferrer">Open Outlook.com webmail ↗</a><div class="notice">Opens your default browser (a new tab on mobile). This does not connect or sync an account to inkwell's native inbox. Your mail and browser sign-in stay with Microsoft; inkwell cannot read them or send mail on your behalf.</div></fieldset><fieldset id="password-account-fields"><div class="field-row">${field('Your name', 'name', '', 'text', 'required maxlength="100"')}${field('Email address', 'email', '', 'email', 'required maxlength="254"')}</div>${field('Username', 'username', '', 'text', 'required autocomplete="username"')}${field('App password', 'password', '', 'password', 'required autocomplete="new-password"')}<div class="field-row">${field('IMAP server', 'imap_host', '', 'text', 'required')}${field('IMAP TLS port', 'imap_port', '993', 'number', 'required min="1" max="65535"')}</div><div class="field-row">${field('SMTP server', 'smtp_host', '', 'text', 'required')}${field('SMTP port', 'smtp_port', '465', 'number', 'required min="1" max="65535"')}</div><label class="field">SMTP security<select name="smtp_security"><option value="tls">Implicit TLS (usually 465)</option><option value="starttls">Required STARTTLS (usually 587)</option></select></label></fieldset><fieldset id="microsoft-account-fields" hidden disabled><div id="microsoft-registration-status" class="notice" role="status">Checking Microsoft sign-in configuration…</div><div class="notice">Sign in securely on Microsoft's website. inkwell never asks for your Microsoft password. Mail is accessed through Microsoft Graph, not password-based IMAP.</div>${field('Microsoft application client ID', 'client_id', '', 'text', 'required placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"')}<details><summary>How to get an application client ID</summary><ol><li>Register an application in Microsoft Entra with work/school and personal Microsoft accounts supported.</li><li>Under Authentication, enable public client flows. No client secret is needed.</li><li>Add delegated Microsoft Graph permissions: User.Read, Mail.Read and Mail.Send. Administrator consent may be required at work.</li><li>Copy the Application (client) ID here. This is an app ID, not your email address or password.</li></ol></details><div id="microsoft-progress" role="status"></div></fieldset><div class="notice" id="provider-notice" aria-live="polite">Use an app-specific password for IMAP accounts. Save, then Sync to test the connection.</div><div class="form-actions"><button class="primary" type="submit">Save account</button></div></form>`,
  );
  const form = $('#account-form'),
    provider = $('#provider', form),
    submit = $('button[type="submit"]', form);
  let flowId = null,
    timer = null,
    alive = true;
  const cancelFlow = () => {
    clearTimeout(timer);
    if (flowId) {
      const id = flowId;
      flowId = null;
      api('/microsoft/' + id, { method: 'DELETE' }).catch(() => {});
    }
  };
  state.formCleanup = () => {
    alive = false;
    cancelFlow();
  };
  const isMicrosoft = () => ['outlook', 'microsoft365'].includes(provider.value);
  const isWebmail = () => ['outlookweb', 'microsoft365web'].includes(provider.value);
  let publisherConfigured = null;
  const updateRegistration = () => {
    const input = form.elements.client_id;
    input.disabled = publisherConfigured === true;
    input.required = publisherConfigured !== true;
    input.closest('label').classList.toggle('hidden', publisherConfigured === true);
    $('#microsoft-account-fields details', form).classList.toggle(
      'hidden',
      publisherConfigured === true,
    );
    if (isMicrosoft()) submit.disabled = publisherConfigured === null;
  };
  api('/microsoft/config')
    .then((config) => {
      if (!alive) return;
      publisherConfigured = config.configured === true;
      $('#microsoft-registration-status', form).textContent = publisherConfigured
        ? 'Ready. Click Sign in with Microsoft. inkwell handles the application ID automatically.'
        : 'Publisher setup incomplete: this build does not yet include an inkwell Microsoft registration. Advanced users can supply their own registration below. Your mailbox password cannot replace it.';
      updateRegistration();
    })
    .catch(() => {
      if (alive)
        $('#microsoft-registration-status', form).textContent =
          'Could not check Microsoft sign-in configuration. Close and reopen this form to retry.';
    });
  on(provider, 'change', () => {
    cancelFlow();
    const ms = isMicrosoft(),
      webmail = isWebmail();
    $('#password-account-fields').hidden = ms || webmail;
    $('#password-account-fields').disabled = ms || webmail;
    $('#webmail-account-fields').hidden = !webmail;
    $('#webmail-account-fields').disabled = !webmail;
    $('#open-webmail').href =
      provider.value === 'microsoft365web'
        ? 'https://outlook.office.com/mail/'
        : 'https://outlook.live.com/mail/';
    $('#open-webmail').textContent =
      provider.value === 'microsoft365web'
        ? 'Open Microsoft 365 webmail ↗'
        : 'Open Outlook.com webmail ↗';
    submit.classList.toggle('hidden', webmail);
    $('#provider-notice').classList.toggle('hidden', webmail);
    $('#microsoft-account-fields').hidden = !ms;
    $('#microsoft-account-fields').disabled = !ms;
    $('#microsoft-progress').textContent = '';
    submit.disabled = false;
    submit.textContent = ms ? 'Sign in with Microsoft' : 'Save account';
    updateRegistration();
    $('#provider-notice').textContent = ms
      ? 'Only enter a sign-in code that inkwell generated for you. Review the Microsoft consent screen before approving.'
      : 'Use an app-specific password for IMAP accounts. Save, then Sync to test the connection.';
    const presets = {
      gmail: ['imap.gmail.com', 'smtp.gmail.com', 465, 'tls'],
      icloud: ['imap.mail.me.com', 'smtp.mail.me.com', 587, 'starttls'],
      fastmail: ['imap.fastmail.com', 'smtp.fastmail.com', 465, 'tls'],
    };
    const p = presets[provider.value];
    if (p) {
      form.elements.imap_host.value = p[0];
      form.elements.imap_port.value = 993;
      form.elements.smtp_host.value = p[1];
      form.elements.smtp_port.value = p[2];
      form.elements.smtp_security.value = p[3];
    }
  });
  form.elements.email.addEventListener('change', () => {
    if (!form.elements.username.value) form.elements.username.value = form.elements.email.value;
  });
  const poll = async (id) => {
    if (!alive || flowId !== id) return;
    try {
      const result = await api('/microsoft/' + id + '/poll', { method: 'POST' });
      if (!alive || flowId !== id) return;
      if (result.status === 'complete') {
        cancelFlow();
        $('#modal').close();
        await refreshCounts();
        await navigate('inbox');
        const generation = state.generation;
        toast('Connected ' + result.email + '. Importing your inbox…');
        try {
          const results = await api('/sync', { method: 'POST' });
          const synced = results.find((item) => item.email === result.email);
          await refreshCounts();
          if (generation === state.generation && !$('#modal').open) await renderMail();
          toast(
            synced?.error ||
              synced?.folder_error ||
              `Connected ${result.email}. Imported ${synced?.added || 0} messages.`,
          );
        } catch (error) {
          toast('Connected, but the first import failed. Use Sync to retry. ' + error.message);
        }
      } else timer = setTimeout(() => poll(id), result.interval * 1000);
    } catch (error) {
      if (alive && flowId === id) {
        cancelFlow();
        $('#microsoft-progress').textContent = error.message;
        submit.disabled = false;
        submit.textContent = 'Try Microsoft sign-in again';
      }
    }
  };
  on(form, 'submit', async (e) => {
    e.preventDefault();
    if (isWebmail()) return;
    submit.disabled = true;
    try {
      if (isMicrosoft()) {
        cancelFlow();
        const flow = await api('/microsoft/begin', {
          method: 'POST',
          body: {
            account_type: provider.value === 'outlook' ? 'consumer' : 'organization',
            ...(publisherConfigured ? {} : { client_id: form.elements.client_id.value.trim() }),
          },
        });
        if (!alive || !isMicrosoft()) {
          await api('/microsoft/' + flow.id, { method: 'DELETE' });
          return;
        }
        flowId = flow.id;
        $('#microsoft-progress').innerHTML =
          `<div class="notice"><p>Open Microsoft sign-in and enter this code:</p><strong class="device-code">${esc(flow.user_code)}</strong><p><a href="${esc(flow.verification_uri)}" target="_blank" rel="noopener noreferrer" class="secondary">Open Microsoft sign-in ↗</a></p><p>Waiting for your approval. This code expires in ${Math.ceil(flow.expires_in / 60)} minutes. Leave this form open.</p></div>`;
        submit.textContent = 'Waiting for Microsoft…';
        timer = setTimeout(() => poll(flow.id), flow.interval * 1000);
      } else {
        const data = Object.fromEntries(new FormData(form));
        data.imap_port = Number(data.imap_port);
        data.smtp_port = Number(data.smtp_port);
        await api('/accounts', { method: 'POST', body: data });
        $('#modal').close();
        await renderSettings();
        toast('Account saved. Click Sync to import your inbox.');
      }
    } catch (error) {
      if (alive) {
        submit.disabled = false;
        submit.textContent = isMicrosoft() ? 'Sign in with Microsoft' : 'Save account';
        throw error;
      }
    }
  });
}
async function askAI(prompt) {
  const config = await api('/ai/config');
  if (!config.endpoint) {
    toast('Set up your AI provider in Settings first.');
    return;
  }
  let context = '';
  if ($('#ai-context').checked) {
    if (state.view === 'calendar')
      context = JSON.stringify(
        state.events.map(({ title, start, end, location, notes }) => ({
          title,
          start,
          end,
          location,
          notes,
        })),
      );
    else if (state.selected)
      context = `From: ${state.selected.sender}\nSubject: ${state.selected.subject}\n\n${state.selected.body}`;
  }
  if (context.length > 30000) {
    toast('Selected context exceeds 30,000 characters. Select a shorter email or disable context.');
    return;
  }
  $('#ai-submit').disabled = true;
  $('#ai-answer').textContent = 'A moment to think…';
  $('#use-ai').classList.add('hidden');
  $('#ai-provider').textContent = `Sending to ${config.endpoint} · ${config.model}`;
  try {
    const result = await api('/ai/chat', { method: 'POST', body: { prompt, context } });
    state.aiAnswer = result.answer;
    $('#ai-answer').textContent = result.answer;
    $('#use-ai').classList.remove('hidden');
  } catch (error) {
    $('#ai-answer').textContent = error.message;
  } finally {
    $('#ai-submit').disabled = false;
  }
}
on($('#settings'), 'click', () => navigate('settings'));
on($('#tag-manager-link'), 'click', () => navigate('tags'));
on($('#rule-manager-link'), 'click', () => navigate('rules'));
on($('#menu'), 'click', () => $('#sidebar').classList.toggle('open'));
on($('#close-modal'), 'click', requestModalClose);
on($('#modal'), 'click', async (event) => {
  if (!$('#modal').matches(':modal')) return;
  const box = $('#modal').getBoundingClientRect();
  if (
    event.clientX >= box.left &&
    event.clientX <= box.right &&
    event.clientY >= box.top &&
    event.clientY <= box.bottom
  )
    return;
  if (await requestModalClose())
    document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest('button,a,[data-message]')
      ?.click();
});
document.addEventListener(
  'click',
  (event) => {
    const dialog = $('#modal');
    if (
      !state.composer ||
      !dialog.open ||
      !dialog.classList.contains('inline-form') ||
      dialog.contains(event.target)
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = event.target.closest('button,a,[data-message]');
    requestModalClose().then((ok) => {
      if (ok && target?.isConnected) target.click();
    });
  },
  true,
);
$('#modal').addEventListener('cancel', (e) => {
  e.preventDefault();
  requestModalClose();
});
$$('.mobile-tabs [data-view], .app-rail [data-view]').forEach((b) =>
  on(b, 'click', () => {
    $('#ai-panel').classList.add('hidden');
    return navigate(b.dataset.view);
  }),
);
on($('#assistant-toggle'), 'click', async () => {
  $('#ai-panel').classList.toggle('hidden');
  const c = await api('/ai/config');
  $('#ai-provider').textContent = c.endpoint
    ? `Provider: ${c.endpoint} · ${c.model}. Only explicitly included context is shared.`
    : 'Configure a provider in Settings. Nothing is shared automatically.';
});
on($('#close-ai'), 'click', () => $('#ai-panel').classList.add('hidden'));
$$('[data-prompt]').forEach((b) =>
  on(b, 'click', () => {
    $('#ai-prompt').value = b.dataset.prompt;
    $('#ai-prompt').focus();
    toast('Review your context choice, then click Ask.');
  }),
);
on($('#ai-form'), 'submit', (e) => {
  e.preventDefault();
  return askAI($('#ai-prompt').value);
});
on($('#use-ai'), 'click', () => compose({ body: state.aiAnswer }));
window.InkwellSyncMail = async () => {
  if ($('#sync').disabled) return;
  if (!state.accounts.length) {
    toast('Connect an email account in Settings first.');
    return;
  }
  $('#sync').disabled = true;
  const generation = state.generation;
  const folder = state.view === 'remote' ? state.remoteFolder : null;
  toast(folder ? 'Securely syncing ' + folder.name + '…' : 'Securely syncing your inbox…');
  try {
    const results = folder
      ? [
          {
            email: folder.name,
            ...(await api('/remote-folders/' + folder.id + '/sync', {
              method: 'POST',
            })),
          },
        ]
      : await api('/sync', { method: 'POST' });
    toast(
      results
        .map((r) => `${r.email}: ${r.error || r.folder_error || `${r.added} new messages`}`)
        .join('\n'),
    );
    await refreshCounts();
    if (
      generation === state.generation &&
      !state.composer &&
      !$('#modal').open &&
      !['settings', 'calendar', 'contacts', 'tags', 'rules'].includes(state.view)
    )
      await renderMail({ listOnly: true });
  } catch (error) {
    toast(error.message);
  } finally {
    $('#sync').disabled = false;
    if (state.accounts.length) void backgroundSync.start(true);
  }
};
on($('#sync'), 'click', window.InkwellSyncMail);
window.InkwellFocusQuickFilter = () => {
  if ($('#modal').open) return;
  const quick = $('#quick-filter');
  if (quick) {
    quick.hidden = false;
    $('#quick-filter-toggle').setAttribute('aria-expanded', 'true');
    saveWorkspace({ quick_filter_visible: true });
  }
  $('#global-search').focus();
};
function deleteMailKey(e) {
  if (
    e.key !== 'Delete' ||
    e.repeat ||
    e.isComposing ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    e.shiftKey ||
    $('#modal').open ||
    $('#navigation').classList.contains('folder-dragging')
  )
    return false;
  const target = e.target instanceof Element ? e.target : document.activeElement;
  if (
    target.isContentEditable ||
    target.closest('[contenteditable]:not([contenteditable="false"])')
  )
    return false;
  if (
    target.closest('input,textarea,select') &&
    !target.matches('.select-message,#select-all-messages')
  )
    return false;
  if (
    target !== document.body &&
    target !== document.documentElement &&
    !target.closest('#workspace .mail-shell')
  )
    return false;
  if (['settings', 'calendar', 'contacts', 'tags', 'rules'].includes(state.view)) return false;
  e.preventDefault();
  void selection.deleteSelected();
  return true;
}
window.InkwellDeleteFromPreview = () => {
  if (!$('#modal').open && document.activeElement?.matches('#reader iframe.html-message'))
    void selection.deleteSelected();
};
let arrowSequence = 0;
function arrowNavigate(direction) {
  const target = document.activeElement;
  const visible = (selector) =>
    $$(selector).filter((e) => e.getClientRects().length && !e.disabled);
  const step = (items) => {
    if (!items.length) return false;
    let i = items.indexOf(target);
    i =
      i < 0
        ? 0
        : Math.max(
            0,
            Math.min(items.length - 1, i + (direction === 'up' || direction === 'left' ? -1 : 1)),
          );
    items[i].focus();
    return true;
  };
  if (target.closest('#sidebar')) {
    if (direction === 'up' || direction === 'down')
      return step(
        visible('#sidebar button,#navigation summary').filter(
          (e) => e.tagName !== 'SUMMARY' || !e.querySelector('button'),
        ),
      );
    const summary = target.closest('summary'),
      branch = summary?.parentElement;
    if (direction === 'right') {
      if (branch?.tagName === 'DETAILS') {
        if (!branch.open) branch.open = true;
        else
          branch
            .querySelector(':scope > .folder-children button,:scope > .server-folders button')
            ?.focus();
      } else $('#message-list [data-message]')?.focus();
    } else if (branch?.open) branch.open = false;
    else
      target
        .closest('.folder-children')
        ?.parentElement.querySelector(':scope > summary button')
        ?.focus();
    return true;
  }
  const mail = !['settings', 'calendar', 'contacts', 'tags', 'rules'].includes(state.view);
  if (mail) {
    if (direction === 'left') {
      if (target.closest('#reader')) {
        $(`[data-message="${state.selected?.id}"]`)?.focus();
        return true;
      }
      if (
        !$('#sidebar').classList.contains('open') &&
        getComputedStyle($('#menu')).display !== 'none'
      )
        $('#menu').click();
      $('#navigation .nav-item.active')?.focus();
      return true;
    }
    if (direction === 'right') {
      const reader = $('#reader');
      if (reader) {
        reader.tabIndex = -1;
        reader.focus();
      }
      return true;
    }
    if (target.closest('#reader')) return false;
    const current = Number(target.closest('[data-message]')?.dataset.message) || state.selected?.id;
    let index = state.messages.findIndex((m) => m.id === current);
    index =
      index < 0
        ? 0
        : Math.max(0, Math.min(state.messages.length - 1, index + (direction === 'up' ? -1 : 1)));
    const message = state.messages[index];
    if (!message) return false;
    const sequence = ++arrowSequence;
    return openMessage(message.id).then(() => {
      if (sequence === arrowSequence)
        $(`[data-message="${message.id}"]`)?.focus({ preventScroll: false });
    });
  }
  return step(visible('#workspace a[href],#workspace button'));
}
InkwellHotkeys.install({
  getPreferences: () => preferences,
  isModal: () => $('#modal').open,
  toast,
  actions: {
    sync: () => window.InkwellSyncMail(),
    compose: () => compose(),
    search: () => $('#global-search').focus(),
    quick_filter: () => window.InkwellFocusQuickFilter(),
    delete: (e, preview) =>
      preview
        ? window.InkwellDeleteFromPreview()
        : deleteMailKey({
            key: 'Delete',
            target: e.target,
            preventDefault: () => {},
            repeat: false,
          }),
    up: () => arrowNavigate('up'),
    down: () => arrowNavigate('down'),
    left: () => arrowNavigate('left'),
    right: () => arrowNavigate('right'),
    zoom_in: () => window.InkwellAdjustZoom(10),
    zoom_out: () => window.InkwellAdjustZoom(-10),
    zoom_reset: () => window.InkwellAdjustZoom(0),
  },
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#modal').open && !e.defaultPrevented) {
    $('#ai-panel').classList.add('hidden');
    $('#sidebar').classList.remove('open');
  }
});
$('#today').textContent = new Date().toLocaleDateString([], {
  weekday: 'short',
  month: 'long',
  day: 'numeric',
});
async function bootstrap() {
  try {
    let localFolders;
    [
      state.accounts,
      state.contacts,
      state.counts,
      preferences,
      state.remoteFolders,
      localFolders,
      state.pinnedFolders,
    ] = await Promise.all([
      api('/accounts'),
      api('/contacts'),
      api('/counts'),
      api('/preferences'),
      api('/remote-folders'),
      api('/local-folders'),
      api('/pinned-folders'),
    ]);
    installLocalFolders(localFolders);
    await notifications.initialize();
    await navigate(routeFromLocation(), { historyMode: 'replace' });
    state.routerReady = true;
    if (location.hash !== state.route) await navigate(routeFromLocation(), { historyMode: 'none' });
    if (state.accounts.length) {
      api('/sync', { method: 'POST' })
        .then(async (results) => {
          if (results.some((result) => result.added > 0)) await notifications.completed();
          void backgroundSync.start();
          const errors = results.filter((r) => r.error || r.folder_error);
          if (errors.length)
            toast(errors.map((r) => `${r.email}: ${r.error || r.folder_error}`).join('\n'));
          await refreshCounts();
          if (
            !['settings', 'calendar', 'contacts', 'tags', 'rules'].includes(state.view) &&
            !$('#modal').open &&
            !state.composer
          )
            await renderMail({ listOnly: true });
        })
        .catch((error) => {
          toast(error.message);
          void backgroundSync.poll();
        });
    }
  } catch (error) {
    modal(
      'Unlock your workspace',
      `<form id="unlock-form"><p>Enter the access key from your inkwell server to securely connect this device.</p>${field('Access key', 'key', '', 'password', 'required autocomplete="current-password"')}<p id="unlock-error" role="alert"></p><div class="form-actions"><button class="primary" type="submit">Connect to inkwell</button></div></form>`,
    );
    on($('#unlock-form'), 'submit', async (e) => {
      e.preventDefault();
      try {
        await api('/unlock', { method: 'POST', body: { key: new FormData(e.target).get('key') } });
        $('#modal').close();
        await bootstrap();
      } catch (err) {
        $('#unlock-error').textContent = err.message;
      }
    });
  }
}
let globalSearchTimer,
  searchSequence = 0;
function paintDateSearch() {
  for (const side of ['from', 'to']) {
    const input = $('#search-date-' + side);
    $('#clear-date-' + side).disabled = !input.value && !input.validity.badInput;
  }
}
async function searchMail() {
  const sequence = searchSequence;
  const from = $('#search-date-from').value,
    to = $('#search-date-to').value,
    dateSearch = !!state.dateSearch;
  $('#search-date-from').setCustomValidity('');
  $('#search-date-to').setCustomValidity('');
  if (!$('#search-date-from').checkValidity() || !$('#search-date-to').checkValidity()) {
    toast('Choose valid dates. The previous filter is unchanged.');
    return;
  }
  if (from && to && from > to) {
    $('#search-date-to').setCustomValidity('From date must not be after To date');
    toast('From date must not be after To date. The previous filter is unchanged.');
    return;
  }
  const typed = $('#global-search').value;
  const query = typed.trim().length >= 2 ? typed.trim() : '';
  const scope = $('#search-scope').value;
  if ($('#modal').open) {
    toast('Save or close the open form before searching.');
    return;
  }
  if (['settings', 'calendar', 'contacts', 'tags', 'rules'].includes(state.view))
    await navigate('inbox');
  if (sequence !== searchSequence) return;
  state.dateFrom = from;
  state.dateTo = to;
  state.dateSearch = dateSearch;
  $('#search-date-from').value = from;
  $('#search-date-to').value = to;
  paintDateSearch();
  state.searchScope = query || dateSearch || from || to ? scope : 'folder';
  $('#search-scope').value = scope;
  state.query = query;
  $('#global-search').value = typed;
  if (!query && !from && !to && !dateSearch) {
    state.filter = 'all';
    state.quick = {};
  }
  state.offset = 0;
  const generation = ++state.generation;
  await renderMail({ listOnly: true });
  if (generation !== state.generation || sequence !== searchSequence) return;
  const searchKind = /^tags?:/i.test(query) ? 'Tag' : 'Mail and tag';
  $('#page-description').textContent = query
    ? scope === 'all'
      ? `${searchKind} search across all cached folders, including Junk.`
      : `${searchKind} search: ${$('#search-scope').selectedOptions[0].textContent} (cached mail).`
    : state.searchScope === 'all'
      ? 'Showing all downloaded messages.'
      : 'Showing downloaded messages in this folder.';
  if (from || to)
    $('#page-description').textContent +=
      ` Dates: ${from || 'any start'} through ${to || 'any end'}, inclusive (your local time).`;
  else if (dateSearch && !query)
    $('#page-description').textContent =
      scope === 'all'
        ? 'Showing all downloaded messages.'
        : 'Showing downloaded messages in this scope.';
  if (state.view === 'collection')
    $('#page-description').textContent += ' Within the current collection.';
  if (
    query &&
    (state.filter === 'unread' ||
      state.quick?.starred ||
      state.quick?.tag_id ||
      (state.quick?.tag_state && state.quick.tag_state !== 'all'))
  )
    $('#page-description').textContent += ' Active quick filters also apply.';
}
for (const side of ['from', 'to']) {
  const apply = () => {
    paintDateSearch();
    state.dateSearch = true;
    clearTimeout(globalSearchTimer);
    searchSequence++;
    return searchMail();
  };
  on($('#search-date-' + side), 'change', apply);
  on($('#clear-date-' + side), 'click', () => {
    $('#search-date-' + side).value = '';
    return apply();
  });
}
on($('#global-search-form'), 'submit', async (event) => {
  event.preventDefault();
  clearTimeout(globalSearchTimer);
  searchSequence++;
  await searchMail();
});
on($('#global-search'), 'input', () => {
  clearTimeout(globalSearchTimer);
  const query = $('#global-search').value.trim();
  searchSequence++;
  if (query.length < 2 && !state.query) return;
  state.generation++;
  globalSearchTimer = setTimeout(
    () => searchMail().catch((error) => toast(error.message)),
    query.length ? 280 : 0,
  );
});
on($('#search-scope'), 'change', () => {
  clearTimeout(globalSearchTimer);
  searchSequence++;
  return searchMail();
});
const restoreRoute = () => {
  if (state.routerReady && location.hash !== state.route)
    navigate(routeFromLocation(), { historyMode: 'none' }).catch((error) => toast(error.message));
};
window.addEventListener('popstate', restoreRoute);
window.addEventListener('hashchange', restoreRoute);
const dateGroupClockKey = () =>
  new Date().toDateString() +
  '|' +
  new Date().getTimezoneOffset() +
  '|' +
  Intl.DateTimeFormat().resolvedOptions().timeZone;
let groupedCalendarDay = dateGroupClockKey();
function refreshDateGroupDay() {
  const day = dateGroupClockKey();
  if (day === groupedCalendarDay) return;
  groupedCalendarDay = day;
  const list = $('#message-list');
  if (preferences.group_messages_by_date && list) {
    const scroll = list.scrollTop;
    const focused = list.contains(document.activeElement)
      ? document.activeElement.closest('[data-message]')?.dataset.message
      : null;
    renderMessageList();
    list.scrollTop = scroll;
    if (focused) list.querySelector(`[data-message="${focused}"]`)?.focus({ preventScroll: true });
  }
}
setInterval(refreshDateGroupDay, 60000);
window.addEventListener('focus', refreshDateGroupDay);
document.addEventListener('visibilitychange', refreshDateGroupDay);
bootstrap();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
