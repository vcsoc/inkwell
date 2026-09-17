'use strict';
window.addEventListener('resize', () => {
  document
    .querySelectorAll('.theme-color-popup:popover-open')
    .forEach((popup) => popup.hidePopover());
});
window.InkwellColorEditor = (form, colors) => {
  const updates = [];
  for (const [key, label] of Object.entries(colors)) {
    const input = form.elements[key];
    input.id = input.id || 'theme-color-input-' + key;
    input.closest('label').htmlFor = input.id;
    const row = document.createElement('div');
    row.className = 'field theme-color-input';
    input.after(row);
    row.append(input);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-color-trigger';
    button.setAttribute('aria-label', 'Choose ' + label.toLowerCase() + ' color');
    button.title = 'Choose ' + label.toLowerCase() + ' color';
    button.innerHTML =
      '<span class="color-swatch" aria-hidden="true"></span><span aria-hidden="true">▾</span>';
    // Keep interactive controls outside the hex field's label.
    input.closest('.color-field').append(row);
    row.append(button);
    const popup = document.createElement('div');
    popup.className = 'theme-color-popup';
    popup.id = 'theme-color-popup-' + key;
    popup.setAttribute('popover', 'auto');
    popup.setAttribute('role', 'group');
    popup.setAttribute('aria-label', label + ' color picker');
    input.closest('.color-field').append(popup);
    button.popoverTargetElement = popup;
    button.setAttribute('aria-controls', popup.id);
    button.setAttribute('aria-expanded', 'false');
    const update = InkwellTagColorPicker(form, {
      input,
      label: label + ' color',
      mount: popup,
      colors: [
        '#ffffff',
        '#000000',
        '#151a20',
        '#999999',
        '#486b54',
        '#9bcbb2',
        '#2664a0',
        '#ffdc60',
        '#ac4c45',
        '#ef4444',
        '#f97316',
        '#22c55e',
        '#14b8a6',
        '#06b6d4',
        '#6366f1',
        '#a855f7',
        '#ec4899',
        '#c7d2fe',
      ],
    });
    popup.querySelector('details').open = true;
    popup.querySelector('summary').hidden = true;
    popup.querySelector('small').textContent =
      'Drag to choose. Arrow keys adjust saturation and brightness; Shift makes larger adjustments.';
    popup.addEventListener('beforetoggle', (event) => {
      button.setAttribute('aria-expanded', String(event.newState === 'open'));
      if (event.newState !== 'open') return;
      const zoom = Number(getComputedStyle(document.documentElement).zoom) || 1;
      const rect = button.getBoundingClientRect();
      const box = { right: rect.right / zoom, top: rect.top / zoom, bottom: rect.bottom / zoom };
      const viewportWidth = window.innerWidth / zoom;
      const viewportHeight = window.innerHeight / zoom;
      const width = Math.min(320, viewportWidth - 16);
      const below = viewportHeight - box.bottom;
      const above = box.top;
      const upwards = below < 460 && above > below;
      const height = Math.max(60, Math.min(460, (upwards ? above : below) - 14));
      popup.style.width = width + 'px';
      popup.style.maxHeight = height + 'px';
      popup.style.left = Math.max(8, Math.min(box.right - width, viewportWidth - width - 8)) + 'px';
      popup.style.top = Math.max(8, upwards ? box.top - height - 6 : box.bottom + 6) + 'px';
    });
    updates.push(() => {
      update();
      if (/^#[0-9a-f]{6}$/i.test(input.value))
        button.querySelector('.color-swatch').style.backgroundColor = input.value;
    });
  }
  return () => updates.forEach((update) => update());
};
