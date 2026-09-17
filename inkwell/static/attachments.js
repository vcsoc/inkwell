'use strict';
window.InkwellAttachments = (() => {
  let downloads = 0;
  const bytes = (value) =>
    value >= 1000000
      ? (value / 1000000).toFixed(1) + ' MB'
      : value >= 1000
        ? (value / 1000).toFixed(1) + ' KB'
        : value + ' B';
  const displayName = (name) =>
    name
      .replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069/\\]/g, '_')
      .replace(/^[ .]+|[ .]+$/g, '') || 'attachment';
  const safeName = (value) => {
    const name = displayName(value),
      encoder = new TextEncoder();
    if (encoder.encode(name).length <= 240) return name;
    const extension = name.match(/\.[a-zA-Z0-9]{1,12}$/)?.[0] || '';
    const prefix = extension ? name.slice(0, -extension.length) : name;
    let result = '';
    for (const letter of prefix) {
      if (encoder.encode(result + letter + extension).length > 240) break;
      result += letter;
    }
    return result + extension;
  };
  return async (root, message, { api, esc, toast, isCurrent }) => {
    let data = null,
      busy = false,
      running = false;
    const fetching = new Set();
    const current = () => root.isConnected && isCurrent();
    const reason = (f) =>
      f.cached_only
        ? 'Earlier cached listing; not confirmed by the latest check'
        : f.size > 50000000
          ? 'Over 50 MB: download through your provider'
          : f.kind === 'cloud'
            ? 'Cloud-linked attachment: open through your provider'
            : f.kind === 'item'
              ? 'Attached Outlook item: open through your provider'
              : f.kind !== 'file'
                ? 'Provider attachment: download not supported'
                : !data.connected
                  ? 'A connected provider reference is required'
                  : '';
    const paint = () => {
      if (!current()) return;
      const focused = root.contains(document.activeElement)
        ? document.activeElement?.dataset.attachmentDownload
        : null;
      const scroll = root.querySelector('.attachment-groups')?.scrollTop || 0;
      const expanded = new Set(
        [...root.querySelectorAll('details[open]')].map((el) => el.dataset.inlineGroup),
      );
      const groups = data?.groups || [],
        files = groups.flatMap((g) => g.files),
        count = files.length;
      const card = (f) =>
        `<div class="attachment-card ${f.cached_only ? 'attachment-cached' : ''}"><div><strong title="${esc(displayName(f.name))}">${esc(displayName(f.name))}</strong><small>${esc(bytes(f.size))}${f.inline ? ' · Inline' : ''}${f.cached_only ? ' · Cached metadata' : ''}</small>${reason(f) ? `<small class="attachment-note">${esc(reason(f))}</small>` : ''}</div><button type="button" class="secondary" data-attachment-download="${f.id}" aria-label="Download ${esc(displayName(f.name))}" ${!f.downloadable || fetching.has(f.id) ? 'disabled' : ''}>${fetching.has(f.id) ? 'Downloading…' : 'Download'}</button></div>`;
      root.innerHTML = `<div class="attachment-heading"><h3>Attachments${data ? ' · ' + count : ''}</h3><button type="button" class="secondary" data-attachment-refresh ${busy || !data?.connected ? 'disabled' : ''}>Refresh attachments</button></div><p class="attachment-status" role="status">${esc(data?.error || data?.warning || (busy ? 'Checking attachments…' : !data ? 'Loading attachment details…' : data.complete ? (count ? 'Attachment check complete.' : 'No attachments found in the checked messages.') : 'Attachment check is incomplete.'))}</p>${data?.scope === 'thread' ? '<p class="attachment-scope">Entire Outlook conversation, including other folders · grouped by source message</p>' : data?.scope === 'message' ? '<p class="attachment-scope">This message only. Full conversation discovery is available for Outlook accounts with a conversation ID.</p>' : ''}${data?.retry_at > Date.now() / 1000 ? `<p>Retry after ${esc(new Date(data.retry_at * 1000).toLocaleTimeString())}.</p>` : ''}<div class="attachment-groups">${groups
        .filter((g) => g.files.length)
        .sort((a, b) => Number(b.selected) - Number(a.selected) || b.date.localeCompare(a.date))
        .map(
          (g) =>
            `<section class="attachment-source"><h4>${g.selected ? 'This message' : esc(g.subject)}</h4><p>${esc(g.sender)}${g.date ? ' · ' + esc(Number.isNaN(Date.parse(g.date)) ? g.date : new Date(g.date).toLocaleString()) : ''}${g.cached_only ? ' · Earlier cached listing' : ''}</p><div class="attachment-grid">${g.files
              .filter((f) => !f.inline)
              .map(card)
              .join('')}</div>${
              g.files.some((f) => f.inline)
                ? `<details data-inline-group="${g.key}" ${expanded.has(g.key) ? 'open' : ''}><summary>Inline attachments (${g.files.filter((f) => f.inline).length})</summary><div class="attachment-grid">${g.files
                    .filter((f) => f.inline)
                    .map(card)
                    .join('')}</div></details>`
                : ''
            }</section>`,
        )
        .join(
          '',
        )}</div>${!busy && data?.connected && !data.complete ? '<button type="button" class="secondary" data-attachment-more>Continue attachment check</button>' : ''}<p class="attachment-note">Files are saved only when you choose Download, never opened automatically. Cached lists contain metadata, not file contents. Only server-returned and previously discovered attachments can be listed.</p>`;
      root.querySelector('.attachment-groups').scrollTop = scroll;
      root.setAttribute('aria-busy', String(busy));
      if (focused)
        root
          .querySelector(`[data-attachment-download="${focused}"]`)
          ?.focus({ preventScroll: true });
    };
    const run = async (reset) => {
      if (running || !current()) return;
      running = true;
      busy = true;
      paint();
      try {
        let next = reset ? 'refresh' : 'continue';
        // A stopped reader never starts another provider request. Large threads can resume.
        for (let page = 0; page < 100 && current(); page++) {
          const result = await api(`/messages/${message.id}/attachments/${next}`, {
            method: 'POST',
          });
          if (!current()) return;
          data = result;
          paint();
          if (data.complete || data.error || !data.connected) break;
          next = 'continue';
        }
      } catch (error) {
        if (current())
          data = {
            ...(data || { groups: [], connected: true }),
            error: error.message,
            complete: false,
          };
      } finally {
        running = false;
        busy = false;
        paint();
      }
    };
    root.onclick = async (event) => {
      if (event.target.closest('[data-attachment-refresh]')) return run(true);
      if (event.target.closest('[data-attachment-more]')) return run(false);
      const button = event.target.closest('[data-attachment-download]');
      if (!button || button.disabled) return;
      const token = button.dataset.attachmentDownload,
        file = data.groups.flatMap((g) => g.files).find((f) => f.id === token);
      if (!file?.downloadable) return;
      if (downloads >= 2) {
        toast('Two attachment downloads are already running. Please wait.');
        return;
      }
      downloads++;
      fetching.add(token);
      paint();
      try {
        const response = await fetch(`/api/messages/${message.id}/attachments/${token}/download`, {
          headers: { 'X-Inkwell': '1' },
        });
        if (!response.ok) {
          const error = await response
            .json()
            .catch(() => ({ detail: 'Attachment download failed' }));
          throw Error(error.detail || 'Attachment download failed');
        }
        const blob = await response.blob(),
          url = URL.createObjectURL(blob),
          link = document.createElement('a');
        link.href = url;
        link.download = safeName(file.name);
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('Download started: ' + safeName(file.name));
      } catch (error) {
        toast(error.message);
      } finally {
        downloads--;
        fetching.delete(token);
        paint();
      }
    };
    paint();
    try {
      const result = await api(`/messages/${message.id}/attachments`);
      if (!current()) return;
      data = result;
      paint();
      if (data.connected) await run(!(data.pending > 0 && !data.error));
    } catch (error) {
      if (current()) {
        data = { groups: [], connected: false, error: error.message, complete: false };
        paint();
      }
    }
  };
})();
