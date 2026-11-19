'use strict';
window.InkwellDestinationPicker = (input, choices, value, { query, onQuery, onPick }) => {
  const counts = new Map();
  for (const [, name] of choices) {
    const key = name.toLocaleLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  choices = choices.map(([id, name]) => [
    id,
    counts.get(name.toLocaleLowerCase()) > 1 ? `${name} [${id}]` : name,
  ]);
  const list = document.createElement('div');
  list.className = 'destination-options';
  list.id = 'destination-options-' + input.dataset.destination;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Matching folders');
  list.hidden = true;
  input.after(list);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('aria-expanded', 'false');
  input.value =
    query ??
    choices.find(([id]) => id === value)?.[1] ??
    (value ? `Missing folder (${value})` : '');
  input.title =
    'Type a folder name or path; use arrows and Enter to select. Ambiguous names require a selection.';
  input.setCustomValidity(value ? '' : 'Choose a matching folder');
  let matches = [],
    active = 0,
    chosen = !!value;
  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const pick = (index) => {
    const item = matches[index];
    if (!item) return;
    input.value = item[1];
    chosen = true;
    input.setCustomValidity('');
    onPick(item[0]);
    close();
  };
  const paint = () => {
    matches = choices
      .filter(([, name]) =>
        name.toLocaleLowerCase().includes(input.value.trim().toLocaleLowerCase()),
      )
      .slice(0, 30);
    active = Math.min(active, Math.max(0, matches.length - 1));
    list.replaceChildren();
    matches.forEach(([id, name], i) => {
      const option = document.createElement('div');
      option.id = list.id + '-' + i;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(i === active));
      option.textContent = name;
      option.title = name;
      option.onpointerdown = (e) => {
        e.preventDefault();
        pick(i);
      };
      option.onclick = () => pick(i);
      list.append(option);
    });
    const rect = input.getBoundingClientRect(),
      bounds = input.closest('#rule-editor').getBoundingClientRect(),
      scale = rect.width / (input.offsetWidth || 1),
      below = Math.min(innerHeight, bounds.bottom) - rect.bottom,
      above = rect.top - Math.max(0, bounds.top),
      up = below < 120 && above > below;
    list.style.top = up ? 'auto' : '100%';
    list.style.bottom = up ? '100%' : 'auto';
    list.style.maxHeight =
      Math.max(44, Math.min(220, (up ? above : below) / (scale || 1) - 8)) + 'px';
    list.hidden = !matches.length;
    input.setAttribute('aria-expanded', String(!!matches.length));
    if (matches.length) input.setAttribute('aria-activedescendant', list.children[active].id);
    else input.removeAttribute('aria-activedescendant');
  };
  input.oninput = () => {
    chosen = false;
    input.setCustomValidity('Choose a matching folder');
    onQuery(input.value);
    active = 0;
    paint();
    const exact = choices.filter(
      ([, name]) => name.toLocaleLowerCase() === input.value.trim().toLocaleLowerCase(),
    );
    if (exact.length === 1) {
      chosen = true;
      input.setCustomValidity('');
      onPick(exact[0][0]);
    }
  };
  input.onfocus = () => {
    input.select();
    paint();
  };
  input.onkeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      if (list.hidden) paint();
      else {
        active =
          (active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) %
          Math.max(matches.length, 1);
        paint();
        list.children[active]?.scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (!list.hidden) pick(active);
    }
  };
  input.onblur = () => {
    if (!chosen && matches.length === 1 && input.value.trim()) pick(0);
    close();
  };
};
