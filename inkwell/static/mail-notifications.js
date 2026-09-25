'use strict';
// Audio is opt-in, local, and played at most once after an entire sync job finishes.
window.InkwellMailNotifications = ({ api, toast, pinnedFolders }) => {
  let settings = { enabled: false, scope: 'all', senders: [], custom_sound: false };
  let lastId = 0;
  const bell =
    '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9ZM10 21h4"/></svg>';
  const audio = new Audio();
  audio.preload = 'auto';
  const menu = document.createElement('div');
  menu.className = 'notification-menu folder-context-menu hidden';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Mail sound options');
  menu.innerHTML =
    '<button role="menuitemradio" data-scope="all">For all new mail</button><button role="menuitemradio" data-scope="pinned">For pinned folders only</button><button role="menuitemradio" data-scope="senders">For selected senders only</button><button role="menuitem" data-sound="choose">Choose WAV or MP3 sound…</button><button role="menuitem" data-sound="reset">Use default sound</button>';
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.wav,.mp3,audio/wav,audio/mpeg';
  file.hidden = true;
  document.body.append(menu, file);
  const buttons = () => [...document.querySelectorAll('#notify-bell, #notify-bell-top')];
  const paint = () => {
    for (const button of buttons()) {
      button.innerHTML = bell;
      button.setAttribute('aria-pressed', String(settings.enabled));
      button.title = settings.enabled
        ? `New mail sound on · ${settings.scope === 'pinned' ? 'pinned folders' : settings.scope === 'senders' ? 'selected senders' : 'all mail'} (right-click for options)`
        : 'New mail sound off (right-click for options)';
    }
    document.querySelectorAll('.sender-bell').forEach((button) => {
      const on = settings.senders.includes(button.dataset.senderKey);
      button.setAttribute('aria-pressed', String(on));
      button.title = on ? 'Stop notifying for this sender' : 'Notify for this sender';
      button.setAttribute('aria-label', button.title);
    });
  };
  async function persist(next) {
    const value = await api('/mail-notifications', { method: 'PUT', body: next });
    settings = { ...settings, ...value };
    paint();
  }
  async function uploadSound(selected) {
    const format = selected.name.toLowerCase().endsWith('.wav')
      ? 'wav'
      : selected.name.toLowerCase().endsWith('.mp3')
        ? 'mp3'
        : '';
    if (!format || !selected.size || selected.size > 2_000_000)
      throw Error('Choose a WAV or MP3 smaller than 2 MB.');
    const response = await fetch(
      '/api/mail-notifications/sounds?format=' +
        format +
        '&name=' +
        encodeURIComponent(selected.name),
      {
        method: 'POST',
        headers: { 'X-Inkwell': '1', 'Content-Type': 'application/octet-stream' },
        body: selected,
        credentials: 'same-origin',
      },
    );
    if (!response.ok) throw Error((await response.json()).detail || 'Sound could not be saved');
    settings.custom_sound = true;
    return format;
  }
  async function resetSound() {
    await api('/mail-notifications/sounds/default/activate', { method: 'PUT' });
    settings.custom_sound = false;
  }
  async function previewSound(id = 'default') {
    const sample = new Audio(
      '/api/mail-notifications/sounds/' + encodeURIComponent(id) + '/preview?t=' + Date.now(),
    );
    await sample.play();
  }
  async function chooseSound(id) {
    await api('/mail-notifications/sounds/' + encodeURIComponent(id) + '/activate', {
      method: 'PUT',
    });
    settings.custom_sound = id !== 'default';
  }
  async function removeSound(id) {
    await api('/mail-notifications/sounds/' + encodeURIComponent(id), { method: 'DELETE' });
    settings.custom_sound = (await api('/mail-notifications')).custom_sound;
  }
  const close = () => menu.classList.add('hidden');
  function show(button) {
    for (const choice of menu.querySelectorAll('[data-scope]'))
      choice.setAttribute('aria-checked', String(choice.dataset.scope === settings.scope));
    menu.querySelector('[data-sound=reset]').hidden = !settings.custom_sound;
    menu.classList.remove('hidden');
    const rect = button.getBoundingClientRect();
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    menu.style.left =
      Math.max(8, Math.min(rect.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8)) /
        zoom +
      'px';
    menu.style.top =
      Math.max(8, Math.min(rect.top, innerHeight - menu.offsetHeight - 8)) / zoom + 'px';
    menu.querySelector('button').focus({ preventScroll: true });
  }
  for (const button of buttons()) {
    let hold = null,
      held = false;
    button.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'mouse')
        hold = setTimeout(() => {
          held = true;
          show(button);
        }, 500);
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'])
      button.addEventListener(type, () => clearTimeout(hold));
    button.addEventListener('click', async (event) => {
      if (held) {
        held = false;
        event.preventDefault();
        return;
      }
      try {
        await persist({
          enabled: !settings.enabled,
          scope: settings.scope,
          senders: settings.senders,
        });
      } catch (error) {
        toast(error.message);
      }
    });
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      show(button);
    });
    button.addEventListener('keydown', (event) => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        show(button);
      }
    });
  }
  menu.addEventListener('click', async (event) => {
    const option = event.target.closest('button');
    if (!option) return;
    close();
    if (option.dataset.sound === 'choose') return file.click();
    try {
      if (option.dataset.scope)
        await persist({
          enabled: settings.enabled,
          scope: option.dataset.scope,
          senders: settings.senders,
        });
      if (option.dataset.sound === 'reset') {
        await resetSound();
        toast('Default sound restored.');
      }
    } catch (error) {
      toast(error.message);
    }
  });
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' || event.key === 'Tab') close();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!menu.contains(event.target) && !buttons().some((button) => button.contains(event.target)))
      close();
  });
  file.addEventListener('change', async () => {
    const selected = file.files?.[0];
    file.value = '';
    if (!selected) return;
    try {
      await uploadSound(selected);
      toast('Custom new-mail sound saved.');
    } catch (error) {
      toast(error.message);
    }
  });
  return {
    async initialize() {
      settings = await api('/mail-notifications');
      lastId = settings.latest_id;
      paint();
    },
    get senders() {
      return settings.senders;
    },
    get current() {
      return { ...settings, senders: [...settings.senders] };
    },
    async refresh() {
      const latest = await api('/mail-notifications');
      settings = { ...settings, ...latest };
      paint();
      return this.current;
    },
    async update(options) {
      await persist({ enabled: options.enabled, scope: options.scope, senders: settings.senders });
      return this.current;
    },
    uploadSound,
    resetSound,
    previewSound,
    chooseSound,
    removeSound,
    listSounds: () => api('/mail-notifications/sounds'),
    get enabled() {
      return settings.enabled;
    },
    async toggleSender(key) {
      if (!key || !key.includes('@')) return;
      const senders = settings.senders.includes(key)
        ? settings.senders.filter((item) => item !== key)
        : [...settings.senders, key];
      await persist({ enabled: settings.enabled, scope: settings.scope, senders });
    },
    async completed() {
      const data = await api('/mail-notifications/candidates?after_id=' + lastId);
      lastId = data.latest_id; // Never replay a batch when settings change or polling resumes.
      if (!settings.enabled || !data.messages.length) return;
      const selected = data.messages.some(
        (message) =>
          settings.scope === 'all' ||
          (settings.scope === 'pinned' &&
            message.folders.some((folder) => pinnedFolders().includes(folder))) ||
          (settings.scope === 'senders' && settings.senders.includes(message.sender)),
      );
      if (!selected) return;
      audio.src = settings.custom_sound ? '/api/mail-notifications/sound' : '/static/new-mail.wav';
      try {
        await audio.play();
      } catch {
        /* Autoplay can be blocked until the user interacts. */
      }
    },
    paint,
  };
};
