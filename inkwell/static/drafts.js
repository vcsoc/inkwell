'use strict';
window.InkwellDraftAutosave = ({ form, data, api, toast, onSaved }) => {
  let id = data.folder === 'drafts' ? data.id : null;
  let revision = data.folder === 'drafts' ? data.draft_revision : null;
  const key = data.draft_key || crypto.randomUUID();
  let timer,
    queue = Promise.resolve(),
    done = false,
    lastSaved = null;
  const values = () => {
    const f = Object.fromEntries(new FormData(form));
    return {
      recipient: f.recipient || '',
      cc: f.cc || '',
      bcc: f.bcc || '',
      subject: f.subject || '',
      body: f.body || '',
      account_id: f.account_id ? Number(f.account_id) : null,
      from_address: f.from_address || null,
    };
  };
  if (id) lastSaved = JSON.stringify(values());
  const status = (message) => {
    if (form.isConnected) form.querySelector('#draft-status').textContent = message;
  };
  const flush = () => {
    clearTimeout(timer);
    queue = queue
      .catch(() => {})
      .then(async () => {
        if (done) return;
        const content = values(),
          signature = JSON.stringify(content);
        if (
          signature === lastSaved ||
          (!id &&
            ![content.recipient, content.cc, content.bcc, content.subject, content.body].some((v) =>
              v.trim(),
            ))
        )
          return;
        status('Saving draft…');
        try {
          const result = await api('/drafts', {
            method: 'POST',
            body: { ...content, draft_id: id, draft_key: key, draft_revision: revision },
          });
          id = result.id;
          revision = result.draft_revision;
          lastSaved = signature;
          status('Draft saved automatically.');
          await onSaved().catch((error) => toast(error.message));
        } catch (error) {
          status('Draft not saved: ' + error.message);
          throw error;
        }
      });
    return queue;
  };
  const changed = () => {
    if (done) return;
    status('Saving draft shortly…');
    clearTimeout(timer);
    timer = setTimeout(() => flush().catch((error) => toast(error.message)), 350);
  };
  form.addEventListener('input', changed);
  form.addEventListener('change', changed);
  // Best effort for browser/PWA tab closure; desktop close awaits flush explicitly.
  const leaving = () => {
    if (done) return;
    const content = values();
    if (
      JSON.stringify(content) === lastSaved ||
      ![content.recipient, content.cc, content.bcc, content.subject, content.body].some((v) =>
        v.trim(),
      )
    )
      return;
    fetch('/api/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Inkwell': '1' },
      body: JSON.stringify({ ...content, draft_id: id, draft_key: key, draft_revision: revision }),
      keepalive: true,
    }).catch(() => {});
  };
  const blur = () => flush().catch((error) => toast(error.message));
  window.addEventListener('blur', blur);
  window.addEventListener('pagehide', leaving);
  const stop = () => {
    done = true;
    window.removeEventListener('blur', blur);
    clearTimeout(timer);
    window.removeEventListener('pagehide', leaving);
    form.removeEventListener('input', changed);
    form.removeEventListener('change', changed);
  };
  return {
    flush,
    stop,
    values: () => ({ ...values(), draft_id: id, draft_key: key, draft_revision: revision }),
    get id() {
      return id;
    },
  };
};
