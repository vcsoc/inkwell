'use strict';
window.InkwellHtmlPreview = async (root, message, options) => {
  const { api, navigate, mode, esc, isCurrent, appearance = 'theme' } = options;
  let text = mode === 'text' || !message.html_body,
    selected = [],
    origins = [],
    infoPromise = null,
    frame = null;
  root.innerHTML =
    '<label class="check-label email-link-control"><input type="checkbox" data-email-links aria-label="Enable text links"> Enable text links for this view</label><p class="fine-print">Links open in your browser. Destinations may track clicks or be misleading; scripts remain blocked.</p><div class="email-preview-content"></div>';
  const checkbox = root.querySelector('[data-email-links]'),
    content = root.querySelector('.email-preview-content');
  const current = () => root.isConnected && isCurrent();
  const info = () =>
    (infoPromise ||= api('/messages/' + message.id + '/preview-info').catch((error) => {
      infoPromise = null;
      throw error;
    }));
  const renderText = async () => {
    content.innerHTML = `${mode !== 'text' && message.html_body === null && message.remote_key ? '<p class="notice">Showing the text copy. Sync this folder to download its HTML version.</p>' : ''}<div class="message-body"></div>`;
    const body = content.querySelector('.message-body');
    body.textContent = message.body;
    if (!checkbox.checked) return;
    const metadata = await info();
    if (!current() || !checkbox.checked || !body.isConnected) return;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const link of metadata.text_links || []) {
      if (link.start < offset || message.body.slice(link.start, link.end) !== link.text) continue;
      fragment.append(document.createTextNode(message.body.slice(offset, link.start)));
      const anchor = document.createElement('a');
      anchor.textContent = link.text;
      anchor.href = link.url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.title = link.url;
      fragment.append(anchor);
      offset = link.end;
    }
    fragment.append(document.createTextNode(message.body.slice(offset)));
    body.replaceChildren(fragment);
  };
  const updateFrame = () => {
    if (!current() || !frame) return;
    const query = new URLSearchParams({ appearance });
    selected.forEach((origin) => query.append('allow', origin));
    if (checkbox.checked) query.set('links', 'true');
    frame.setAttribute(
      'sandbox',
      checkbox.checked ? 'allow-popups allow-popups-to-escape-sandbox' : '',
    );
    frame.src = '/api/messages/' + message.id + '/html?' + query;
  };
  checkbox.onchange = async () => {
    try {
      if (text) await renderText();
      else updateFrame();
    } catch (error) {
      checkbox.checked = false;
      if (text) await renderText();
      if (current())
        content.insertAdjacentHTML(
          'afterbegin',
          `<p class="notice">Links remain disabled. ${esc(error.message)}</p>`,
        );
    }
  };
  if (text) {
    await renderText();
    return;
  }
  content.innerHTML =
    '<div class="privacy-banner" role="note"><span>To protect your privacy, inkwell has blocked remote content in this message.</span><label>Options<select aria-label="Remote content options"><option value="block">Keep remote content blocked</option><option value="all" disabled>Load listed HTTPS images for this view…</option><option value="text">Use text preview for this view</option><option value="settings">Preview settings…</option></select></label></div><p class="html-safety-note">Scripts, forms, external styles/fonts remain disabled. Loading images shares your IP and may report that you opened this message.</p><iframe class="html-message" title="Email HTML preview" sandbox="" referrerpolicy="no-referrer"></iframe>';
  frame = content.querySelector('iframe');
  frame.style.backgroundColor = getComputedStyle(root).getPropertyValue('--surface');
  updateFrame();
  const menu = content.querySelector('select'),
    banner = content.querySelector('.privacy-banner span');
  menu.onchange = async () => {
    const choice = menu.value;
    if (choice === 'settings') {
      await navigate('settings/forms');
      return;
    }
    if (choice === 'text') {
      text = true;
      await checkbox.onchange();
      return;
    }
    selected =
      choice === 'block'
        ? []
        : choice === 'all'
          ? origins
          : [origins[Number(choice.slice(7))]].filter(Boolean);
    updateFrame();
    banner.textContent = selected.length
      ? 'Remote images are allowed from the selected origins for this view. Scripts and other active content remain blocked.'
      : 'To protect your privacy, inkwell has blocked remote content in this message.';
  };
  try {
    const metadata = await info();
    if (!current() || text) return;
    origins = metadata.origins.slice(0, 50);
    origins.forEach((origin, index) => {
      const option = document.createElement('option');
      option.value = 'origin-' + index;
      option.textContent = 'Load images from ' + origin + '…';
      menu.append(option);
    });
    menu.querySelector('[value=all]').disabled = !origins.length;
  } catch (error) {
    if (current()) banner.textContent = 'Remote content remains blocked. ' + error.message;
  }
};
