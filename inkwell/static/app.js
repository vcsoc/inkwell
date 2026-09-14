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
  refresh: async () => {
    state.selected = null;
    await refreshCounts();
    await renderMail();
  },
});
function closeMessageMenu() {
  messageMenu.close();
}
function showMessageMenu(id, trigger, event) {
  $('#message-menu [data-action=restore]').hidden =
    (state.messages.find((m) => m.id === id) || state.selected)?.folder !== 'trash';
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
function remoteTree() {
  return state.accounts
    .filter((a) => state.remoteFolders.some((f) => f.account_id === a.id))
    .map((account) => {
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
                const button = `<button class="nav-item remote-folder ${state.remoteFolder?.id === folder.id && state.view === 'remote' ? 'active' : ''}" data-remote-folder="${folder.id}" title="${esc(folder.path)} · ${folder.total_count} on server" aria-label="${esc(folder.path)}"><span aria-hidden="true">▱</span><span class="folder-name">${esc(folder.name)}</span><small>${folder.unread_count || ''}</small></button>`;
                const children = branch(folder.remote_id, depth + 1);
                return children
                  ? `<details data-folder-branch="${folder.id}" ${collapsedFolders.has(folder.id) ? '' : 'open'}><summary>${button}</summary><div class="folder-children">${children}</div></details>`
                  : button;
              })
              .join('');
      return `<section class="server-folders" aria-label="${esc(account.email)} server folders">${branch('')}</section>`;
    })
    .join('');
}
function navigation() {
  $('#navigation').innerHTML = folders
    .map(
      ([id, icon, name], i) =>
        `${i === 6 ? '<div class="nav-divider"></div>' : ''}<button class="nav-item ${state.view === id ? 'active' : ''}" data-view="${id}" aria-label="${esc(name)}"><span aria-hidden="true">${icon}</span>${esc(name)}${id === 'inbox' && state.counts.find((c) => c.folder === id)?.unread ? `<span class="nav-count">${state.counts.find((c) => c.folder === id).unread}</span>` : ''}</button>`,
    )
    .join('');
  $('#navigation [data-view="inbox"]')?.insertAdjacentHTML('afterend', remoteTree());
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
  $$('#navigation [data-view]').forEach((b) => on(b, 'click', () => navigate(b.dataset.view)));
  $$('.mobile-tabs button, .app-rail button').forEach((b) =>
    b.classList.toggle(
      'active',
      b.dataset.view === state.view ||
        (b.dataset.view === 'inbox' && !['calendar', 'contacts', 'settings'].includes(state.view)),
    ),
  );
  $('#account-status').textContent = state.accounts.length
    ? `${state.accounts.length} connected account${state.accounts.length === 1 ? '' : 's'}`
    : 'No account connected';
  selection.bindFolders();
}
function installLocalFolders(localFolders) {
  state.localFolders = localFolders;
  for (let i = folders.length - 1; i >= 0; i--)
    if (folders[i][0].startsWith('local-')) folders.splice(i, 1);
  folders.splice(6, 0, ...localFolders.map((folder) => ['local-' + folder.id, '▱', folder.name]));
}
async function refreshCounts() {
  const [counts, accounts, remoteFolders, localFolders] = await Promise.all([
    api('/counts'),
    api('/accounts'),
    api('/remote-folders'),
    api('/local-folders'),
  ]);
  Object.assign(state, { counts, accounts, remoteFolders, localFolders });
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
  const [requestedView, requestedPage] = route.split('/');
  const allowedViews = [...folders.map((folder) => folder[0]), 'settings', 'collection', 'remote'];
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
    !['calendar', 'contacts', 'settings'].includes(view),
  );
  state.view = view;
  state.selected = null;
  state.query = '';
  state.searchScope = 'folder';
  $('#search-scope').value = 'folder';
  $('#global-search').value = '';
  state.offset = 0;
  state.filter = 'all';
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
    settings: settingsPage?.description || 'Choose a category to make inkwell yours.',
    starred: 'The conversations worth keeping close.',
    sent: 'Your words, out in the world.',
    drafts: 'Good thoughts, still in progress.',
    archive: 'Out of the way. Never out of reach.',
    trash: 'Local trash. Your server mailbox is unchanged.',
    collection: state.collection?.label || 'Associated messages across your workspace.',
    remote: state.remoteFolder
      ? `${state.remoteFolder.path} · ${state.remoteFolder.total_count} messages on server · newest 200 cached on opening`
      : '',
  }[view];
  $('#page-actions').innerHTML =
    view === 'calendar'
      ? '<button class="primary" id="add-event">＋ New event</button>'
      : view === 'contacts'
        ? '<button class="primary" id="add-contact">＋ Add person</button>'
        : !['settings'].includes(view)
          ? '<button class="secondary" id="heading-compose">＋ Compose</button>'
          : '';
  if ($('#add-event')) on($('#add-event'), 'click', () => eventForm());
  if ($('#add-contact')) on($('#add-contact'), 'click', () => contactForm());
  if ($('#heading-compose')) on($('#heading-compose'), 'click', () => compose());
  $('#workspace').innerHTML = '<div class="skeleton">Getting your workspace ready…</div>';
  if (view === 'calendar') await renderCalendar();
  else if (view === 'contacts') await renderContacts();
  else if (view === 'settings') await renderSettings();
  else await renderMail();
  if (view === 'remote' && state.route === nextRoute) {
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
async function renderMail() {
  const generation = state.generation;
  const collection =
    state.view === 'collection'
      ? await api('/collections/query', {
          method: 'POST',
          body: {
            kind: state.collection.kind,
            key: state.collection.key,
            q: state.query,
            offset: state.offset,
          },
        })
      : null;
  const messages = collection
    ? collection.messages
    : await api(
        `/messages?folder=${state.view}&q=${encodeURIComponent(state.query)}&offset=${state.offset}&scope=${state.searchScope}${state.remoteFolder ? '&remote_folder_id=' + state.remoteFolder.id : ''}`,
      );
  if (generation !== state.generation) return;
  state.messages = messages;
  const persistentReader = ['classic', 'stacked'].includes(preferences.layout);
  $('#workspace').innerHTML =
    `<div class="mail-shell ${state.selected ? 'has-selection' : ''}"><div id="mail-activity" class="mail-activity" role="progressbar" aria-label="Background activity" aria-hidden="${pendingWork === 0}"><span></span></div>${collection ? `<section class="collection-banner" aria-label="Grouped collection"><div><strong>${esc(state.collection.label)}</strong><p>${collection.total} messages · all local folders and accounts, including Trash</p><div>${collection.folders.map((f) => `<span class="folder-badge">${esc(f.folder)} · ${f.total}</span>`).join('')}</div></div><button class="secondary" id="exit-collection">Back to inbox</button></section>` : ''}<div class="mail-toolbar"><div class="filter-tabs"><button class="filter-tab ${state.filter === 'all' ? 'active' : ''}" data-filter="all">All mail</button><button class="filter-tab ${state.filter === 'unread' ? 'active' : ''}" data-filter="unread">Unread</button></div></div><div class="mail-columns"><div class="message-list" id="message-list"></div><div id="message-resizer" class="pane-resizer" role="separator" aria-label="Resize message list" aria-orientation="vertical" tabindex="0"></div><article class="reader ${state.selected || persistentReader ? '' : 'hidden'}" id="reader"><div class="empty-state reader-placeholder"><div class="empty-icon">▤</div><h2>Select a conversation</h2><p>Your message will appear here. Remote content stays blocked.</p></div></article></div><div class="mail-footer"><span>${messages.length}${collection ? ' of ' + collection.total : ''} conversations${state.offset ? ' · page ' + (state.offset / 100 + 1) : ''} · ${collection ? 'grouped collection' : 'local mailbox'}</span><div><button id="prev-page" ${state.offset === 0 ? 'disabled' : ''}>← Previous</button> <button id="next-page" ${(collection ? state.offset + messages.length >= collection.total : messages.length < 100) ? 'disabled' : ''}>Next →</button></div></div></div><div class="quiet-note"><span>♧</span> A little less noise. A little more room to think.</div>`;
  if ($('#exit-collection')) on($('#exit-collection'), 'click', () => navigate('inbox'));
  renderMessageList();
  bindWorkspaceControls();
  if (state.selected) renderReader();
  $$('[data-filter]').forEach((b) =>
    on(b, 'click', () => {
      state.filter = b.dataset.filter;
      $$('[data-filter]').forEach((t) => t.classList.toggle('active', t === b));
      renderMessageList();
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
function renderMessageList() {
  const messages = state.messages.filter((m) => state.filter !== 'unread' || m.unread);
  $('#message-list').innerHTML = messages.length
    ? messages
        .map(
          (m) =>
            `<div class="message-row ${m.unread ? 'unread' : ''} ${state.selected?.id === m.id ? 'selected' : ''}" data-message="${m.id}" role="button" tabindex="0" aria-label="${esc(m.subject)}">${m.unread ? '<span class="unread-dot"></span>' : ''}<div class="avatar">${esc(initials(m.sender))}</div><div class="message-content"><div class="message-top"><span class="sender">${esc(displayName(['sent', 'drafts'].includes(state.view) ? m.recipient || 'New draft' : m.sender))}</span><time class="message-date">${esc(timeLabel(m.date))}</time></div><div class="subject">${state.view === 'collection' || state.searchScope !== 'folder' ? `<span class="folder-badge">${esc(['inbox', 'remote'].includes(m.folder) ? state.remoteFolders.find((f) => f.id === (m.local_folder_override ? m.local_destination_id : m.remote_folder_id))?.path || m.folder : m.folder)}</span>` : ''}${esc(m.subject || '(No subject)')}</div><div class="message-pills">${m.unread ? '<span class="mail-pill unread-pill">Unread</span>' : ''}${tagPills(m)}</div><div class="preview">${esc(m.preview)}</div></div><button class="star-button ${m.starred ? 'on' : ''}" data-star="${m.id}" aria-label="${m.starred ? 'Unstar' : 'Star'} message" aria-pressed="${!!m.starred}">${m.starred ? '★' : '☆'}</button><button class="message-more" data-more="${m.id}" aria-label="More email actions" aria-haspopup="menu" aria-expanded="false">⋯</button></div>`,
        )
        .join('')
    : `<div class="empty-state"><div class="empty-icon">▤</div><h2>${state.query ? 'Nothing found.' : 'A little breathing room.'}</h2><p>${state.query ? 'Try another name, subject, or phrase.' : state.accounts.length ? 'There are no messages here. Sync your account or start a new conversation.' : 'Connect your email to get started, or explore a sample workspace first.'}</p><div class="empty-actions">${!state.accounts.length && !state.query ? '<button class="primary" id="connect-empty">Connect email</button><button class="secondary" id="demo-empty">Explore demo</button>' : ''}</div></div>`;
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
  $$('[data-star]').forEach((b) =>
    on(b, 'click', async (e) => {
      e.stopPropagation();
      const m = state.messages.find((m) => m.id === Number(b.dataset.star));
      await api(`/messages/${m.id}`, { method: 'PATCH', body: { starred: !m.starred } });
      m.starred = !m.starred;
      if (state.selected?.id === m.id) state.selected.starred = m.starred;
      if (state.view === 'starred') await renderMail();
      else renderMessageList();
    }),
  );
  if ($('#connect-empty')) on($('#connect-empty'), 'click', () => navigate('settings/mail'));
  if ($('#demo-empty')) on($('#demo-empty'), 'click', loadDemo);
  selection.bindRows(messages);
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
    .map((tag) => `<span class="mail-pill tag-pill">${esc(tag)}</span>`)
    .join('');
}
async function editTags(message) {
  const generation = state.generation;
  const existing = await api('/tags');
  if (generation !== state.generation) return;
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
  const m = await api('/messages/' + id);
  if (generation !== state.generation) return;
  if (action === 'tags') return editTags(m);
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
  $('.mail-shell').classList.add('has-selection');
  $('#reader').classList.remove('hidden');
  renderMessageList();
  renderReader();
  await refreshCounts();
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
  $('#reader').innerHTML =
    `<div class="reader-actions"><button class="icon-button" id="reader-menu" aria-label="More email actions" aria-haspopup="menu" aria-expanded="false">⋯</button><button class="icon-button" id="reader-back" aria-label="Back to messages">←</button><button class="secondary" id="archive-message">${m.folder === 'trash' ? 'Restore' : m.folder === 'archive' ? 'Move to inbox' : 'Archive'}</button><button class="secondary" id="unread-message">Mark unread</button><button class="secondary" id="reader-appearance" aria-label="Switch reader to ${dark ? 'light' : 'dark'} view">${dark ? '☀ Light view' : '☾ Dark view'}</button><button class="icon-button danger" id="trash-message" aria-label="${m.folder === 'trash' ? 'Permanently delete' : 'Move to trash'}" title="${m.folder === 'trash' ? 'Permanently delete local copy' : 'Move to Trash'}"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button></div><h2>${esc(m.subject || '(No subject)')}</h2><div class="reader-tags">${tagPills(m)}<button class="secondary" id="edit-tags">Tags…</button></div><div class="reader-meta"><div class="avatar">${esc(initials(m.sender))}</div><div><strong>${esc(m.sender)}</strong>${m.demo ? '<span class="badge">SAMPLE</span>' : ''}<small>To ${esc(m.recipient)}</small><small>${esc(new Date(m.date).toLocaleString())}</small></div></div><div id="message-preview"></div><div class="reader-reply"><button class="primary" id="reply" aria-label="Reply">↩ Reply</button><button class="secondary" id="forward">Forward →</button></div>`;
  on($('#edit-tags'), 'click', () => editTags(m));
  void InkwellHtmlPreview($('#message-preview'), m, {
    api,
    navigate,
    esc,
    mode: preferences.preview_mode || 'html',
    appearance: view,
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
const calendarEditor = InkwellCalendar({ api, modal, state, esc, field, textarea, toast });
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
    api,
    esc,
    field,
    textarea,
    on,
    toast,
    preferences,
    accountForm,
    loadDemo,
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
      preferences = await api('/preferences', {
        method: 'PUT',
        body: { ...preferences, ...value },
      });
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
on($('#compose'), 'click', () => compose());
on($('#settings'), 'click', () => navigate('settings'));
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
on($('#sync'), 'click', async () => {
  if (!state.accounts.length) {
    toast('Connect an email account in Settings first.');
    return;
  }
  $('#sync').disabled = true;
  toast('Securely syncing your inbox…');
  try {
    const results =
      state.view === 'remote' && state.remoteFolder
        ? [
            {
              email: state.remoteFolder.name,
              ...(await api('/remote-folders/' + state.remoteFolder.id + '/sync', {
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
    if (!['settings', 'calendar', 'contacts'].includes(state.view)) await renderMail();
  } finally {
    $('#sync').disabled = false;
  }
});
document.addEventListener('keydown', (e) => {
  if (
    /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    $('#modal').open
  )
    return;
  if (e.key === 'c') {
    e.preventDefault();
    compose();
  }
  if (e.key === '/') {
    e.preventDefault();
    $('#global-search')?.focus();
  }
  if (e.key === 'Escape') {
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
    [state.accounts, state.contacts, state.counts, preferences] = await Promise.all([
      api('/accounts'),
      api('/contacts'),
      api('/counts'),
      api('/preferences'),
    ]);
    state.remoteFolders = await api('/remote-folders');
    installLocalFolders(await api('/local-folders'));
    await navigate(routeFromLocation(), { historyMode: 'replace' });
    state.routerReady = true;
    if (location.hash !== state.route) await navigate(routeFromLocation(), { historyMode: 'none' });
    if (state.accounts.length) {
      api('/sync', { method: 'POST' })
        .then(async (results) => {
          const errors = results.filter((r) => r.error || r.folder_error);
          if (errors.length)
            toast(errors.map((r) => `${r.email}: ${r.error || r.folder_error}`).join('\n'));
          await refreshCounts();
          if (!['settings', 'calendar', 'contacts'].includes(state.view) && !$('#modal').open)
            await renderMail();
        })
        .catch((error) => toast(error.message));
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
async function searchMail() {
  const sequence = searchSequence;
  const typed = $('#global-search').value;
  const query = typed.trim().length >= 2 ? typed.trim() : '';
  const scope = $('#search-scope').value;
  if ($('#modal').open) {
    toast('Save or close the open form before searching.');
    return;
  }
  if (['settings', 'calendar', 'contacts'].includes(state.view)) await navigate('inbox');
  if (sequence !== searchSequence) return;
  state.searchScope = scope;
  $('#search-scope').value = scope;
  state.query = query;
  $('#global-search').value = typed;
  if (!query) state.filter = 'all';
  state.offset = 0;
  state.selected = null;
  state.generation++;
  await renderMail();
  $('#page-description').textContent = query
    ? `Searching downloaded mail: ${$('#search-scope').selectedOptions[0].textContent}${scope === 'all' ? ' (including local Trash)' : ''}.`
    : 'Showing downloaded messages in the selected scope.';
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
bootstrap();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
