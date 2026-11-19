'use strict';
window.InkwellDrafts = (() => {
  const dialog = document.getElementById('draft-dialog');
  const form = document.getElementById('draft-form');
  const status = document.getElementById('draft-status');
  const read = () => Object.fromEntries(new FormData(form));
  const invoke = (name, args) => window.__TAURI__.core.invoke(name, args);
  let version, key, baseline, timer, busy = false;
  const dirty = () => JSON.stringify(read()) !== baseline;
  async function save(force = false) {
    clearTimeout(timer);
    if (!dialog.open || busy || (!force && !dirty()) || !form.reportValidity()) return;
    busy = true;
    const fields = read();
    status.textContent = 'Saving draft...';
    try {
      version = await invoke('save_draft', { key, expected: version, fields });
      baseline = JSON.stringify(fields);
      status.textContent = 'Draft saved locally.';
      window.dispatchEvent(new Event('inkwell-draft-saved'));
      if (dirty()) timer = setTimeout(save, 500);
    } catch (error) {
      status.textContent = typeof error === 'string' ? error : 'Could not save the draft.';
    } finally { busy = false; }
  }
  function close() {
    if (busy) return;
    if (dirty() && !window.confirm('Close without saving the latest changes?')) return;
    clearTimeout(timer);
    dialog.close();
  }
  function newKey() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }
  function show(data, seed = {}) {
    if (dialog.open || busy) return;
    [version, key] = data ? [data[0], data[0].key] : [null, newKey()];
    const fields = data?.[1] || seed;
    for (const name of ['recipient', 'cc', 'bcc', 'subject', 'body']) form.elements[name].value = fields[name] || '';
    baseline = JSON.stringify(read());
    status.textContent = '';
    dialog.showModal();
  }
  form.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(save, 650); });
  form.addEventListener('submit', (event) => { event.preventDefault(); void save(true); });
  document.getElementById('close-draft').onclick = close;
  document.getElementById('new-draft').onclick = () => show();
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  window.addEventListener('beforeunload', (event) => {
    if (dialog.open && (busy || dirty())) { event.preventDefault(); event.returnValue = ''; }
  });
  return { show };
})();
