'use strict';
window.InkwellComposer = (
  data,
  { state, modal, field, textarea, esc, api, toast, refreshCounts, renderMail },
) => {
  modal(
    data.folder === 'drafts' ? 'Your draft' : 'A new conversation',
    `<form id="compose-form" class="compose-form"><label class="field">From<select name="account_id"><option value="">Draft only / choose an account</option>${state.accounts.map((a) => `<option value="${a.id}">${esc(a.name)} &lt;${esc(a.email)}&gt;</option>`).join('')}</select></label>${field('To', 'recipient', data.recipient || '', 'email', 'maxlength="254" list="contact-emails" placeholder="someone@example.com"')}<datalist id="contact-emails">${state.contacts.map((c) => `<option value="${esc(c.email)}">${esc(c.name)}</option>`).join('')}</datalist>${field('Subject', 'subject', data.subject || '', 'text', 'maxlength="998" placeholder="What’s on your mind?"')}${textarea('Message', 'body', data.body || '', 'maxlength="500000" placeholder="Hello there…"')}<p id="draft-status" class="fine-print" role="status">Drafts save automatically when you type or leave this editor.</p><p class="fine-print">Send message sends immediately, without another confirmation. Drafts remain local.</p><div class="form-actions"><button type="button" class="secondary danger" id="delete-draft">Delete draft</button><button type="button" class="secondary" id="save-draft">Save draft</button><button class="primary" type="submit" ${state.accounts.length ? '' : 'disabled'}>Send message ↗</button></div></form>`,
  );
  const form = document.querySelector('#compose-form'),
    dialog = document.querySelector('#modal');
  form.elements.account_id.value =
    data.account_id || (data.folder === 'drafts' ? '' : state.accounts[0]?.id || '');
  const controller = InkwellDraftAutosave({ form, data, api, toast, onSaved: refreshCounts });
  state.composer = controller;
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
        await controller.flush();
        const payload = controller.values();
        if (!payload.recipient || !payload.account_id)
          throw Error('Choose an account and enter a recipient before sending.');
        await api('/send', { method: 'POST', body: payload });
        await finish();
        toast('Message accepted by your mail provider.');
      } catch (error) {
        toast(error.message);
        throw error;
      } finally {
        form.inert = false;
        controller.sending = null;
      }
    })();
    controller.sending.catch(() => {});
  };
};
