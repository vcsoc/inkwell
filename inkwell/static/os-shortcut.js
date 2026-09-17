'use strict';
window.InkwellOsShortcutPanel = (root) => {
  const section = document.createElement('section');
  section.className = 'card';
  section.innerHTML =
    '<h2>Omarchy launch shortcut</h2><p>Optionally launch Inkwell with <strong>Super + I</strong>, even when it is closed. This computer only; unrelated to the in-app shortcuts above.</p><p class="fine-print">Changes only your user bindings.lua, with a backup. Existing Super+I bindings are never overwritten. No autostart or default email application changes. Disable this option before uninstalling Inkwell.</p><button type="button" class="secondary" id="os-shortcut-toggle" disabled>Enable Super+I</button><p id="os-shortcut-status" role="status">Checking desktop support…</p>';
  root.append(section);
  const button = section.querySelector('button'),
    status = section.querySelector('[role=status]'),
    bridge = window.inkwellOsShortcut;
  let state = null,
    busy = false;
  const paint = () => {
    if (!section.isConnected) return;
    button.textContent = state?.enabled ? 'Disable Super+I' : 'Enable Super+I';
    button.disabled = busy || !state?.available || !!(state.conflict && !state.enabled);
    status.textContent =
      state?.error ||
      (state?.conflict
        ? 'Super+I is assigned to ' + state.conflict + '. No existing binding will be overwritten.'
        : state?.enabled
          ? state.active
            ? 'Super+I is enabled for Inkwell.'
            : 'The binding is saved but is not active. Check your Hyprland configuration.'
          : 'Super+I is available. Enable it to launch Inkwell.');
  };
  if (!bridge) {
    state = { error: 'Available in the installed native app on Omarchy.' };
    paint();
    return;
  }
  bridge
    .status()
    .then((value) => {
      state = value;
      paint();
    })
    .catch((error) => {
      state = { error: error.message };
      paint();
    });
  button.onclick = async () => {
    if (busy || !state?.available || (state.conflict && !state.enabled)) return;
    busy = true;
    paint();
    try {
      state = await (state.enabled ? bridge.disable() : bridge.enable());
    } catch (error) {
      try {
        state = await bridge.status();
      } catch {
        state = { available: false };
      }
      state.error = error.message;
    } finally {
      busy = false;
      paint();
    }
  };
};
