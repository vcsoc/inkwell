'use strict';
// Presentation-only state. Theme files are validated data, never CSS or JavaScript.
window.InkwellAppearance = (() => {
  const defaults = {
    name: 'Sage',
    background: '#f6f5f1',
    surface: '#ffffff',
    text: '#292e2b',
    muted: '#697264',
    border: '#e7e8e1',
    accent: '#486b54',
    accent_text: '#ffffff',
    selection: '#eaf0e8',
    danger: '#ac4c45',
    radius: 10,
    font_size: 16,
    sidebar_font_size: 16,
    sidebar_font: 'system',
    spacing: 100,
    sidebar_spacing: 100,
    font: 'system',
    headings: 'serif',
    density: 'comfortable',
    dark: false,
  };
  const presets = {
    Sage: defaults,
    Midnight: {
      ...defaults,
      name: 'Midnight',
      background: '#151a20',
      surface: '#202731',
      text: '#edf1f7',
      muted: '#adb8c6',
      border: '#394452',
      accent: '#9bcbb2',
      accent_text: '#14241c',
      selection: '#2b4039',
      danger: '#ffaaa3',
      dark: true,
    },
    Ocean: {
      ...defaults,
      name: 'Ocean',
      background: '#eff5fb',
      surface: '#ffffff',
      text: '#21364c',
      muted: '#596e85',
      border: '#d4e1ed',
      accent: '#2664a0',
      selection: '#e0edfa',
    },
    'High contrast': {
      ...defaults,
      name: 'High contrast',
      background: '#000000',
      surface: '#111111',
      text: '#ffffff',
      muted: '#dddddd',
      border: '#999999',
      accent: '#ffdc60',
      accent_text: '#000000',
      selection: '#323232',
      danger: '#ffaaaa',
      dark: true,
      radius: 2,
      headings: 'sans',
    },
  };
  const colors = {
    background: 'Background',
    surface: 'Surface',
    text: 'Text',
    muted: 'Secondary text',
    border: 'Borders',
    accent: 'Accent',
    accent_text: 'Accent text',
    selection: 'Selection',
    danger: 'Destructive actions',
  };
  const escape = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  function validate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw Error('Invalid theme file');
    if (Object.keys(value).some((key) => !Object.hasOwn(defaults, key)))
      throw Error('Unknown theme property');
    const t = { ...defaults, ...value };
    for (const key of Object.keys(colors))
      if (!/^#[0-9a-fA-F]{6}$/.test(t[key])) throw Error('Colors must be six-digit hex values');
    if (typeof t.name !== 'string' || !t.name.trim() || t.name.length > 60)
      throw Error('Theme name must be 1–60 characters');
    if (
      !Number.isInteger(t.radius) ||
      t.radius < 0 ||
      t.radius > 24 ||
      !Number.isInteger(t.font_size) ||
      t.font_size < 12 ||
      t.font_size > 24 ||
      !Number.isInteger(t.sidebar_font_size) ||
      t.sidebar_font_size < 12 ||
      t.sidebar_font_size > 24 ||
      !Number.isInteger(t.spacing) ||
      t.spacing < 50 ||
      t.spacing > 150 ||
      !Number.isInteger(t.sidebar_spacing) ||
      t.sidebar_spacing < 25 ||
      t.sidebar_spacing > 150
    )
      throw Error('Invalid theme sizing');
    if (
      !['system', 'humanist', 'mono'].includes(t.font) ||
      !['system', 'humanist', 'mono'].includes(t.sidebar_font) ||
      !['serif', 'sans'].includes(t.headings) ||
      !['comfortable', 'compact'].includes(t.density) ||
      typeof t.dark !== 'boolean'
    )
      throw Error('Invalid theme options');
    return t;
  }
  function apply(value) {
    const t = validate(value),
      root = document.documentElement;
    const map = {
      background: 'bg',
      surface: 'surface',
      text: 'ink',
      muted: 'muted',
      border: 'line',
      accent: 'accent',
      accent_text: 'accent-text',
      selection: 'accent-light',
      danger: 'danger',
    };
    for (const [key, css] of Object.entries(map)) root.style.setProperty('--' + css, t[key]);
    root.style.setProperty('--radius', t.radius + 'px');
    root.style.setProperty('--font-size', t.font_size + 'px');
    const fonts = {
      system: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      humanist: '"Trebuchet MS", Calibri, sans-serif',
      mono: 'ui-monospace, "Cascadia Code", monospace',
    };
    root.style.setProperty('--sans', fonts[t.font]);
    root.style.setProperty('--sidebar-font', fonts[t.sidebar_font]);
    root.style.setProperty('--sidebar-font-size', t.sidebar_font_size + 'px');
    root.style.setProperty('--space-scale', t.spacing / 100);
    root.style.setProperty('--sidebar-space-scale', t.sidebar_spacing / 100);
    root.style.setProperty(
      '--serif',
      t.headings === 'sans' ? fonts[t.font] : 'Georgia, "Times New Roman", serif',
    );
    root.style.colorScheme = t.dark ? 'dark' : 'light';
    root.dataset.density = t.density;
    document.querySelector('meta[name="theme-color"]').content = t.background;
  }
  function contrast(a, b) {
    const luminance = (hex) => {
      const c = [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
    };
    const x = luminance(a),
      y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function mount(root, preferences, save, toast, section, api, savedThemes = []) {
    let savedLayout = preferences.layout || 'focus';
    let draft = validate(preferences.theme),
      saved = validate(preferences.theme);
    const templates = {
      layout: `<section class="card appearance-card" id="settings-layout"><h2>A layout that fits your day.</h2><p>Choose your default mail workspace. Layouts are independent of themes and form presentation. On phones, all layouts switch to a single pane with a Back button.</p><form id="layout-settings"><label class="field">Default mail layout<select name="layout"><option value="focus">Focus — original inkwell</option><option value="classic">Classic — compact three-pane with navigation rail</option><option value="stacked">Stacked — reading pane below messages</option><option value="list">List first — open messages full-width</option></select></label><div class="layout-diagram" id="layout-diagram" role="img" aria-label="Layout preview"><div class="diagram-rail">Apps</div><div class="diagram-folders">Folders</div><div class="diagram-messages">Messages</div><div class="diagram-reader">Reading pane</div></div><p id="layout-description"></p><p id="layout-status" role="status"></p><div class="form-actions"><button class="secondary" type="button" id="layout-revert">Revert layout preview</button><button class="primary" type="submit">Save layout</button></div></form></section>`,
      forms: `<section class="card appearance-card" id="settings-forms"><h2>Forms, your way.</h2><p>Choose how compose, account setup, events and contact forms open. This preference is saved with your workspace.</p><form id="form-mode-settings"><label class="field">Form presentation<select name="form_mode"><option value="popup">Popup dialogs</option><option value="inline">Internal pages (no popup)</option></select></label><label class="field">Email preview format<select name="preview_mode"><option value="html">HTML — remote content blocked by default</option><option value="text">Text — previous preview style</option></select></label><label class="field">Interface scale (%)<input name="ui_zoom" type="number" min="75" max="175" required></label><p class="notice">HTML is sanitized and isolated. Remote images require explicit permission for each view; scripts, forms, external styles/fonts and navigation links remain disabled. Ctrl+/Ctrl− scales the interface; Ctrl+0 resets it.</p><button class="primary" type="submit">Save form preference</button></form></section>`,
      theme: `<section class="card appearance-card" id="settings-theme"><h2>Theme studio</h2><p>Preview changes throughout inkwell. Save to keep them across devices. Import/export contains theme settings only, never credentials.</p><label class="field">Starting palette<select id="theme-preset"><option value="">Custom / saved theme</option>${Object.keys(
        presets,
      )
        .map((n) => `<option>${escape(n)}</option>`)
        .join(
          '',
        )}</select></label><form id="theme-editor"><label class="field">Theme name<input name="name" maxlength="60" required></label><div class="theme-colors">${Object.entries(
        colors,
      )
        .map(
          ([k, label]) =>
            `<div class="color-field"><label class="field">${label}<input type="text" name="${k}" aria-label="${label} color" pattern="#[0-9a-fA-F]{6}" maxlength="7" required spellcheck="false"></label></div>`,
        )
        .join(
          '',
        )}</div><div class="field-row"><label class="field">Corner radius<input name="radius" type="number" min="0" max="24" required></label><label class="field">Text size<input name="font_size" type="number" min="12" max="24" required></label></div><div class="field-row"><label class="field">Body font<select name="font"><option value="system">System</option><option value="humanist">Humanist</option><option value="mono">Monospace</option></select></label><label class="field">Headings<select name="headings"><option value="serif">Serif</option><option value="sans">Sans serif</option></select></label></div><div class="field-row"><label class="field">Sidebar text size<input name="sidebar_font_size" type="number" min="12" max="24" required></label><label class="field">Sidebar font<select name="sidebar_font"><option value="system">System</option><option value="humanist">Humanist</option><option value="mono">Monospace</option></select></label></div><div class="field-row"><label class="field">Layout spacing (%)<input name="spacing" type="number" min="50" max="150" required></label><label class="field">Sidebar spacing (%)<input name="sidebar_spacing" type="number" min="25" max="150" required></label></div><label class="field">Density<select name="density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label><label class="check-label"><input type="checkbox" name="dark"> Dark native controls</label><p id="theme-contrast" role="status"></p><p id="theme-status" role="status">Saved theme</p><div class="form-actions"><button class="secondary" id="theme-revert" type="button">Revert preview</button><button class="secondary" id="theme-reset" type="button">Reset to Sage</button><button class="primary" type="submit">Save theme</button></div></form><div class="form-actions"><label class="field">Export format<select id="theme-format"><option value="yaml">YAML</option><option value="json">JSON</option></select></label><button class="secondary" id="theme-export">Export theme</button><label class="secondary">Import theme<input id="theme-import" type="file" accept=".yaml,.yml,.json,application/yaml,text/yaml,application/json"></label></div></section>`,
    };
    root.innerHTML = templates[section];
    if (section === 'layout') {
      const layoutForm = root.querySelector('#layout-settings');
      layoutForm.elements.layout.value = savedLayout;
      const layoutPreview = () => {
        const value = layoutForm.elements.layout.value;
        document.documentElement.dataset.layout = value;
        root.querySelector('#layout-diagram').dataset.layout = value;
        root.querySelector('#layout-description').textContent = {
          focus: 'The original spacious workspace. A reading pane opens beside your message list.',
          classic:
            'Inspired by traditional mail clients: narrow app rail, folder sidebar, compact message cards, and a persistent reading pane on the right. Uses your existing local folders, not a simulated remote folder tree.',
          stacked:
            'Folders on the left, a message list above, and a persistent reading pane below.',
          list: 'Focus on the message list. Opening a message replaces the list with a full-width reader.',
        }[value];
        root.querySelector('#layout-status').textContent =
          value === savedLayout
            ? 'Saved default layout'
            : 'Unsaved preview — Save layout to make this your default';
      };
      layoutForm.elements.layout.addEventListener('change', layoutPreview);
      root.querySelector('#layout-revert').onclick = () => {
        layoutForm.elements.layout.value = savedLayout;
        layoutPreview();
      };
      layoutForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await save({
            layout: layoutForm.elements.layout.value,
            form_mode: preferences.form_mode,
            theme: saved,
          });
          savedLayout = layoutForm.elements.layout.value;
          layoutPreview();
          toast('Default layout saved.');
        } catch (e) {
          toast(e.message);
        }
      });
      layoutPreview();
      return;
    }
    if (section === 'forms') {
      const mode = root.querySelector('#form-mode-settings');
      mode.elements.form_mode.value = preferences.form_mode;
      mode.elements.preview_mode.value = preferences.preview_mode || 'html';
      mode.elements.ui_zoom.value = preferences.ui_zoom || 100;
      mode.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await save({
            form_mode: mode.elements.form_mode.value,
            preview_mode: mode.elements.preview_mode.value,
            ui_zoom: Number(mode.elements.ui_zoom.value),
            layout: savedLayout,
            theme: saved,
          });
          toast('Form preference saved.');
        } catch (e) {
          toast(e.message);
        }
      });
      return;
    }
    const studio = document.createElement('div');
    studio.className = 'theme-studio-layout';
    const editor = root.querySelector('#settings-theme');
    editor.replaceWith(studio);
    studio.append(editor);
    const sample = document.createElement('section');
    sample.className = 'theme-live-preview card';
    sample.setAttribute('aria-label', 'Live theme preview');
    sample.innerHTML =
      '<h2>Live preview</h2><p>Sample content · changes are not saved until you choose Save theme.</p><div class="theme-sample"><div class="theme-sample-sidebar"><strong>Folders</strong><div class="sample-selected">Inbox <span class="mail-pill unread-pill">3</span></div><div>Sent</div><div>Projects</div></div><div class="theme-sample-mail"><div class="theme-sample-row"><strong>Alex Morgan</strong><p>Plans for the week</p><span class="mail-pill unread-pill">Unread</span> <span class="mail-pill tag-pill">Project</span></div><div class="theme-sample-reader"><h3>A little room to think.</h3><p>This is your message text. Colors, fonts, sizing, radius and spacing update as you edit.</p><span class="primary">Reply</span> <span class="sample-danger">Delete</span></div></div></div>';
    const previewColumn = document.createElement('div');
    previewColumn.className = 'theme-preview-column';
    previewColumn.append(sample);
    studio.append(previewColumn);
    const library = document.createElement('section');
    library.className = 'theme-library card';
    library.innerHTML =
      '<h2>Saved themes</h2><p>Apply a saved theme or remove it from your library.</p><div class="theme-library-list"></div>';
    previewColumn.append(library);
    const list = library.querySelector('.theme-library-list');
    function renderThemes() {
      list.innerHTML = savedThemes.length
        ? savedThemes
            .map(
              (theme, index) =>
                `<div class="theme-library-item"><div class="theme-thumbnail" aria-hidden="true" style="--thumb-bg:${theme.background};--thumb-surface:${theme.surface};--thumb-accent:${theme.accent};--thumb-text:${theme.text};--thumb-border:${theme.border}"><span></span><span></span><span></span></div><strong title="${escape(theme.name)}">${escape(theme.name)}</strong><div class="theme-library-actions"><button type="button" class="icon-button" data-apply-theme="${index}" title="Apply ${escape(theme.name)}" aria-label="Apply ${escape(theme.name)}">✓</button><button type="button" class="icon-button danger" data-delete-theme="${index}" title="Delete ${escape(theme.name)}" aria-label="Delete ${escape(theme.name)}">×</button></div></div>`,
            )
            .join('')
        : '<p>No saved themes yet. Save a theme to add it here.</p>';
    }
    renderThemes();
    list.addEventListener('click', async (event) => {
      const button = event.target.closest('button');
      if (!button || !list.contains(button)) return;
      const applying = button.hasAttribute('data-apply-theme');
      const index = Number(button.dataset[applying ? 'applyTheme' : 'deleteTheme']);
      const theme = savedThemes[index];
      if (!theme) return;
      button.disabled = true;
      try {
        if (applying) {
          await save({ form_mode: preferences.form_mode, layout: savedLayout, theme });
          saved = validate(theme);
          draft = structuredClone(saved);
          fill();
          toast('Theme applied.');
        } else {
          await api('/preferences/themes/' + encodeURIComponent(theme.name), { method: 'DELETE' });
          savedThemes.splice(index, 1);
          renderThemes();
          toast('Theme removed from library. Your current appearance is unchanged.');
        }
      } catch (error) {
        button.disabled = false;
        toast(error.message);
      }
    });
    const form = root.querySelector('#theme-editor');
    const updateColors = InkwellColorEditor(form, colors);
    function preview() {
      apply(draft);
      updateColors();
      root.querySelector('#theme-contrast').textContent =
        `Text contrast: ${contrast(draft.text, draft.surface).toFixed(1)}:1 · Accent contrast: ${contrast(draft.accent_text, draft.accent).toFixed(1)}:1. Aim for at least 4.5:1 for normal text.`;
      root.querySelector('#theme-status').textContent =
        JSON.stringify(draft) === JSON.stringify(saved)
          ? 'Saved theme'
          : 'Unsaved preview — Save theme to keep changes';
    }
    function fill() {
      for (const [k, v] of Object.entries(draft)) {
        if (k === 'dark') form.elements[k].checked = v;
        else form.elements[k].value = v;
      }
      preview();
    }
    form.addEventListener('input', () => {
      try {
        const v = Object.fromEntries(new FormData(form));
        v.radius = Number(v.radius);
        v.font_size = Number(v.font_size);
        for (const key of ['sidebar_font_size', 'spacing', 'sidebar_spacing'])
          v[key] = Number(v[key]);
        v.dark = form.elements.dark.checked;
        draft = validate(v);
        preview();
      } catch {
        /* Partial numeric input is allowed until submit. */
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await save({
          form_mode: preferences.form_mode,
          layout: savedLayout,
          theme: validate(draft),
        });
        saved = structuredClone(draft);
        try {
          await api('/preferences/themes', { method: 'PUT', body: saved });
          savedThemes = savedThemes.filter(
            (theme) => theme.name.toLowerCase() !== saved.name.toLowerCase(),
          );
          savedThemes.push(structuredClone(saved));
          renderThemes();
          toast('Theme saved.');
        } catch (error) {
          toast('Theme applied, but could not add it to the library: ' + error.message);
        }
        preview();
      } catch (e) {
        toast(e.message);
      }
    });
    root.querySelector('#theme-preset').addEventListener('change', (e) => {
      if (presets[e.target.value]) {
        draft = structuredClone(presets[e.target.value]);
        fill();
      }
    });
    root.querySelector('#theme-revert').onclick = () => {
      draft = structuredClone(saved);
      fill();
    };
    root.querySelector('#theme-reset').onclick = () => {
      draft = structuredClone(defaults);
      fill();
    };
    root.querySelector('#theme-export').onclick = () => {
      const format = root.querySelector('#theme-format').value;
      const url = URL.createObjectURL(
        new Blob([InkwellThemeFiles.stringify(draft, format)], {
          type: format === 'yaml' ? 'application/yaml' : 'application/json',
        }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = 'inkwell-theme.' + format;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    root.querySelector('#theme-import').addEventListener('change', async (e) => {
      try {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 16000) throw Error('Theme files must be smaller than 16 KB');
        const data = InkwellThemeFiles.parse(await file.text());
        if (data.version !== 1) throw Error('Unsupported theme version');
        draft = validate(data.theme);
        fill();
        toast('Theme imported for preview. Save to keep it.');
      } catch (e) {
        toast(e.message);
      } finally {
        e.target.value = '';
      }
    });
    fill();
  }
  return { defaults, apply, mount };
})();
