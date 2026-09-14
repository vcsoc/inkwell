'use strict';
window.InkwellHtmlPreview = async (root, message, options) => {
  const { api, navigate, mode, esc, isCurrent, appearance = 'theme' } = options;
  if (mode === 'text' || !message.html_body) {
    root.innerHTML = `${mode !== 'text' && message.html_body === null && message.remote_key ? '<p class="notice">Showing the text copy. Sync this folder to download its HTML version.</p>' : ''}<div class="message-body">${esc(message.body)}</div>`;
    return;
  }
  root.innerHTML =
    '<div class="privacy-banner" role="note"><span>To protect your privacy, inkwell has blocked remote content in this message.</span><label>Options<select aria-label="Remote content options"><option value="block">Keep remote content blocked</option><option value="all">Load listed HTTPS images for this view…</option><option value="text">Use text preview for this view</option><option value="settings">Preview settings…</option></select></label></div><p class="html-safety-note">Scripts, forms, external styles/fonts and navigation links are disabled. Loading images shares your IP and may report that you opened this message.</p><iframe class="html-message" title="Email HTML preview" sandbox="" referrerpolicy="no-referrer"></iframe>';
  const frame = root.querySelector('iframe'),
    menu = root.querySelector('select'),
    banner = root.querySelector('.privacy-banner span');
  const base = '/api/messages/' + message.id + '/html?appearance=' + appearance;
  frame.style.backgroundColor = getComputedStyle(root).getPropertyValue('--surface');
  frame.src = base;
  let origins = [];
  try {
    const info = await api('/messages/' + message.id + '/preview-info');
    if (!root.isConnected || !isCurrent()) return;
    origins = info.origins.slice(0, 50);
    origins.forEach((origin, index) => {
      const option = document.createElement('option');
      option.value = 'origin-' + index;
      option.textContent = 'Load images from ' + origin + '…';
      menu.append(option);
    });
    menu.querySelector('[value=all]').disabled = !origins.length;
  } catch (error) {
    if (root.isConnected) banner.textContent = 'Remote content remains blocked. ' + error.message;
  }
  menu.addEventListener('change', async () => {
    const choice = menu.value;
    if (choice === 'settings') {
      await navigate('settings/forms');
      return;
    }
    if (choice === 'text') {
      root.innerHTML = `<div class="message-body">${esc(message.body)}</div>`;
      return;
    }
    if (choice === 'block') {
      frame.src = base;
      banner.textContent =
        'To protect your privacy, inkwell has blocked remote content in this message.';
      return;
    }
    const selected =
      choice === 'all' ? origins : [origins[Number(choice.slice(7))]].filter(Boolean);
    if (!selected.length) return;
    if (!root.isConnected || !isCurrent()) return;
    const query = new URLSearchParams();
    selected.forEach((origin) => query.append('allow', origin));
    frame.src = base + '&' + query;
    banner.textContent =
      'Remote images are allowed from the selected origins for this view. Scripts and other active content remain blocked.';
  });
};
