'use strict';
window.InkwellSendingIdentities = async (root, account, { api, esc, toast, isCurrent }) => {
  root.textContent = 'Loading sending addresses…';
  let data;
  try {
    data = await api('/accounts/' + account.id + '/senders');
  } catch (error) {
    if (root.isConnected) root.textContent = error.message;
    return;
  }
  if (!root.isConnected || !isCurrent()) return;
  root.innerHTML = `<h3>Sending addresses · ${esc(account.email)}</h3><p>Choose the default for new messages on this account. Saved drafts keep their selected From address.</p><form><label class="field">Additional aliases you own<textarea name="aliases" rows="3" maxlength="12800" placeholder="One email address per line"></textarea></label><p class="fine-print">Only add addresses your provider allows you to send as. Adding an address here does not grant permission. Microsoft personal accounts may not expose a complete alias list.</p><label class="field">Default From address<select name="default_from" aria-label="Default From address"></select></label><div class="form-actions"><button type="submit" class="primary">Save sending addresses</button>${account.provider === 'microsoft' ? '<button type="button" class="secondary" id="refresh-sending-addresses">Refresh Microsoft addresses</button>' : ''}</div><p role="status" class="fine-print" id="sending-address-status"></p></form>`;
  const form = root.querySelector('form'),
    aliases = form.elements.aliases,
    select = form.elements.default_from,
    status = root.querySelector('[role=status]');
  const lines = () =>
    aliases.value
      .split(/\n/)
      .map((v) => v.trim())
      .filter(Boolean);
  const paint = (chosen = select.value || data.default_from) => {
    const values = [
      ...data.addresses.filter((a) => a.source !== 'configured').map((a) => a.address),
      ...lines(),
    ];
    const unique = [...new Map(values.map((v) => [v.toLowerCase(), v])).values()];
    select.replaceChildren(...unique.map((v) => new Option(v, v)));
    if (chosen && !unique.some((v) => v.toLowerCase() === chosen.toLowerCase()))
      select.add(new Option(chosen + ' — unavailable', chosen));
    select.value =
      [...select.options].find((o) => o.value.toLowerCase() === chosen.toLowerCase())?.value || '';
  };
  aliases.value = data.additional_addresses.join('\n');
  paint(data.default_from);
  status.textContent = data.note;
  aliases.oninput = () => paint();
  form.onsubmit = async (event) => {
    event.preventDefault();
    form.inert = true;
    try {
      data = await api('/accounts/' + account.id + '/senders', {
        method: 'PUT',
        body: { default_from: select.value, additional_addresses: lines() },
      });
      if (root.isConnected && isCurrent())
        status.textContent =
          'Sending addresses saved. New messages will preselect ' + data.default_from + '.';
    } catch (error) {
      if (root.isConnected) status.textContent = error.message;
      toast(error.message);
    } finally {
      form.inert = false;
    }
  };
  const refresh = root.querySelector('#refresh-sending-addresses');
  if (refresh)
    refresh.onclick = async () => {
      const chosen = select.value;
      form.inert = true;
      try {
        data = await api('/accounts/' + account.id + '/senders/refresh', { method: 'POST' });
        if (root.isConnected && isCurrent()) {
          paint(chosen);
          status.textContent = data.note;
        }
      } catch (error) {
        status.textContent = error.message;
        toast(error.message);
      } finally {
        form.inert = false;
      }
    };
};
