'use strict';
window.InkwellComposer = (
  data,
  { state, modal, field, textarea, esc, api, toast, refreshCounts, renderMail },
) => {
  const kind =
    data.compose_action ||
    (/^re:/i.test(data.subject || '')
      ? 'reply'
      : /^fw(?:d)?:/i.test(data.subject || '')
        ? 'forward'
        : 'new');
  const title =
    data.folder === 'drafts'
      ? 'Draft'
      : kind === 'reply'
        ? 'Reply'
        : kind === 'forward'
          ? 'Forward'
          : 'New message';
  modal(
    title,
    `<form id="compose-form" class="compose-form">
    <div class="compose-identity">
      <label class="field">Account<select name="account_id"><option value="">Draft only / choose an account</option>${state.accounts.map((a) => `<option value="${a.id}">${esc(a.name)} &lt;${esc(a.email)}&gt;</option>`).join('')}</select></label>
      <label class="field">From address<select name="from_address" aria-label="From address"><option value="">Loading sender choices…</option></select></label>
      <details class="compose-sender-info"><summary aria-label="Sender information" title="Sender information">Sender info</summary><p id="sender-status" class="fine-print" role="status"></p></details>
    </div>
    <div class="compose-to-row">${field('To', 'recipient', data.recipient || '', 'text', 'data-email-addresses inputmode="email" maxlength="8192" placeholder="Add recipients"')}<div class="compose-recipient-toggles"><button class="secondary" type="button" id="toggle-cc" aria-controls="compose-cc" aria-expanded="${!!data.cc}">${data.cc ? 'Hide Cc' : 'Cc'}</button><button class="secondary" type="button" id="toggle-bcc" aria-controls="compose-bcc" aria-expanded="${!!data.bcc}">${data.bcc ? 'Hide Bcc' : 'Bcc'}</button></div></div>
    <div id="compose-cc" ${data.cc ? '' : 'hidden'}>${field('Cc', 'cc', data.cc || '', 'text', 'data-email-addresses inputmode="email" maxlength="8192" placeholder="Copy recipients"')}</div>
    <div id="compose-bcc" ${data.bcc ? '' : 'hidden'}>${field('Bcc', 'bcc', data.bcc || '', 'text', 'data-email-addresses inputmode="email" maxlength="8192" placeholder="Hidden copy recipients"')}</div>
    <div class="compose-subject-row">${field('Subject', 'subject', data.subject || '', 'text', 'maxlength="998" placeholder="Add a subject"')}</div>
    ${textarea('Message', 'body', data.body || '', 'maxlength="500000" placeholder="Write your message…"')}
    <footer class="compose-footer"><div class="compose-save-state"><p id="draft-status" class="fine-print" role="status">Draft saves automatically</p><p class="fine-print compose-send-note">Sends immediately · Drafts stay local</p></div><div class="form-actions"><button type="button" class="secondary danger" id="delete-draft">Delete draft</button><button type="button" class="secondary" id="save-draft">Save draft</button><button class="primary" type="submit" ${state.accounts.length ? '' : 'disabled'}>Send message ↗</button></div></footer>
  </form>`,
  );
  const form = document.querySelector('#compose-form'),
    dialog = document.querySelector('#modal');
  // HTML parsing removes a textarea's first newline; keep the actual draft exact.
  form.elements.body.value = data.body || '';
  form.elements.account_id.value =
    data.account_id || (data.folder === 'drafts' ? '' : state.accounts[0]?.id || '');
  const from = form.elements.from_address;
  const retained =
    data.folder === 'drafts' && data.sender && data.sender !== 'Me' ? data.sender : '';
  if (retained) from.replaceChildren(new Option(retained, retained));
  let senderVersion = 0,
    senderReady;
  const loadSenders = () => {
    const version = ++senderVersion,
      id = form.elements.account_id.value;
    const requested = version === 1 ? retained : '';
    from.replaceChildren(new Option(requested || 'Choose an account', requested));
    if (!id) {
      form.querySelector('#sender-status').textContent =
        'Draft only — no sending account selected.';
      return Promise.resolve();
    }
    form.querySelector('#sender-status').textContent = 'Loading sender choices…';
    return api('/accounts/' + id + '/senders')
      .then((result) => {
        if (version !== senderVersion || !form.isConnected) return;
        from.replaceChildren(
          ...result.addresses.map(
            (item) =>
              new Option(
                item.address + (item.source === 'configured' ? ' (configured alias)' : ''),
                item.address,
              ),
          ),
        );
        const chosen = requested || result.default_from;
        if (!result.addresses.some((item) => item.address.toLowerCase() === chosen.toLowerCase())) {
          from.add(new Option(chosen + ' — unavailable; choose another sender', chosen));
          form.querySelector('.compose-sender-info').open = true;
        }
        from.value =
          [...from.options].find((o) => o.value.toLowerCase() === chosen.toLowerCase())?.value ||
          '';
        form.querySelector('#sender-status').textContent =
          'This exact From address is requested; inkwell never substitutes another sender. Your provider can reject or rewrite aliases: verify the actual From when first using one.';
        form.dispatchEvent(new Event('change'));
      })
      .catch((error) => {
        if (version === senderVersion && form.isConnected)
          form.querySelector('.compose-sender-info').open = true;
        if (version === senderVersion && form.isConnected)
          form.querySelector('#sender-status').textContent =
            'Sender choices unavailable. Retry by selecting the account again.';
        throw error;
      });
  };
  form.elements.account_id.addEventListener('change', () => {
    senderReady = loadSenders();
    senderReady.catch((error) => toast(error.message));
  });
  InkwellComposerLayout(form, state);
  form.composeMedia = InkwellComposerMedia(form, data, toast);
  const controller = InkwellDraftAutosave({ form, data, api, toast, onSaved: refreshCounts });
  state.composer = controller;
  senderReady = loadSenders();
  senderReady.catch((error) => toast(error.message));
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.tagName === 'INPUT' && !event.defaultPrevented) {
      event.preventDefault();
      if (event.target.name === 'subject') form.composeMedia.focus();
      else form.elements.subject.focus();
    }
  });
  for (const key of ['cc', 'bcc'])
    form.querySelector('#toggle-' + key).onclick = () => {
      const wrapper = form.querySelector('#compose-' + key),
        button = form.querySelector('#toggle-' + key);
      if (!wrapper.hidden && form.elements[key].value.trim()) {
        toast('Clear ' + (key === 'cc' ? 'Cc' : 'Bcc') + ' recipients before hiding this field.');
        return;
      }
      wrapper.hidden = !wrapper.hidden;
      button.setAttribute('aria-expanded', String(!wrapper.hidden));
      button.textContent = (!wrapper.hidden ? 'Hide ' : '') + (key === 'cc' ? 'Cc' : 'Bcc');
      if (!wrapper.hidden) form.elements[key].focus();
    };
  const finish = async () => {
    controller.stop();
    if (state.composer === controller) state.composer = null;
    dialog.close();
    await refreshCounts();
    if (['sent', 'drafts'].includes(state.view)) await renderMail();
  };
  form.querySelector('#save-draft').onclick = async () => {
    form.inert = true;
    try {
      await controller.flush();
      await finish();
      toast('Draft saved locally.');
    } catch (error) {
      toast(error.message);
    } finally {
      form.inert = false;
    }
  };
  form.querySelector('#delete-draft').onclick = async () => {
    form.inert = true;
    try {
      await controller.flush();
      if (controller.id) await api('/messages/' + controller.id, { method: 'DELETE' });
      await finish();
      toast('Draft deleted locally.');
    } catch (error) {
      toast(error.message);
    } finally {
      form.inert = false;
    }
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    if (controller.sending) return;
    form.inert = true;
    controller.sending = (async () => {
      try {
        if (form.composeMedia.cropping)
          throw Error('Apply or cancel the image crop before sending.');
        await senderReady;
        await controller.flush();
        const payload = controller.values();
        if (
          ![payload.recipient, payload.cc, payload.bcc].some((v) => v.trim()) ||
          !payload.account_id
        )
          throw Error('Choose an account and enter a recipient before sending.');
        form.querySelector('#draft-status').textContent =
          'Submitting message and attachments… Keep this window open.';
        await api('/send', { method: 'POST', body: payload });
        await finish();
        toast('Message accepted by your mail provider.');
      } catch (error) {
        form.querySelector('#draft-status').textContent =
          'Send not confirmed. Your draft and attachments remain here. ' + error.message;
        toast(error.message);
        throw error;
      } finally {
        form.inert = false;
        controller.sending = null;
      }
    })();
    controller.sending.catch(() => {});
  };
  if (kind === 'reply' || kind === 'forward' || data.folder === 'drafts') {
    form.elements.body.setSelectionRange(0, 0);
    form.composeMedia.focus();
    form.elements.body.scrollTop = 0;
  } else if (!data.recipient) form.elements.recipient.focus();
};
