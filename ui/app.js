'use strict';
const $ = (id) => document.getElementById(id);
const state = { view: 'mail', folder: 'inbox', folders: [], search: '', scope: 'folder', offset: 0, list: 0, reader: 0, navigation: 0 };
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
function select(view, folder, options = {}) {
  if (state.view === 'theme' && view !== 'theme') window.InkwellTheme.revert();
  state.view = view;
  $('mail-filters').hidden = !['mail', 'search'].includes(view);
  if (folder) state.folder = folder;
  state.offset = 0;
  state.search = options.query || '';
  state.scope = options.scope || 'folder';
  state.date = options.date;
  state.person = options.person;
  $('search').value = state.search;
  $('search-scope').value = options.scope || 'workspace';
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
  const { view, folder, search, offset, scope } = state;
  if (view === 'theme') {
    $('title').textContent = 'Theme Studio';
    $('pages').hidden = true;
    $('status').textContent = '';
    $('rows').replaceChildren();
    window.InkwellTheme.mount($('rows'));
    return;
  }
  if (view === 'calendar') {
    $('title').textContent = 'Calendar';
    $('pages').hidden = true;
    $('status').textContent = '';
    $('rows').replaceChildren();
    window.InkwellCalendar.mount($('rows'), state.date);
    return;
  }
  const isMail = ['mail', 'search'].includes(view);
  $('title').textContent = view === 'search' ? 'Workspace search' : view === 'mail' ? state.folders.find((item) => item.key === folder)?.label || 'Inbox' : 'People';
  $('status').textContent = 'Reading workspace...';
  $('rows').replaceChildren();
  $('pages').hidden = true;
  try {
    const controls = $('mail-filters').elements;
    const filters = { unread: controls.unread.checked, starred: controls.starred.checked, from: controls.from.value || null, to: controls.to.value || null, oldest: controls.order.value === 'oldest' };
    const [result, hits] = await Promise.all([
      isMail ? invoke('messages', { folder, search, offset, scope: view === 'search' ? 'all' : scope, filters }) : invoke('contacts'),
      view === 'search' && !offset ? invoke('workspace_results', { query: search }) : null,
    ]);
    if (ticket !== state.list) return;
    if (view === 'contacts') {
      renderPeople(result);
      if (state.person) {
        const person = result.find((item) => String(item.id) === state.person);
        state.person = null;
        if (person) openContact(person);
      }
      return;
    }
    const rows = result.rows.map(mailRow);
    const groups = [];
    if (hits) {
      const addGroup = (label, items, activate) => {
        if (!items.length) return;
        const group = element('section', null, 'search-group');
        group.append(element('h2', label));
        for (const hit of items) {
          const row = action('', () => activate(hit)); row.className = 'search-hit';
          row.append(element('strong', hit.title), element('span', hit.detail, 'metadata')); group.append(row);
        }
        groups.push(group);
      };
      addGroup('People', hits.contacts, (hit) => select('contacts', null, { person: hit.target }));
      addGroup('Calendar', hits.events, (hit) => select('calendar', null, { date: hit.target }));
      addGroup('Folders', hits.folders, (hit) => select('mail', hit.target));
    }
    if (view === 'search' && rows.length) groups.push(element('h2', 'Mail'));
    $('rows').replaceChildren(...groups, ...rows);
    $('status').textContent = rows.length || groups.length ? '' : 'Nothing to show here.';
    if (isMail) {
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
    const draftFolder = (message.folder || state.folder) === 'drafts';
    if (!draftFolder) {
      const controls = element('div', null, 'theme-actions');
      const quoted = (message.body || '').split('\n').map((line) => `> ${line}`).join('\n');
      controls.append(action('Reply as draft', () => window.InkwellDrafts.show(null, {
        recipient: message.sender, subject: /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`,
        body: `\n\n${message.sender} wrote:\n${quoted}`,
      })), action('Forward as draft', () => window.InkwellDrafts.show(null, {
        subject: /^(?:fw|fwd):/i.test(message.subject) ? message.subject : `Fwd: ${message.subject}`,
        body: `\n\nForwarded message\nFrom: ${message.sender}\nTo: ${message.recipient}\nSubject: ${message.subject}\n\n${message.body}`,
      })));
      controls.append(action('Create event from email', () => window.InkwellCalendar.openFromMail({
        title: (message.subject || 'Email follow-up').slice(0, 200),
        notes: [`From: ${message.sender}`, `Received: ${formatDate(message.date)}`, '', message.body].join('\n').slice(0, 10000),
      })));
      $('reader').prepend(controls);
    }
    if (draftFolder) {
      const draft = await invoke('plain_draft', { id });
      if (ticket !== state.reader) return;
      if (draft) $('reader').prepend(action('Edit draft', () => window.InkwellDrafts.show(draft)));
      else $('reader').prepend(element('p', 'Open this draft in the legacy app to edit it.', 'metadata'));
    }
  } catch (error) {
    if (ticket === state.reader) $('reader').replaceChildren(back, element('p', errorMessage(error), 'placeholder'));
  }
}
function action(label, activate) {
  const button = element('button', label);
  button.type = 'button';
  button.onclick = activate;
  return button;
}
const contactDialog = $('contact-dialog');
const contactForm = $('contact-form');
let contact = null;
let contactBusy = false;
function openContact(row = null) {
  contact = row;
  $('contact-title').textContent = row ? 'Edit contact' : 'New contact';
  $('contact-status').textContent = '';
  for (const field of ['name', 'email', 'company', 'notes']) contactForm.elements[field].value = row?.[field] || '';
  contactDialog.showModal();
}
const peopleAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#';
const peopleSort = new Intl.Collator(undefined, { sensitivity: 'base' });
function renderPeople(contacts) {
  const tools = element('div', null, 'theme-actions people-tools');
  const filter = element('input'); filter.type = 'search'; filter.placeholder = 'Find a person';
  filter.setAttribute('aria-label', 'Find a person');
  tools.append(action('New contact', () => openContact()), filter);
  const directory = element('div', null, 'people-directory');
  const index = element('nav', null, 'people-alphabet'); index.setAttribute('aria-label', 'Contact alphabet');
  const groups = element('div', null, 'people-groups');
  directory.append(index, groups);
  const sorted = [...contacts].sort((a, b) => peopleSort.compare(a.name, b.name));
  function render() {
    index.replaceChildren(); groups.replaceChildren();
    const buckets = new Map();
    const query = filter.value.trim().toLocaleLowerCase();
    for (const person of sorted) {
      if (query && ![person.name, person.email, person.company, person.notes].some((value) => value?.toLocaleLowerCase().includes(query))) continue;
      const letter = person.name.trim().normalize('NFD').replace(/\p{M}/gu, '').charAt(0).toUpperCase();
      const key = /^[A-Z]$/.test(letter) ? letter : '#';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(person);
    }
    for (const letter of peopleAlphabet) {
      const people = buckets.get(letter);
      const jump = action(letter, () => {
        header.focus({ preventScroll: true });
        header.scrollIntoView({ block: 'start' });
      });
      jump.setAttribute('aria-label', `Jump to contacts: ${letter === '#' ? 'other names' : letter}`);
      jump.disabled = !people; index.append(jump);
      const header = element('h2', letter); header.tabIndex = -1;
      if (!people) continue;
      const section = element('section'); const cards = element('div', null, 'people-cards');
      for (const person of people) cards.append(contactRow(person));
      section.append(header, cards); groups.append(section);
    }
    if (!buckets.size) groups.append(element('p', query ? 'No matching contacts.' : 'No contacts yet.', 'metadata'));
    $('status').textContent = '';
  }
  $('rows').replaceChildren(tools, directory);
  filter.oninput = render;
  render();
}
function contactRow(row) {
  const result = element('article', null, 'people-card');
  const header = element('div', null, 'people-card-header');
  const initials = row.name.trim().split(/\s+/).slice(0, 2).map((part) => [...part][0]).join('').toLocaleUpperCase();
  const avatar = action('', () => picker.click()); avatar.className = 'people-avatar';
  avatar.setAttribute('aria-label', `Change photo for ${row.name}`); avatar.title = 'Change photo or drop an image here';
  function paint() {
    avatar.replaceChildren();
    if (/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/=]+$/.test(row.avatar || '')) {
      const image = element('img'); image.src = row.avatar; image.alt = '';
      image.onerror = () => { avatar.textContent = initials; }; avatar.append(image);
    } else avatar.textContent = initials;
    removePhoto.hidden = !row.avatar;
  }
  const picker = element('input'); picker.type = 'file'; picker.accept = 'image/jpeg,image/png,image/webp'; picker.hidden = true;
  let savingPhoto = false;
  async function savePhoto(file) {
    if (savingPhoto) return;
    savingPhoto = true;
    try {
      let data = null;
      if (file) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10_000_000) throw Error('Choose a JPEG, PNG or WebP image under 10 MB.');
        const bitmap = await createImageBitmap(file);
        try {
          const canvas = element('canvas'); canvas.width = canvas.height = 256;
          const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 256, 256);
          const size = Math.min(bitmap.width, bitmap.height);
          ctx.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 256, 256);
          data = canvas.toDataURL('image/jpeg', .85);
        } finally { bitmap.close(); }
      }
      await invoke('set_contact_avatar', { id: row.id, email: row.email, avatar: data }); row.avatar = data; paint();
    } catch (err) { if (result.isConnected) $('status').textContent = err?.message || errorMessage(err); }
    finally { savingPhoto = false; picker.value = ''; }
  }
  picker.onchange = () => { if (picker.files[0]) void savePhoto(picker.files[0]); };
  result.ondragover = (event) => { if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); result.classList.add('photo-drop'); } };
  result.ondragleave = (event) => { if (!result.contains(event.relatedTarget)) result.classList.remove('photo-drop'); };
  result.ondrop = (event) => { event.preventDefault(); result.classList.remove('photo-drop'); if (event.dataTransfer.files[0]) void savePhoto(event.dataTransfer.files[0]); };
  const identity = element('div');
  identity.append(element('h3', row.name), element('p', row.email, 'metadata'));
  if (row.company) identity.append(element('p', row.company, 'people-company'));
  header.append(avatar, identity); result.append(header);
  if (row.notes) result.append(element('p', row.notes, 'contact-notes metadata'));
  const controls = element('div', null, 'theme-actions');
  controls.classList.add('people-card-actions');
  const icon = (label, path, callback) => {
    const button = action('', callback); button.title = label; button.setAttribute('aria-label', label);
    const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg'); const stroke = document.createElementNS(ns, 'path');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); stroke.setAttribute('d', path); svg.append(stroke); button.append(svg);
    return button;
  };
  const removePhoto = icon('Remove photo', 'M6 6l12 12M18 6L6 18', () => void savePhoto(null));
  controls.append(icon('Compose to contact', 'M3 5h18v14H3zM3 6l9 7 9-7', () => window.InkwellDrafts.show(null, { recipient: row.email })), icon('Edit', 'M4 20l4-1 12-12-3-3L5 16zM14 7l3 3', () => openContact(row)), removePhoto, icon('Delete', 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', async () => {
    if (!window.confirm(`Delete ${row.name} from Contacts?`)) return;
    try { await invoke('delete_contact', { id: row.id, prior: row }); if (state.view === 'contacts') await load(); }
    catch (error) { if (state.view === 'contacts') $('status').textContent = errorMessage(error); }
  }));
  result.append(picker, controls); paint();
  return result;
}
$('cancel-contact').onclick = () => { if (!contactBusy) contactDialog.close(); };
contactDialog.addEventListener('cancel', (event) => { if (contactBusy) event.preventDefault(); });
contactForm.onsubmit = async (event) => {
  event.preventDefault();
  if (contactBusy) return;
  contactBusy = true;
  const buttons = [...contactForm.querySelectorAll('button')];
  for (const button of buttons) button.disabled = true;
  try {
    await invoke('save_contact', { id: contact?.id ?? null, prior: contact, fields: Object.fromEntries(new FormData(contactForm)) });
    contactDialog.close();
    if (state.view === 'contacts') await load();
  } catch (error) { $('contact-status').textContent = errorMessage(error); }
  finally { contactBusy = false; for (const button of buttons) button.disabled = false; }
};
for (const button of $('sections').querySelectorAll('button')) button.onclick = () => select(button.dataset.view);
$('refresh').onclick = () => { if (state.view !== 'theme') void refresh(); };
const syncButton = $('sync-inbox');
const syncStatus = $('sync-status');
const syncNotice = $('sync-notice');
let syncTimer, noticeDismissed = false;
$('dismiss-sync').onclick = () => { noticeDismissed = true; syncNotice.hidden = true; };
const sidebarToggle = $('toggle-sidebar');
function setSidebar(collapsed) {
  document.body.dataset.sidebar = collapsed ? 'collapsed' : 'expanded';
  $('workspace-sidebar').inert = collapsed;
  sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  sidebarToggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  sidebarToggle.title = sidebarToggle.getAttribute('aria-label');
}
let initiallyCollapsed = false;
try { initiallyCollapsed = (localStorage.getItem('inkwell.sidebar') ?? (innerWidth <= 520 ? 'collapsed' : 'expanded')) === 'collapsed'; } catch {}
setSidebar(initiallyCollapsed);
sidebarToggle.onclick = () => {
  setSidebar(sidebarToggle.getAttribute('aria-expanded') === 'true');
  try { localStorage.setItem('inkwell.sidebar', document.body.dataset.sidebar); } catch {}
};
function showInboxJob(job) {
  if (!job) return;
  syncButton.disabled = job.running;
  document.documentElement.dataset.syncing = String(job.running);
  syncNotice.hidden = noticeDismissed;
  const counts = `${job.pages} pages scanned, ${job.inserted} messages added`;
  syncStatus.textContent = job.running ? `Syncing Outlook Inbox: ${counts}` : job.errors.length
    ? `Inbox sync incomplete: ${counts}. ${job.errors.join(' ')}` : `Outlook Inbox sync complete: ${counts}.`;
  clearTimeout(syncTimer);
  if (job.running) syncTimer = setTimeout(pollInboxJob, 1000);
  else if (job.inserted && state.view === 'mail') void refresh();
}
async function pollInboxJob() {
  try { showInboxJob(await invoke('inbox_job_status')); }
  catch (error) {
    syncNotice.hidden = noticeDismissed;
    syncStatus.textContent = 'Outlook sync status unavailable; retrying.';
    syncTimer = setTimeout(pollInboxJob, 2500);
  }
}
syncButton.onclick = async () => {
  syncButton.disabled = true;
  noticeDismissed = false;
  try { showInboxJob(await invoke('start_inbox_job')); }
  catch (error) { syncButton.disabled = false; syncNotice.hidden = false; syncStatus.textContent = errorMessage(error); }
};
void pollInboxJob();
function applyMailFilters() { state.offset = 0; clearReader(); if (['mail', 'search'].includes(state.view)) void load(); }
$('mail-filters').onchange = applyMailFilters;
$('mail-filters').onreset = () => setTimeout(applyMailFilters, 0);
$('mail-filters').onsubmit = (event) => { event.preventDefault(); applyMailFilters(); };
$('search-form').onsubmit = (event) => {
  event.preventDefault();
  const query = $('search').value.trim();
  const scope = $('search-scope').value;
  select(scope === 'workspace' && query ? 'search' : 'mail', state.folder, { query, scope });
};
$('previous').onclick = () => { state.offset = Math.max(0, state.offset - pageSize); clearReader(); void load(); };
$('next').onclick = () => { state.offset += pageSize; clearReader(); void load(); };
window.addEventListener('inkwell-draft-saved', () => {
  if (state.view === 'mail' && state.folder === 'drafts') { clearReader(); void load(); }
});
void refresh();
