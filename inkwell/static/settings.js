'use strict';
window.InkwellSettings = (() => {
  const pages = [
    {
      id: 'shortcuts',
      name: 'Shortcuts',
      icon: '⌨',
      description: 'Customize keyboard navigation and mail shortcuts.',
    },
    {
      id: 'rules',
      name: 'Mail rules',
      icon: '⇢',
      description: 'Organize imported copies into local folders automatically.',
    },
    {
      id: 'layout',
      name: 'Layout',
      icon: '▤',
      description: 'Choose your default mail layout and reading pane.',
    },
    {
      id: 'forms',
      name: 'Forms',
      icon: '▧',
      description: 'Choose form style, HTML/text previews and interface scale.',
    },
    {
      id: 'theme',
      name: 'Theme studio',
      icon: '◐',
      description: 'Edit colors, typography, spacing and theme files.',
    },
    {
      id: 'mail',
      name: 'Mail accounts',
      icon: '✉',
      description: 'Connect and manage your email accounts.',
    },
    {
      id: 'notifications',
      name: 'Notifications',
      icon: '♬',
      description: 'Choose when new mail sounds and select a notification sound.',
    },
    {
      id: 'about',
      name: 'About',
      icon: 'ⓘ',
      description: 'Version, developer and project information.',
    },
    {
      id: 'assistant',
      name: 'AI assistant',
      icon: '✦',
      description: 'Configure cloud providers, subscriptions or local models.',
    },
    {
      id: 'privacy',
      name: 'Privacy & data',
      icon: '♧',
      description: 'Review privacy boundaries and explore sample data.',
    },
  ];
  async function mount(root, page, deps) {
    const {
      api,
      esc,
      field,
      textarea,
      on,
      toast,
      preferences,
      savePreferences,
      notifications,
      navigate,
      accountForm,
      loadDemo,
      accountsChanged,
      reload,
      isCurrent,
    } = deps;
    const selected = pages.find((p) => p.id === page);
    root.innerHTML = `<div class="settings-shell"><nav class="settings-nav" aria-label="Settings sections"><a href="#/settings" data-settings-page="overview" ${selected ? '' : 'aria-current="page"'}>All settings</a>${pages.map((p) => `<a href="#/settings/${p.id}" data-settings-page="${p.id}" ${p.id === page ? 'aria-current="page"' : ''}>${esc(p.name)}</a>`).join('')}</nav><section id="settings-content" class="settings-content" aria-label="${esc(selected?.name || 'All settings')}"></section></div>`;
    root.querySelectorAll('[data-settings-page]').forEach((link) =>
      on(link, 'click', (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        return navigate(link.dataset.settingsPage);
      }),
    );
    const content = root.querySelector('#settings-content');
    if (!selected) {
      content.innerHTML = `<div class="settings-overview">${pages.map((p) => `<a class="card settings-category" href="#/settings/${p.id}" data-category="${p.id}" aria-label="${esc(p.name)}"><span aria-hidden="true">${p.icon}</span><h2>${esc(p.name)}</h2><p>${esc(p.description)}</p><span class="category-arrow" aria-hidden="true">→</span></a>`).join('')}</div>`;
      content.querySelectorAll('[data-category]').forEach((link) =>
        on(link, 'click', (event) => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          return navigate(link.dataset.category);
        }),
      );
      return;
    }
    if (page === 'shortcuts') {
      InkwellHotkeys.mount(content, { preferences, savePreferences, toast, esc });
      return;
    }
    if (['layout', 'forms', 'theme'].includes(page)) {
      const themes = page === 'theme' ? await api('/preferences/themes') : [];
      if (!isCurrent() || !content.isConnected) return;
      InkwellAppearance.mount(content, preferences, savePreferences, toast, page, api, themes);
      return;
    }
    if (page === 'rules') {
      await InkwellRules(content, deps);
      return;
    }
    if (page === 'notifications') {
      const current = await notifications.refresh();
      if (!isCurrent() || !content.isConnected) return;
      content.innerHTML = `<section class="card" id="settings-notifications"><h2>New mail sound</h2><p>Play one sound after a completed sync batch with matching new mail. Sound is off by default; no sound plays while the app is closed.</p><form id="notification-settings"><label class="check-label"><input type="checkbox" name="enabled" ${current.enabled ? 'checked' : ''}> Enable new-mail sound</label><label class="field">Notify for<select name="scope" aria-label="Notification scope"><option value="all">All new mail</option><option value="pinned">Pinned folders only</option><option value="senders">Selected senders only</option></select></label><p class="fine-print">Pin folders in the sidebar or use the small bell beside a sender in the message list. Selected senders: ${current.senders.length}.</p><button class="primary" type="submit">Save notification settings</button></form><h3>Notification sound</h3><p id="notification-sound-choice" role="status"></p><div class="form-actions"><label class="secondary notification-file-label">Choose WAV or MP3<input id="notification-sound-file" type="file" accept=".wav,.mp3,audio/wav,audio/mpeg"></label><button class="secondary" type="button" id="notification-play">Play sound</button><button class="secondary" type="button" id="notification-reset">Use default sound</button></div><p class="fine-print">Inkwell includes a short chime. A custom sound is stored only on this computer (maximum 2 MB) and replaces the default until you reset it. Browser audio may require a click first.</p></section>`;
      const form = content.querySelector('#notification-settings');
      form.elements.scope.value = current.scope;
      let filename = '';
      const paintSound = () => {
        const custom = notifications.current.custom_sound;
        content.querySelector('#notification-sound-choice').textContent = custom
          ? `Custom notification sound${filename ? ': ' + filename : ' (WAV or MP3)'}`
          : 'Default: Inkwell chime';
        content.querySelector('#notification-reset').disabled = !custom;
      };
      paintSound();
      on(form, 'submit', async (event) => {
        event.preventDefault();
        await notifications.update({
          enabled: form.elements.enabled.checked,
          scope: form.elements.scope.value,
        });
        toast('Notification settings saved.');
      });
      on(content.querySelector('#notification-sound-file'), 'change', async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        await notifications.uploadSound(file);
        filename = file.name;
        if (isCurrent()) {
          paintSound();
          toast('Custom notification sound saved.');
        }
      });
      on(content.querySelector('#notification-reset'), 'click', async () => {
        await notifications.resetSound();
        filename = '';
        if (isCurrent()) {
          paintSound();
          toast('Default sound restored.');
        }
      });
      on(content.querySelector('#notification-play'), 'click', () => notifications.previewSound());
      return;
    }
    if (page === 'about') {
      const info = await api('/about');
      if (!isCurrent() || !content.isConnected) return;
      content.innerHTML = `<section class="card" id="settings-about"><h2>About inkwell</h2><p>A local-first workspace for email, calendar, contacts and optional AI assistance.</p><dl class="about-details"><div><dt>Version</dt><dd id="app-version">${esc(info.version)}</dd></div><div><dt>Last commit ID</dt><dd id="app-commit"><code>${esc(info.commit)}</code></dd></div><div><dt>Developer</dt><dd>Developed by Chris Visser</dd></div></dl><p><a class="about-github" href="https://github.com/vcsoc/inkwell" target="_blank" rel="noopener noreferrer" aria-label="Inkwell on GitHub"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 .8a11.2 11.2 0 0 0-3.54 21.82c.56.1.77-.24.77-.54v-2.1c-3.12.67-3.78-1.32-3.78-1.32-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.73 1.16 1.73 1.16 1 .1.78 2.35 3.08 1.67.1-.72.4-1.21.72-1.49-2.49-.28-5.11-1.25-5.11-5.54 0-1.23.44-2.23 1.16-3.01-.12-.28-.51-1.43.11-2.97 0 0 .95-.31 3.08 1.15a10.7 10.7 0 0 1 5.6 0c2.13-1.46 3.07-1.15 3.07-1.15.62 1.54.23 2.69.12 2.97.72.78 1.15 1.78 1.15 3 0 4.31-2.62 5.27-5.12 5.55.4.34.76 1.03.76 2.08v3.08c0 .3.2.65.78.54A11.2 11.2 0 0 0 12 .8Z"/></svg><span>github.com/vcsoc/inkwell ↗</span></a></p></section>`;
      return;
    }
    if (page === 'privacy') {
      content.innerHTML = `<section class="card" id="privacy-card"><h2>Private by intention.</h2><ul><li>inkwell has no analytics or advertising trackers.</li><li>HTML email is sanitized and sandboxed; remote content starts blocked. Scripts and forms remain disabled. The previous text preview is available in Forms settings.</li><li>Explicitly allowing remote images can reveal your IP address and tell the sender you opened a message. Permission is for the current view only.</li><li>IMAP and SMTP require verified TLS.</li><li>Assistant output is never executed as mail/calendar actions.</li><li>Message bodies are not encrypted at rest. Use full-disk encryption.</li></ul><p>Address autocomplete is local and remembers valid addresses from saved drafts, sent/imported mail (including Cc/Bcc), contacts and accounts. Clearing history keeps current contact/account suggestions and does not delete messages.</p><button class="secondary" id="clear-address-history">Clear remembered email addresses</button><button class="secondary" id="demo-settings">Explore sample workspace</button><div class="notice">Desktop runs locally. Mobile connects to your private backend over HTTPS. Use the install option in your browser to add inkwell to your home screen.</div><p>Passwords and tokens are encrypted with a key stored beside the database. Protect the entire data directory and any backups.</p></section>`;
      on(content.querySelector('#demo-settings'), 'click', loadDemo);
      on(content.querySelector('#clear-address-history'), 'click', async () => {
        try {
          await api('/addresses', { method: 'DELETE' });
          toast('Remembered addresses cleared. Current contacts and accounts remain available.');
        } catch (error) {
          toast(error.message);
        }
      });
      return;
    }
    content.innerHTML = '<div class="skeleton">Loading settings…</div>';
    if (page === 'mail') {
      const accounts = await api('/accounts');
      if (!isCurrent() || !content.isConnected) return;
      accountsChanged(accounts);
      content.innerHTML = `<section class="card" id="settings-mail"><h2>Your mail, at home.</h2><h3>Connect to inkwell</h3><p>Connect Outlook.com or Microsoft 365 with Microsoft sign-in, or add an IMAP / SMTP account using an app password. Credentials are encrypted on disk.</p>${accounts.map((a) => `<div class="account-card"><div><strong>${esc(a.name)}</strong><small>${esc(a.email)}${a.provider === 'microsoft' ? ' · Microsoft OAuth' : ''}</small></div><button class="secondary" data-sending-addresses="${a.id}">Sending addresses</button><button class="icon-button danger" data-remove-account="${a.id}" aria-label="Remove ${esc(a.email)}">×</button></div>`).join('')}<button class="primary" id="add-account">＋ Connect email</button><div class="notice">Sync imports the newest 200 inbox messages (up to 10 MB each for IMAP). Read status, stars, folders and local sent copies stay local. Removing an account disconnects immediately but keeps downloaded mail and drafts. Attachments are not available in this build.</div><p>Gmail requires an app password if your account supports it. Outlook.com and Microsoft 365 use inkwell's configured Microsoft OAuth registration and Graph; you are not asked for an application ID or mailbox password. Some organizations may require administrator consent.</p><h3>Optional webmail</h3><p>Open Microsoft's official website in your default browser instead of connecting it to inkwell.</p><div class="form-actions"><a class="secondary" href="https://outlook.live.com/mail/" target="_blank" rel="noopener noreferrer">Open Outlook.com webmail ↗</a><a class="secondary" href="https://outlook.office.com/mail/" target="_blank" rel="noopener noreferrer">Open Microsoft 365 webmail ↗</a></div></section>`;
      on(content.querySelector('#add-account'), 'click', accountForm);
      content.querySelectorAll('[data-sending-addresses]').forEach((button) =>
        on(button, 'click', () => {
          content.querySelector('#sending-address-settings')?.remove();
          const root = document.createElement('section');
          root.id = 'sending-address-settings';
          root.className = 'card';
          content.append(root);
          return InkwellSendingIdentities(
            root,
            accounts.find((a) => a.id === Number(button.dataset.sendingAddresses)),
            { api, esc, toast, isCurrent },
          );
        }),
      );
      content.querySelectorAll('[data-remove-account]').forEach((button) =>
        on(button, 'click', async () => {
          await api('/accounts/' + button.dataset.removeAccount, { method: 'DELETE' });
          if (isCurrent()) await reload();
        }),
      );
      return;
    }
    const [config, providers] = await Promise.all([api('/ai/config'), api('/ai/providers')]);
    if (!isCurrent() || !content.isConnected) return;
    content.innerHTML = `<section class="card" id="settings-assistant"><h2>An assistant on your terms.</h2><p>Choose a cloud provider, a local model server, or your ChatGPT subscription through the official Codex CLI. Nothing is shared automatically.</p><form id="ai-settings"><label class="field">AI provider<select name="provider" id="ai-provider-select" aria-label="AI provider">${providers.map((p) => `<option value="${p.id}" ${p.id === (config.provider || 'custom') ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label><div id="ai-provider-help" class="notice"></div><button class="secondary hidden" type="button" id="codex-status">Check Codex login</button>${field('API base URL', 'endpoint', config.endpoint || 'http://127.0.0.1:11434/v1', 'url', 'required placeholder="https://api.openai.com/v1"')}${field('Model', 'model', config.model || 'llama3.2', 'text', 'required maxlength="200"')}${field('API key', 'api_key', '', 'password', `autocomplete="new-password" placeholder="${config.has_key ? 'Saved securely — leave blank to keep' : 'Optional for local models'}"`)}${textarea('Assistant instructions', 'instructions', config.instructions || 'Be concise, thoughtful and professional.', 'maxlength="5000"')}<div class="notice">Your selected context and prompt will be sent only when you click Ask. Changing provider or URL clears the saved key unless you enter a replacement. Codex uses a restricted local CLI runtime, not a tool-free HTTP API; use it only on a trusted backend. Save before leaving this page to keep edits.</div><div class="form-actions"><button type="button" class="secondary danger" id="clear-ai">Disconnect</button><button class="primary" type="submit">Save assistant</button></div></form></section>`;
    const form = content.querySelector('#ai-settings'),
      provider = content.querySelector('#ai-provider-select');
    const updateProvider = (changed = false) => {
      const p = providers.find((p) => p.id === provider.value);
      if (!p) return;
      if (changed) {
        form.elements.endpoint.value = p.endpoint;
        form.elements.model.value = p.model;
        form.elements.api_key.value = '';
        form.elements.api_key.placeholder = 'New provider — enter its key if required';
      }
      content.querySelector('#ai-provider-help').textContent = p.help;
      form.elements.endpoint.readOnly = p.id === 'codex';
      form.elements.api_key.disabled = p.id === 'codex';
      content.querySelector('#codex-status').classList.toggle('hidden', p.id !== 'codex');
    };
    on(provider, 'change', () => updateProvider(true));
    updateProvider();
    on(content.querySelector('#codex-status'), 'click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const result = await api('/ai/codex/status');
        if (isCurrent()) toast(result.message);
      } finally {
        button.disabled = false;
      }
    });
    on(form, 'submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        await api('/ai/config', { method: 'PUT', body: Object.fromEntries(new FormData(form)) });
        if (isCurrent()) {
          toast('Assistant configured. You control what it sees.');
          await reload();
        }
      } finally {
        button.disabled = false;
      }
    });
    on(content.querySelector('#clear-ai'), 'click', async () => {
      await api('/ai/config', { method: 'DELETE' });
      if (isCurrent()) {
        toast('AI provider and key removed.');
        await reload();
      }
    });
  }
  return { pages, mount };
})();
