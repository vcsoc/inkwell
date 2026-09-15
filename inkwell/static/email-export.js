'use strict';
window.InkwellDownloadEmail = (id) => {
  const link = document.createElement('a');
  link.href = '/api/messages/' + id + '/eml';
  link.download = 'message-' + id + '.eml';
  document.body.append(link);
  link.click();
  link.remove();
};
window.InkwellBindEmailExport = (row, id, selected, onError) => {
  if (!window.inkwellFiles) return null;
  const handle = row.querySelector('.avatar');
  if (!handle) return null;
  handle.classList.add('email-file-handle');
  handle.draggable = true;
  handle.tabIndex = 0;
  handle.setAttribute('role', 'button');
  handle.setAttribute('aria-label', 'Save or drag email file');
  handle.title =
    'Drag this file icon to your file manager to copy a cached .eml (no attachments). Click to download. Alt-drag the row also exports.';
  handle.innerHTML =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h8"/></svg>';
  let pending = null,
    signature = '';
  const prepare = () => {
    const ids = selected(),
      key = ids.join(',');
    if (!pending || key !== signature) {
      signature = key;
      pending = window.inkwellFiles.prepare(ids).catch((error) => {
        pending = null;
        throw error;
      });
    }
    return pending;
  };
  handle.onpointerdown = () => {
    void prepare().catch(() => {});
  };
  const drag = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      const token = await prepare();
      await window.inkwellFiles.drag(token);
    } catch (error) {
      onError(error.message);
    } finally {
      pending = null;
    }
  };
  handle.ondragstart = drag;
  handle.onclick = (event) => {
    event.stopPropagation();
    window.InkwellDownloadEmail(id);
  };
  handle.onkeydown = (event) => {
    if (['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      window.InkwellDownloadEmail(id);
    }
  };
  return drag;
};
