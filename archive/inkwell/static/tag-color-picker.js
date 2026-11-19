'use strict';
window.InkwellTagColorPicker = (form, options = {}) => {
  const input = options.input || form.elements.color;
  const label = options.label || 'Tag color';
  const panel = document.createElement('details');
  panel.className = 'tag-color-picker';
  panel.innerHTML =
    '<summary aria-label="Choose tag color"><span class="tag-picker-swatch"></span>Choose color…</summary><div class="tag-color-controls"><div class="tag-color-plane" tabindex="0" role="slider" aria-label="Tag color saturation and brightness" aria-valuemin="0" aria-valuemax="100"><span class="tag-color-point"></span></div><label class="field">Hue<input type="range" min="0" max="359" step="1" aria-label="Tag color hue" class="tag-color-hue"></label><div class="tag-palette" role="group" aria-label="Tag color palette"></div><small>Choose a palette color or drag in the color area. Arrow keys adjust saturation and brightness. Hex entry is also available above.</small></div>';
  if (options.mount) options.mount.append(panel);
  else input.closest('.color-field').after(panel);
  for (const element of panel.querySelectorAll('[aria-label]')) {
    element.setAttribute(
      'aria-label',
      element.getAttribute('aria-label').replace('Tag color', label),
    );
  }
  const plane = panel.querySelector('.tag-color-plane'),
    point = panel.querySelector('.tag-color-point'),
    hue = panel.querySelector('.tag-color-hue');
  let h = 0,
    s = 0,
    v = 0,
    last = '',
    internal = false,
    pointer = null;
  const rgb = () => {
    const chroma = v * s,
      x = chroma * (1 - Math.abs(((h / 60) % 2) - 1)),
      m = v - chroma;
    const values =
      h < 60
        ? [chroma, x, 0]
        : h < 120
          ? [x, chroma, 0]
          : h < 180
            ? [0, chroma, x]
            : h < 240
              ? [0, x, chroma]
              : h < 300
                ? [x, 0, chroma]
                : [chroma, 0, x];
    return (
      '#' +
      values
        .map((n) =>
          Math.round((n + m) * 255)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    );
  };
  const update = () => {
    const color = input.value.toLowerCase();
    if (!internal && color !== last && /^#[0-9a-f]{6}$/.test(color)) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b),
        min = Math.min(r, g, b),
        delta = max - min;
      if (delta)
        h =
          ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) *
            60 +
            360) %
          360;
      s = max ? delta / max : 0;
      v = max;
      last = color;
    }
    panel.querySelector('.tag-picker-swatch').style.backgroundColor = rgb();
    plane.style.backgroundColor = `hsl(${h} 100% 50%)`;
    point.style.left = s * 100 + '%';
    point.style.top = (1 - v) * 100 + '%';
    point.style.backgroundColor = rgb();
    plane.setAttribute('aria-valuenow', String(Math.round(s * 100)));
    plane.setAttribute(
      'aria-valuetext',
      `Saturation ${Math.round(s * 100)}%, brightness ${Math.round(v * 100)}%, ${rgb()}`,
    );
    hue.value = String(h);
    panel
      .querySelectorAll('[data-color]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === color)));
  };
  const emit = () => {
    internal = true;
    input.value = rgb();
    last = input.value;
    update();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    internal = false;
  };
  const choose = (event) => {
    const box = plane.getBoundingClientRect();
    s = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
    v = 1 - Math.max(0, Math.min(1, (event.clientY - box.top) / box.height));
    emit();
  };
  plane.onpointerdown = (event) => {
    if (event.button !== 0) return;
    pointer = event.pointerId;
    plane.setPointerCapture(pointer);
    plane.focus();
    choose(event);
  };
  plane.onpointermove = (event) => {
    if (pointer === event.pointerId) choose(event);
  };
  plane.onpointerup = plane.onpointercancel = () => {
    pointer = null;
  };
  plane.onkeydown = (event) => {
    const step = event.shiftKey ? 0.1 : 0.01;
    if (event.key === 'ArrowLeft') s = Math.max(0, s - step);
    else if (event.key === 'ArrowRight') s = Math.min(1, s + step);
    else if (event.key === 'ArrowUp') v = Math.min(1, v + step);
    else if (event.key === 'ArrowDown') v = Math.max(0, v - step);
    else return;
    event.preventDefault();
    emit();
  };
  hue.oninput = () => {
    h = Number(hue.value);
    emit();
  };
  const colors = options.colors || [
    '#ffffff',
    '#dddddd',
    '#999999',
    '#555555',
    '#151a20',
    '#000000',
    '#ac4c45',
    '#ef4444',
    '#f97316',
    '#f59e0b',
    '#ffdc60',
    '#fef08a',
    '#84cc16',
    '#22c55e',
    '#486b54',
    '#9bcbb2',
    '#14b8a6',
    '#06b6d4',
    '#2664a0',
    '#3b82f6',
    '#6366f1',
    '#8b5cf6',
    '#a855f7',
    '#d946ef',
    '#ec4899',
    '#f43f5e',
    '#7f1d1d',
    '#78350f',
    '#14532d',
    '#164e63',
    '#1e3a8a',
    '#581c87',
    '#831843',
    '#fbcfe8',
    '#c7d2fe',
    '#ccfbf1',
  ];
  for (const color of colors) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.color = color;
    b.style.backgroundColor = color;
    b.title = color;
    b.setAttribute('aria-label', 'Set ' + label + ' to ' + color);
    b.onclick = () => {
      input.value = color;
      update();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    panel.querySelector('.tag-palette').append(b);
  }
  update();
  return update;
};
