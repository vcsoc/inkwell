'use strict';
const $ = (id) => document.getElementById(id);
const state = { view: 'mail', folder: 'inbox', folders: [], search: '', offset: 0, list: 0, reader: 0, navigation: 0 };
const pageSize = 50;
const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function errorMessage(error) {
  return typeof error === 'string' ? error : 'Could not load the local workspace.';
}
function clearReader() {
  state.reader++;
  $('reader').replaceChildren(element('p', 'Select a message to read it here.', 'placeholder'));
  document.body.classList.remove('message-open');
}
function folders() {
  const contents = document.createDocumentFragment();
  let group = null;
  for (const folder of state.folders) {
    if (folder.account && folder.account !== group) {
      group = folder.account;
      contents.append(element('div', group, 'section-label'));
    }
    const row = element('button', folder.label, 'folder');
    row.type = 'button';
    row.title = folder.label;
    row.setAttribute('aria-current', String(state.view === 'mail' && folder.key === state.folder));
    row.onclick = () => select('mail', folder.key);
    contents.append(row);
  }
  $('folders').replaceChildren(contents);
}
function select(view, folder) {
  state.view = view;
  if (folder) state.folder = folder;
  state.offset = 0;
  state.search = '';
  $('search').value = '';
  folders();
  for (const button of $('sections').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
  clearReader();
  document.body.dataset.view = view;
  void load();
}
async function refresh() {
  const ticket = ++state.navigation;
  const list = state.list;
  try {
    const result = await invoke('folders');
    if (ticket !== state.navigation) return;
    state.folders = result;
    if (!result.some((folder) => folder.key === state.folder)) {
      select(state.view, 'inbox');
      return;
    }
    folders();
    if (list === state.list) await load();
  } catch (error) {
    if (ticket === state.navigation && list === state.list) $('status').textContent = errorMessage(error);
  }
}
function mailRow(data) {
  const row = element('button', null, 'mail-row');
  row.type = 'button';
  if (data.unread) row.classList.add('unread');
  const sender = element('span', data.sender || '(Unknown sender)', 'sender');
  const date = element('time', formatDate(data.date), 'date');
  const subject = element('span', data.subject || '(No subject)', 'subject');
  if (data.starred) subject.append(element('span', ' [Starred]', 'date'));
  row.append(sender, date, subject);
  row.onclick = () => openMessage(data.id, row);
  return row;
}
function item(title, detail) {
  const row = element('article', null, 'record');
  row.append(element('strong', title), element('p', detail));
  return row;
}
function formatDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(+date) ? value : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}
async function load() {
  const ticket = ++state.list;
  const { view, folder, search, offset } = state;
  $('title').textContent = view === 'mail' ? state.folders.find((item) => item.key === folder)?.label || 'Inbox' : view === 'calendar' ? 'Calendar' : 'Contacts';
  $('search-form').hidden = view !== 'mail';
  $('status').textContent = 'Reading workspace...';
  $('rows').replaceChildren();
  $('pages').hidden = true;
  try {
    const result = await (view === 'mail' ? invoke('messages', { folder, search, offset }) : invoke(view === 'calendar' ? 'events' : 'contacts'));
    if (ticket !== state.list) return;
    const rows = view === 'mail' ? result.rows.map(mailRow) : view === 'calendar'
      ? result.map((row) => item(row.title, [formatDate(row.start), row.location].filter(Boolean).join(' | ')))
      : result.map((row) => item(row.name, [row.email, row.company].filter(Boolean).join(' | ')));
    $('rows').replaceChildren(...rows);
    $('status').textContent = rows.length ? '' : 'Nothing to show here.';
    if (view === 'mail') {
      $('pages').hidden = !(offset || result.more);
      $('previous').disabled = offset === 0;
      $('next').disabled = !result.more;
    }
  } catch (error) {
    if (ticket === state.list) $('status').textContent = errorMessage(error);
  }
}
async function openMessage(id, row) {
  const ticket = ++state.reader;
  for (const item of $('rows').querySelectorAll('[aria-current]')) item.removeAttribute('aria-current');
  row.setAttribute('aria-current', 'true');
  const back = element('button', 'Back to messages', 'back');
  back.type = 'button';
  back.onclick = () => { clearReader(); row.focus(); };
  document.body.classList.add('message-open');
  $('reader').replaceChildren(back, element('p', 'Reading message...', 'placeholder'));
  try {
    const message = await invoke('message', { id });
    if (ticket !== state.reader) return;
    $('reader').replaceChildren(back, element('h2', message.subject || '(No subject)'),
      element('p', `${message.sender} to ${message.recipient}`, 'metadata'),
      element('time', formatDate(message.date), 'metadata'), element('div', message.body, 'message-body'));
  } catch (error) {
    if (ticket === state.reader) $('reader').replaceChildren(back, element('p', errorMessage(error), 'placeholder'));
  }
}
for (const button of $('sections').querySelectorAll('button')) button.onclick = () => select(button.dataset.view);
$('refresh').onclick = refresh;
$('search-form').onsubmit = (event) => {
  event.preventDefault();
  state.search = $('search').value;
  state.offset = 0;
  clearReader();
  void load();
};
$('previous').onclick = () => { state.offset = Math.max(0, state.offset - pageSize); clearReader(); void load(); };
$('next').onclick = () => { state.offset += pageSize; clearReader(); void load(); };
void refresh();
