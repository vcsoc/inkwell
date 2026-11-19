'use strict';
window.InkwellDrafts = (() => {
  const dialog = document.getElementById('draft-dialog');
  const form = document.getElementById('draft-form');
  const status = document.getElementById('draft-status');
  const read = () => Object.fromEntries(new FormData(form));
  const invoke = (name, args) => window.__TAURI__.core.invoke(name, args);
  const fields = ['recipient', 'cc', 'bcc', 'subject', 'body'];
  const addresses = ['recipient', 'cc', 'bcc'].map((name) => form.elements[name]);
  let version, key, baseline, timer, pending, deleting = false, candidates = [];
  const dirty = () => JSON.stringify(read()) !== baseline;
  const changed = () => window.dispatchEvent(new Event('inkwell-draft-saved'));
  function queue() {
    clearTimeout(timer);
    if (dialog.open && !deleting && dirty()) {
      status.textContent = 'Saving changes...';
      timer = setTimeout(() => void save(), 250);
    }
  }
  async function save(force = false) {
    clearTimeout(timer);
    if (!dialog.open || deleting) return false;
    if (pending) return pending;
    if (!force && !dirty()) return true;
    if (!form.reportValidity()) return false;
    const data = read();
    status.textContent = 'Saving draft...';
    pending = (async () => {
      try {
        version = await invoke('save_draft', { key, expected: version, fields: data });
        baseline = JSON.stringify(data);
        status.textContent = 'Draft saved locally.';
        changed();
        if (dirty()) queue();
        return true;
      } catch (error) {
        status.textContent = typeof error === 'string' ? error : 'Could not save the draft.';
        return false;
      } finally { pending = null; }
    })();
    return pending;
  }
  async function close() {
    if (deleting || (pending && !(await pending))) return;
    while (dirty()) if (!(await save())) return;
    clearTimeout(timer); dialog.close();
  }
  async function remove() {
    if (deleting || !window.confirm('Delete this draft?')) return;
    deleting = true;
    clearTimeout(timer);
    if (pending) await pending;
    clearTimeout(timer);
    try {
      if (version) await invoke('delete_plain_draft', { expected: version });
      baseline = JSON.stringify(read()); dialog.close(); changed();
    } catch (error) { status.textContent = String(error); }
    finally { deleting = false; }
  }
  function newKey() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }
  function updateSuggestions(input) {
    const list = input.list;
    const prefix = input.value.match(/^.*[,;]\s*/)?.[0] || '';
    const query = input.value.slice(prefix.length).trim().toLocaleLowerCase();
    list.replaceChildren(...candidates.filter(({ email, name }) => `${name} ${email}`.toLocaleLowerCase().includes(query))
      .slice(0, 12).map(({ email, name }) => {
        const option = document.createElement('option');
        option.value = prefix + email; option.label = name || email; return option;
      }));
  }
  async function loadAddresses(session) {
    const [contacts, history] = await Promise.allSettled([invoke('contacts'), invoke('recent_sent_addresses')]);
    if (!dialog.open || key !== session) return;
    const known = new Map();
    const add = (email, name = '') => {
      if (email && !known.has(email.toLowerCase())) known.set(email.toLowerCase(), { email, name });
    };
    if (contacts.status === 'fulfilled') for (const contact of contacts.value) add(contact.email, contact.name);
    if (history.status === 'fulfilled') for (const row of history.value) for (const field of row) {
      for (const match of field.matchAll(/[^\s@<>,;"()]+@[^\s@<>,;"()]+\.[a-z0-9-]+/gi)) add(match[0]);
    }
    candidates = [...known.values()]; addresses.forEach(updateSuggestions);
  }
  function show(data, seed = {}) {
    if (dialog.open || pending) return;
    [version, key] = data ? [data[0], data[0].key] : [null, newKey()];
    const values = data?.[1] || seed;
    for (const name of fields) form.elements[name].value = values[name] || '';
    baseline = JSON.stringify(read());
    status.textContent = '';
    candidates = []; addresses.forEach(updateSuggestions);
    dialog.showModal();
    void loadAddresses(key);
  }
  const menu = document.createElement('div'); menu.className = 'draft-context'; menu.hidden = true;
  menu.setAttribute('aria-label', 'Text editing actions'); dialog.append(menu);
  function hideMenu() { menu.hidden = true; }
  dialog.addEventListener('contextmenu', (event) => {
    const target = event.target;
    if (!fields.includes(target.name)) return;
    event.preventDefault();
    const { selectionStart: start, selectionEnd: end } = target;
    const selection = target.value.slice(start, end);
    const original = target.value;
    const session = key;
    const replace = (text) => {
      if (!dialog.open || session !== key || target.value !== original || deleting) return;
      target.focus(); target.setRangeText(text.slice(0, Math.max(0, target.maxLength - (original.length - (end - start)))), start, end, 'end');
      target.dispatchEvent(new Event('input', { bubbles: true }));
    };
    menu.replaceChildren();
    function command(name, run, disabled = false) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = name; button.disabled = disabled;
      button.onclick = async () => { hideMenu(); try { await run(); } catch (error) { status.textContent = String(error); } };
      menu.append(button);
    }
    command('Cut', async () => { await invoke('draft_clipboard', { text: selection }); replace(''); }, !selection);
    command('Copy', () => invoke('draft_clipboard', { text: selection }), !selection);
    command('Paste', async () => replace(await invoke('draft_clipboard', { text: null })));
    command('Select all', () => { target.focus(); target.select(); });
    if (selection.trim() && [...selection].length <= 2000) {
      const languages = document.createElement('select');
      languages.setAttribute('aria-label', 'Translate selection');
      languages.append(new Option('Translate selection...', ''));
      for (const [code, label] of Object.entries({ en: 'English', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian', nl: 'Dutch', pt: 'Portuguese', ja: 'Japanese', zh: 'Chinese (Simplified)', uk: 'Ukrainian', af: 'Afrikaans' })) languages.append(new Option(label, code));
      languages.onchange = async () => {
        if (!languages.value) return;
        hideMenu(); status.textContent = 'Translating locally...';
        try {
          const result = await invoke('translate_draft', { text: selection, language: languages.value });
          if (dialog.open && session === key && target.value !== original) status.textContent = 'Translation not applied because the field changed.';
          else replace(result);
        } catch (error) { if (dialog.open && session === key) status.textContent = String(error); }
      };
      menu.append(languages);
    }
    menu.hidden = false;
    menu.style.left = `${Math.max(0, Math.min(event.clientX, innerWidth - menu.offsetWidth))}px`;
    menu.style.top = `${Math.max(0, Math.min(event.clientY, innerHeight - menu.offsetHeight))}px`;
    menu.querySelector('button:not(:disabled)')?.focus();
  });
  dialog.addEventListener('pointerdown', (event) => { if (!menu.contains(event.target)) hideMenu(); });
  dialog.addEventListener('close', hideMenu);
  form.addEventListener('input', (event) => { if (addresses.includes(event.target)) updateSuggestions(event.target); queue(); });
  form.addEventListener('submit', (event) => { event.preventDefault(); void save(true); });
  document.getElementById('close-draft').onclick = () => void close();
  document.getElementById('delete-draft').onclick = () => void remove();
  document.getElementById('new-draft').onclick = () => show();
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); if (!menu.hidden) hideMenu(); else void close(); });
  window.addEventListener('beforeunload', (event) => {
    if (dialog.open && (pending || dirty())) { event.preventDefault(); event.returnValue = ''; }
  });
  return { show };
})();
