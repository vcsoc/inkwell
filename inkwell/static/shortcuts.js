'use strict';
window.InkwellHotkeys = {
  defaults: {
    sync: 'F9',
    compose: 'C',
    search: '/',
    delete: 'Delete',
    quick_filter: 'Ctrl+Shift+K',
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    zoom_in: 'Ctrl+=',
    zoom_out: 'Ctrl+-',
    zoom_reset: 'Ctrl+0',
  },
  labels: {
    sync: 'Check server mail',
    compose: 'Compose message',
    search: 'Focus mail search',
    delete: 'Delete selected local messages',
    quick_filter: 'Open quick filter',
    up: 'Navigate up / previous message',
    down: 'Navigate down / next message',
    left: 'Navigate left / parent pane',
    right: 'Navigate right / expand branch',
    zoom_in: 'Zoom in',
    zoom_out: 'Zoom out',
    zoom_reset: 'Reset zoom',
  },
  key(e) {
    let key = e.key;
    if (!key) return '';
    const plus = key === '+';
    if (plus) key = '=';
    if (key.length === 1) key = key.toUpperCase();
    return [
      e.ctrlKey || e.metaKey ? 'Ctrl' : '',
      e.altKey ? 'Alt' : '',
      e.shiftKey && !plus ? 'Shift' : '',
      key,
    ]
      .filter(Boolean)
      .join('+');
  },
  install({ getPreferences, actions, isModal, toast }) {
    const handle = (e, preview = false) => {
      if (e.defaultPrevented || e.isComposing || e.getModifierState?.('AltGraph')) return false;
      const action = Object.entries(getPreferences().shortcuts || this.defaults).find(
        ([, key]) => key && key === this.key(e),
      )?.[0];
      if (!action) return false;
      if (e.repeat && !['up', 'down', 'left', 'right'].includes(action)) return false;
      const target = preview
        ? document.querySelector('#reader iframe')
        : e.target instanceof Element
          ? e.target
          : document.activeElement;
      if (target?.closest('[role=menu],[role=listbox],[data-shortcut-capture]')) return false;
      const selectionBox =
        target?.matches('.select-message,#select-all-messages') &&
        ['delete', 'up', 'down', 'left', 'right'].includes(action);
      const editing =
        !selectionBox &&
        target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
      const nonText = /^F\d+$/.test(e.key) || e.ctrlKey || e.metaKey || e.altKey;
      const global = ['sync', 'zoom_in', 'zoom_out', 'zoom_reset'].includes(action);
      if ((editing || isModal()) && !(global && nonText)) return false;
      if (preview && ['up', 'down', 'left', 'right'].includes(action)) return false;
      try {
        const result = actions[action]?.(e, preview);
        if (result === false) return false;
        e.preventDefault?.();
        Promise.resolve(result).catch((error) => toast(error.message));
        return true;
      } catch (error) {
        toast(error.message);
        return true;
      }
    };
    document.addEventListener('focusin', (e) =>
      window.inkwellShortcuts?.capture(!!e.target.closest?.('[data-shortcut-capture]')),
    );
    document.addEventListener('keydown', (e) => handle(e));
    window.InkwellShortcutFromPreview = (e) => {
      if (document.activeElement?.matches('#reader iframe.html-message')) return handle(e, true);
      return false;
    };
    window.InkwellNativeShortcut = (e) => handle({ ...e, target: document.activeElement });
    return handle;
  },
  mount(root, { preferences, savePreferences, toast, esc }) {
    const values = { ...this.defaults, ...preferences.shortcuts };
    root.innerHTML = `<section class="card"><h2>Shortcuts</h2><p>Focus a field and press the shortcut you want. Ctrl also means Command on macOS. Clear a binding to disable it. Editing, menus and date pickers retain their normal keys; operating-system shortcuts may take precedence.</p><form id="shortcut-form">${Object.entries(
      this.labels,
    )
      .map(
        ([id, label]) =>
          `<div class="shortcut-setting"><label for="shortcut-${id}">${esc(label)}</label><span><input id="shortcut-${id}" readonly data-shortcut-capture="${id}" aria-label="${esc(label)} shortcut" value="${esc(values[id])}" placeholder="Not assigned"><button type="button" class="secondary" data-clear-shortcut="${id}" aria-label="Clear ${esc(label)} shortcut">×</button></span></div>`,
      )
      .join(
        '',
      )}<div class="form-actions"><button class="primary" type="submit">Save shortcuts</button><button class="secondary" type="button" id="reset-shortcuts">Reset defaults</button></div><p role="status" id="shortcut-status"></p></form></section>`;
    InkwellOsShortcutPanel(root);
    for (const input of root.querySelectorAll('[data-shortcut-capture]'))
      input.onkeydown = (e) => {
        if (e.key === 'Tab') return;
        e.preventDefault();
        e.stopPropagation();
        if (['Control', 'Meta', 'Alt', 'Shift', 'Escape'].includes(e.key)) return;
        input.value = this.key(e);
        values[input.dataset.shortcutCapture] = input.value;
      };
    for (const b of root.querySelectorAll('[data-clear-shortcut]'))
      b.onclick = () => {
        values[b.dataset.clearShortcut] = '';
        root.querySelector(`[data-shortcut-capture="${b.dataset.clearShortcut}"]`).value = '';
      };
    let saving = false;
    const save = async (v) => {
      if (saving) return;
      saving = true;
      const controls = [...root.querySelector('#shortcut-form').querySelectorAll('input,button')];
      controls.forEach((e) => (e.disabled = true));
      try {
        await savePreferences({ shortcuts: { ...v } });
        root.querySelector('#shortcut-status').textContent = 'Shortcuts saved.';
      } catch (error) {
        root.querySelector('#shortcut-status').textContent = error.message;
        toast(error.message);
      } finally {
        saving = false;
        controls.forEach((e) => (e.disabled = false));
      }
    };
    root.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      void save(values);
    };
    root.querySelector('#reset-shortcuts').onclick = async () => {
      Object.assign(values, this.defaults);
      for (const i of root.querySelectorAll('[data-shortcut-capture]'))
        i.value = values[i.dataset.shortcutCapture];
      await save(values);
    };
  },
};
