'use strict';
window.InkwellColorEditor = (form, colors) => {
  const swatches = [
    '#ffffff',
    '#000000',
    '#486b54',
    '#9bcbb2',
    '#2664a0',
    '#ffdc60',
    '#ac4c45',
    '#151a20',
  ];
  for (const [key, label] of Object.entries(colors)) {
    const input = form.elements[key];
    const details = document.createElement('details');
    details.className = 'color-picker';
    const summary = document.createElement('summary');
    summary.textContent = 'Adjust ' + label.toLowerCase();
    const preview = document.createElement('span');
    preview.className = 'color-swatch';
    summary.prepend(preview);
    details.append(summary);
    for (const [index, channel] of ['Red', 'Green', 'Blue'].entries()) {
      const wrapper = document.createElement('label');
      wrapper.textContent = channel;
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = 0;
      slider.max = 255;
      slider.step = 1;
      slider.dataset.channel = index;
      slider.setAttribute('aria-label', label + ' ' + channel.toLowerCase());
      slider.addEventListener('input', () => {
        input.value =
          '#' +
          [...details.querySelectorAll('input[type=range]')]
            .map((s) => Number(s.value).toString(16).padStart(2, '0'))
            .join('');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      wrapper.append(slider);
      details.append(wrapper);
    }
    const palette = document.createElement('div');
    palette.className = 'color-palette';
    for (const color of swatches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.style.backgroundColor = color;
      button.setAttribute('aria-label', `Set ${label} to ${color}`);
      button.title = color;
      button.onclick = () => {
        input.value = color;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      palette.append(button);
    }
    details.append(palette);
    input.closest('.color-field').append(details);
  }
  return () => {
    for (const key of Object.keys(colors)) {
      const input = form.elements[key];
      if (!/^#[0-9a-f]{6}$/i.test(input.value)) continue;
      const picker = input.closest('.color-field').querySelector('.color-picker');
      picker.querySelector('.color-swatch').style.backgroundColor = input.value;
      picker.querySelectorAll('input[type=range]').forEach((slider, i) => {
        slider.value = parseInt(input.value.slice(1 + i * 2, 3 + i * 2), 16);
      });
    }
  };
};
