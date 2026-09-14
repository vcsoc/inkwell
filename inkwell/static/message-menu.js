'use strict';
window.InkwellMessageMenu = (onSelect, onError) => {
  const menu = document.getElementById('message-menu');
  const allItems = [...menu.querySelectorAll('[role="menuitem"]')];
  let items = allItems;
  let messageId = null,
    trigger = null;
  function close(restoreFocus = false) {
    menu.classList.add('hidden');
    if (trigger?.matches('[data-more],#reader-menu'))
      trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
    messageId = null;
  }
  function show(id, element, x, y) {
    close();
    messageId = id;
    trigger = element;
    if (trigger.matches('[data-more],#reader-menu')) trigger.setAttribute('aria-expanded', 'true');
    menu.classList.remove('hidden');
    const scale = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const bottom = window.innerWidth / scale <= 760 ? 80 : 8;
    menu.style.maxWidth = (window.innerWidth - 16) / scale + 'px';
    menu.style.maxHeight = (window.innerHeight - bottom - 16) / scale + 'px';
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) / scale + 'px';
    menu.style.top =
      Math.max(8, Math.min(y, window.innerHeight - rect.height - bottom)) / scale + 'px';
    menu.scrollTop = 0;
    items = allItems.filter((item) => !item.hidden);
    items[0].focus({ preventScroll: true });
  }
  allItems.forEach((item) =>
    item.addEventListener('click', () => {
      const id = messageId;
      close();
      if (id !== null)
        Promise.resolve(onSelect(item.dataset.action || item.dataset.collection, id)).catch(
          (error) => onError(error.message),
        );
    }),
  );
  menu.addEventListener('keydown', (event) => {
    const index = items.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') close(true);
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!menu.contains(event.target)) close();
  });
  document.addEventListener('focusin', (event) => {
    if (!menu.classList.contains('hidden') && !menu.contains(event.target)) close();
  });
  window.addEventListener('resize', () => close());
  window.addEventListener(
    'scroll',
    (event) => {
      if (!menu.contains(event.target)) close();
    },
    true,
  );
  return { show, close };
};
