'use strict';
window.InkwellMessageMenu = (onSelect, onError) => {
  const menu = document.getElementById('message-menu');
  const controls = new Map(
    [...menu.querySelectorAll('button')].map((b) => [b.dataset.action || b.dataset.collection, b]),
  );
  const shortLabels = {
    open: 'Open',
    tags: 'Tags…',
    read: 'Read',
    unread: 'Unread',
    star: 'Star',
    unstar: 'Unstar',
    move: 'Move…',
    archive: 'Archive',
    restore: 'Restore',
    trash: 'Trash',
    delete: 'Delete permanently',
    contact: 'Add contact',
    copy: 'Copy address',
    save: 'Save as text',
    write: 'Write to sender',
    sender: 'Same sender',
    organisation: 'Same domain',
    subject: 'Same subject',
    appearance: 'Light / dark reader',
  };
  for (const [key, label] of Object.entries(shortLabels)) {
    const b = controls.get(key);
    b.setAttribute('aria-label', b.textContent.trim());
    b.title = b.textContent.trim();
    b.textContent = label;
  }
  menu.replaceChildren();
  const main = document.createElement('div');
  main.className = 'menu-root';
  menu.append(main);
  const groups = [
    ['filing', 'File', ['move', 'archive', 'restore', 'trash', 'delete']],
    ['mark', 'Mark', ['read', 'unread', 'flag', 'unflag', 'star', 'unstar']],
    ['find', 'Find related', ['sender', 'organisation', 'subject']],
    [
      'more',
      'More actions',
      ['calendar-invite', 'write', 'contact', 'copy', 'save', 'save-eml', 'appearance'],
    ],
  ];
  for (const key of ['open', 'reply', 'forward', 'apply-rule', 'not-junk', 'tags'])
    main.append(controls.get(key));
  const panels = new Map();
  for (const [key, label, actions] of groups) {
    const button = document.createElement('button');
    button.type = 'button';
    button.role = 'menuitem';
    button.tabIndex = -1;
    button.textContent = label;
    button.dataset.submenu = key;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'message-sub-' + key);
    main.append(button);
    const panel = document.createElement('div');
    panel.className = 'submenu-panel';
    panel.id = 'message-sub-' + key;
    panel.role = 'menu';
    panel.setAttribute('aria-label', label);
    panel.hidden = true;
    const back = document.createElement('button');
    back.type = 'button';
    back.role = 'menuitem';
    back.tabIndex = -1;
    back.textContent = '← Back';
    back.className = 'submenu-back';
    back.dataset.back = 'true';
    panel.append(back);
    for (const action of actions) panel.append(controls.get(action));
    menu.append(panel);
    panels.set(key, { button, panel });
  }
  let messageId = null,
    trigger = null,
    opened = null,
    anchor = { x: 8, y: 8 };
  const compact = () => matchMedia('(pointer: coarse), (max-width: 760px)').matches;
  const visibleItems = (panel) =>
    [...panel.querySelectorAll(':scope > [role="menuitem"]')].filter(
      (b) => !b.hidden && !b.disabled && b.getClientRects().length,
    );
  const scale = () => parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  function place(element, x, y) {
    const z = scale(),
      bottom = Math.max(
        8,
        (document.querySelector('.mobile-tabs')?.getBoundingClientRect().height || 0) + 8,
      );
    element.style.maxWidth = (innerWidth - 16) / z + 'px';
    element.style.maxHeight = Math.max(80, innerHeight - bottom - 16) / z + 'px';
    const r = element.getBoundingClientRect();
    element.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) / z + 'px';
    element.style.top = Math.max(8, Math.min(y, innerHeight - r.height - bottom)) / z + 'px';
  }
  function closeSub(focus = false) {
    if (!opened) return;
    const { button, panel } = opened;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    main.hidden = false;
    opened = null;
    if (!menu.classList.contains('hidden')) place(menu, anchor.x, anchor.y);
    if (focus) button.focus({ preventScroll: true });
  }
  function close(focus = false) {
    menu.classList.add('hidden');
    closeSub();
    if (trigger?.matches('[data-more],#reader-menu'))
      trigger.setAttribute('aria-expanded', 'false');
    if (focus && trigger?.isConnected) trigger.focus({ preventScroll: true });
    messageId = null;
  }
  function openSub(button, focus = true) {
    if (opened?.button === button) {
      if (focus) visibleItems(opened.panel)[0]?.focus({ preventScroll: true });
      return;
    }
    closeSub();
    opened = panels.get(button.dataset.submenu);
    const { panel } = opened;
    button.setAttribute('aria-expanded', 'true');
    panel.hidden = false;
    panel.scrollTop = 0;
    if (compact()) {
      main.hidden = true;
      panel.style.position = 'static';
      panel.style.maxWidth = '';
      panel.style.maxHeight = '';
      place(menu, anchor.x, anchor.y);
    } else {
      panel.style.position = 'fixed';
      const r = button.getBoundingClientRect(),
        base = menu.getBoundingClientRect();
      place(panel, base.right - 3, r.top);
      const width = panel.getBoundingClientRect().width;
      if (base.right + width > innerWidth - 8) place(panel, base.left - width + 3, r.top);
    }
    if (focus) visibleItems(panel)[0]?.focus({ preventScroll: true });
  }
  function show(id, element, x, y) {
    close();
    messageId = id;
    trigger = element;
    if (trigger.matches('[data-more],#reader-menu')) trigger.setAttribute('aria-expanded', 'true');
    menu.classList.remove('hidden');
    main.hidden = false;
    place(menu, x, y);
    menu.scrollTop = 0;
    const r = menu.getBoundingClientRect();
    anchor = { x: r.left, y: r.top };
    visibleItems(main)[0]?.focus({ preventScroll: true });
  }
  menu.addEventListener('click', (event) => {
    const b = event.target.closest('[role="menuitem"]');
    if (!b) return;
    if (b.dataset.submenu) {
      openSub(b);
      return;
    }
    if (b.dataset.back) {
      closeSub(true);
      return;
    }
    const id = messageId;
    close(true);
    if (id !== null)
      Promise.resolve(onSelect(b.dataset.action || b.dataset.collection, id)).catch((e) =>
        onError(e.message),
      );
  });
  menu.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || compact() || !(event.movementX || event.movementY)) return;
    const b = event.target.closest('[role="menuitem"]');
    if (b?.parentElement !== main) return;
    if (b.dataset.submenu) openSub(b, false);
    else closeSub();
  });
  menu.addEventListener('keydown', (event) => {
    const b = document.activeElement,
      panel = b.closest('.submenu-panel') || main,
      items = visibleItems(panel),
      index = items.indexOf(b);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (opened) closeSub(true);
      else close(true);
    } else if (event.key === 'Tab') close(true);
    else if (event.key === 'ArrowRight' && b.dataset.submenu) {
      event.preventDefault();
      openSub(b);
    } else if (event.key === 'ArrowLeft' && opened) {
      event.preventDefault();
      closeSub(true);
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!menu.contains(e.target)) close();
  });
  document.addEventListener('focusin', (e) => {
    if (!menu.classList.contains('hidden') && !menu.contains(e.target)) close();
  });
  window.addEventListener('resize', () => close());
  for (const type of ['wheel', 'touchmove'])
    window.addEventListener(
      type,
      (e) => {
        if (!menu.contains(e.target)) close();
      },
      { capture: true, passive: true },
    );
  return { show, close };
};
