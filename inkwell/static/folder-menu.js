'use strict';
window.InkwellFolderMenu = (navigation, create, onError) => {
  const menu = document.createElement('div');
  menu.id = 'folder-menu';
  menu.className = 'folder-context-menu hidden';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Folder actions');
  const item = document.createElement('button');
  item.type = 'button';
  item.textContent = 'New subfolder…';
  item.setAttribute('role', 'menuitem');
  menu.append(item);
  document.body.append(menu);
  let trigger = null,
    parent = null,
    timer = null,
    suppressClick = false;
  const target = (e) => {
    const b = e.target.closest('[data-view],[data-remote-folder]');
    if (!b || !navigation.contains(b)) return null;
    const key = b.dataset.remoteFolder ? 'remote:' + b.dataset.remoteFolder : b.dataset.view;
    return /^(inbox|archive|sent|drafts|trash|local-[1-9][0-9]*|remote:[1-9][0-9]*)$/.test(key)
      ? { button: b, key }
      : null;
  };
  const close = (focus = false) => {
    menu.classList.add('hidden');
    if (focus && trigger?.isConnected) trigger.focus({ preventScroll: true });
  };
  const show = (t, x, y) => {
    trigger = t.button;
    parent = { key: t.key, name: trigger.getAttribute('aria-label') || trigger.textContent.trim() };
    menu.classList.remove('hidden');
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    menu.style.maxWidth = Math.max(1, (innerWidth - 16) / zoom) + 'px';
    menu.style.maxHeight = Math.max(1, (innerHeight - 16) / zoom) + 'px';
    menu.style.left = '0px';
    menu.style.top = '0px';
    const box = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, innerWidth - box.width - 8)) / zoom + 'px';
    menu.style.top = Math.max(8, Math.min(y, innerHeight - box.height - 8)) / zoom + 'px';
    item.focus({ preventScroll: true });
  };
  navigation.addEventListener('contextmenu', (e) => {
    const t = target(e);
    if (!t) return;
    e.preventDefault();
    clearTimeout(timer);
    show(t, e.clientX, e.clientY);
  });
  navigation.addEventListener('keydown', (e) => {
    if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
    const t = target(e);
    if (!t) return;
    e.preventDefault();
    const r = t.button.getBoundingClientRect();
    show(t, r.left, r.bottom);
  });
  let touchStart = null;
  navigation.addEventListener('pointerdown', (e) => {
    suppressClick = false;
    touchStart = { x: e.clientX, y: e.clientY };
    if (e.pointerType === 'mouse') return;
    const t = target(e);
    if (!t) return;
    clearTimeout(timer);
    const x = e.clientX,
      y = e.clientY;
    timer = setTimeout(() => {
      suppressClick = true;
      show(t, x, y);
    }, 500);
  });
  for (const type of ['pointerup', 'pointercancel'])
    navigation.addEventListener(type, () => clearTimeout(timer));
  navigation.addEventListener('pointermove', (e) => {
    if (touchStart && Math.hypot(e.clientX - touchStart.x, e.clientY - touchStart.y) > 10)
      clearTimeout(timer);
  });
  navigation.addEventListener(
    'click',
    (e) => {
      if (suppressClick) {
        suppressClick = false;
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  item.onclick = () => {
    const selected = parent;
    close(true);
    Promise.resolve(create(selected)).catch((e) => onError(e.message));
  };
  menu.onkeydown = (e) => {
    e.stopPropagation();
    if (['Escape', 'Tab'].includes(e.key)) {
      if (e.key === 'Escape') e.preventDefault();
      close(true);
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      item.focus();
    }
  };
  document.addEventListener('pointerdown', (e) => {
    if (!menu.contains(e.target)) close();
  });
  document.addEventListener('contextmenu', (e) => {
    if (!navigation.contains(e.target)) close();
  });
  document.addEventListener(
    'scroll',
    (e) => {
      if (!menu.contains(e.target)) close();
    },
    true,
  );
  window.addEventListener('resize', () => close());
  window.addEventListener('hashchange', () => close());
};
