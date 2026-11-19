'use strict';
window.InkwellAddressAutocomplete = (root, api) => {
  root.querySelectorAll('input[type=email],input[data-email-addresses]').forEach((input) => {
    if (input.dataset.addressBound) return;
    input.dataset.addressBound = 'true';
    input.autocomplete = 'off';
    input.removeAttribute('list');
    input.setAttribute(
      'aria-label',
      input.getAttribute('aria-label') ||
        input.closest('label')?.firstChild?.textContent.trim() ||
        'Email address',
    );
    const list = document.createElement('div');
    list.className = 'address-suggestions';
    list.id = 'addresses-' + crypto.randomUUID();
    list.hidden = true;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Known email addresses');
    input.after(list);
    input.closest('.field')?.classList.add('address-field');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', list.id);
    input.setAttribute('aria-expanded', 'false');
    let timer,
      sequence = 0,
      active = -1,
      items = [],
      abort;
    const token = () => {
      if (!input.hasAttribute('data-email-addresses')) return { start: 0, end: input.value.length };
      const cursor = input.selectionStart ?? input.value.length;
      let start = 0,
        end = input.value.length,
        quoted = false,
        escaped = false;
      for (let i = 0; i < input.value.length; i++) {
        const c = input.value[i];
        if (c === '"' && !escaped) quoted = !quoted;
        if (!quoted && (c === ',' || c === ';')) {
          if (i < cursor) start = i + 1;
          else {
            end = i;
            break;
          }
        }
        escaped = c === '\\' && !escaped;
      }
      return { start, end };
    };
    const close = () => {
      clearTimeout(timer);
      sequence++;
      abort?.abort();
      list.hidden = true;
      active = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    };
    const highlight = () => {
      [...list.children].forEach((b, i) => b.setAttribute('aria-selected', String(i === active)));
      if (active >= 0) {
        input.setAttribute('aria-activedescendant', list.children[active].id);
        list.children[active].scrollIntoView({ block: 'nearest' });
      } else input.removeAttribute('aria-activedescendant');
    };
    const select = (index) => {
      const chosen = items[index];
      if (!chosen) return;
      const { start, end } = token();
      const prefix = input.value.slice(0, start);
      const inserted = (start ? ' ' : '') + chosen.address;
      input.value = prefix + inserted + input.value.slice(end);
      input.focus();
      if (input.type !== 'email')
        input.setSelectionRange(start + inserted.length, start + inserted.length);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      close();
    };
    const load = async () => {
      const current = ++sequence;
      abort?.abort();
      abort = new AbortController();
      const { start, end } = token();
      try {
        const fresh = await api(
          '/addresses?q=' + encodeURIComponent(input.value.slice(start, end).trim().slice(0, 254)),
          { signal: abort.signal },
        );
        if (current !== sequence || !input.isConnected || document.activeElement !== input) return;
        items = fresh;
        active = -1;
        list.replaceChildren();
        input.removeAttribute('aria-activedescendant');
        for (const [i, item] of items.entries()) {
          const b = document.createElement('button');
          b.type = 'button';
          b.tabIndex = -1;
          b.id = list.id + '-' + i;
          b.setAttribute('role', 'option');
          b.setAttribute('aria-selected', 'false');
          const address = document.createElement('strong');
          address.textContent = item.address;
          b.append(address);
          if (item.name) {
            const name = document.createElement('small');
            name.textContent = item.name;
            b.append(name);
          }
          b.onpointerdown = (e) => e.preventDefault();
          b.onclick = () => select(i);
          list.append(b);
        }
        list.hidden = !items.length;
        input.setAttribute('aria-expanded', String(!!items.length));
      } catch (error) {
        if (error.name !== 'AbortError' && current === sequence) close();
      }
    };
    input.addEventListener('input', () => {
      close();
      timer = setTimeout(load, 150);
    });
    input.addEventListener('focus', () => void load());
    input.addEventListener('blur', close);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !list.hidden) {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        if (list.hidden) {
          void load();
          return;
        }
        active = (active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        highlight();
      } else if (event.key === 'Enter' && active >= 0 && !list.hidden) {
        event.preventDefault();
        select(active);
      } else if (event.key === 'Tab') close();
    });
  });
};
