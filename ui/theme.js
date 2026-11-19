'use strict';
window.InkwellTheme = (() => {
  const key = 'inkwell.appearance.v1';
  const root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');
  const palette = {
    background: ['Canvas', 'background'], surface: ['Card surface', 'card'],
    text: ['Text', 'foreground'], muted: ['Secondary text', 'muted-foreground'],
    border: ['Dividers', 'border'], input: ['Field outlines', 'input'],
    accent: ['Primary action', 'primary'], accent_text: ['Primary action text', 'primary-foreground'],
    selection: ['Selection', 'accent'], selection_text: ['Selection text', 'accent-foreground'],
    danger: ['Destructive actions', 'destructive'], focus: ['Keyboard focus', 'ring'],
    sidebar: ['Sidebar surface', 'sidebar'], sidebar_text: ['Sidebar text', 'sidebar-foreground'],
    sidebar_selection: ['Sidebar selection', 'sidebar-accent'],
    sidebar_marker: ['Sidebar marker', 'sidebar-primary'], brand: ['Brand accent', 'brand-hexagon'],
  };
  const fonts = {
    system: 'Inter, ui-sans-serif, system-ui, sans-serif', serif: 'Georgia, serif',
    mono: 'ui-monospace, Consolas, monospace', humanist: 'Verdana, sans-serif',
  };
  const defaults = { name: 'Waypoint Light', mode: 'light', font: 'system', heading: 'sans',
    sidebar_font: 'system', font_size: 14, sidebar_size: 13, radius: 6, spacing: 100,
    sidebar_spacing: 100, density: 'comfortable', dark_controls: 'auto' };
  const ranges = { font_size: [12, 24], sidebar_size: [12, 24], radius: [0, 24],
    spacing: [50, 150], sidebar_spacing: [25, 150] };
  const aliases = { ink: 'text', line: 'border', accent_ink: 'accent_text', destructive: 'danger',
    sidebar_font_size: 'sidebar_size', headings: 'heading', dark: 'dark_controls',
    spacing_scale: 'spacing', sidebar_spacing_scale: 'sidebar_spacing' };
  const hex = /^#[0-9a-f]{6}$/i;
  function validate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Expected a theme object.');
    const a = { ...defaults };
    for (const [source, value] of Object.entries(input)) {
      const field = Object.hasOwn(aliases, source) ? aliases[source] : source;
      if (Object.hasOwn(palette, field)) {
        if (typeof value !== 'string' || !hex.test(value)) throw Error(`Invalid color: ${field}`);
        a[field] = value.toLowerCase();
      } else if (Object.hasOwn(ranges, field)) {
        const [min, max] = ranges[field];
        if (!Number.isInteger(value) || value < min || value > max) throw Error(`Invalid size: ${field}`);
        a[field] = value;
      } else if (field === 'name' && typeof value === 'string' && value.trim()) a.name = value.trim().slice(0, 64);
      else if (field === 'mode' && ['light', 'dark', 'system'].includes(value)) a.mode = value;
      else if (['font', 'sidebar_font'].includes(field) && Object.hasOwn(fonts, value)) a[field] = value;
      else if (field === 'heading' && ['serif', 'sans'].includes(value)) a[field] = value;
      else if (field === 'density' && ['comfortable', 'compact'].includes(value)) a[field] = value;
      else if (field === 'dark_controls' && ['auto', 'light', 'dark', true, false].includes(value))
        a[field] = typeof value === 'boolean' ? (value ? 'dark' : 'light') : value;
    }
    return a;
  }
  const presets = [defaults, { ...defaults, name: 'Waypoint Dark', mode: 'dark' },
    { ...defaults, name: 'Waypoint System', mode: 'system' },
    { ...defaults, name: 'High Contrast', mode: 'dark', background: '#000000', surface: '#000000',
      text: '#ffffff', muted: '#d9d9d9', border: '#ffffff', input: '#ffffff',
      focus: '#ffdb44', accent: '#ffffff', accent_text: '#000000' }];
  let saved = defaults, library = [];
  try {
    const data = JSON.parse(localStorage.getItem(key));
    if (data?.active) saved = validate(data.active);
    if (Array.isArray(data?.library)) library = data.library.slice(0, 64).map(validate);
  } catch { /* An unavailable or corrupt local store must not block mail startup. */ }
  let current = saved;
  function apply(theme) {
    current = theme;
    root.dataset.scheme = theme.mode === 'system' ? (system.matches ? 'dark' : 'light') : theme.mode;
    root.dataset.controls = theme.dark_controls === 'auto' ? root.dataset.scheme : theme.dark_controls;
    root.dataset.density = theme.density;
    for (const [field, [, token]] of Object.entries(palette)) {
      if (theme[field]) root.style.setProperty(`--${token}`, theme[field]);
      else root.style.removeProperty(`--${token}`);
    }
    for (const [property, value] of Object.entries({ radius: `${theme.radius}px`,
      'font-size': `${theme.font_size}px`, 'sidebar-size': `${theme.sidebar_size}px`,
      'body-font': fonts[theme.font], 'sidebar-font': fonts[theme.sidebar_font],
      'heading-font': theme.heading === 'serif' ? fonts.serif : fonts[theme.font],
      space: theme.spacing / 100, 'sidebar-space': theme.sidebar_spacing / 100 })) {
      root.style.setProperty(`--${property}`, value);
    }
  }
  apply(saved);
  system.addEventListener('change', () => apply(current));
  function persist(active, items) {
    localStorage.setItem(key, JSON.stringify({ active, library: items }));
    saved = active;
    library = items;
  }
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  function swatch(token) {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000000';
    ctx.fillStyle = getComputedStyle(root).getPropertyValue(`--${token}`).trim();
    ctx.fillRect(0, 0, 1, 1);
    const bytes = ctx.getImageData(0, 0, 1, 1).data;
    return '#' + [...bytes.slice(0, 3)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  function contrast(a, b) {
    const luminance = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
      .map((x) => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4)
      .reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
    const pair = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (pair[0] + .05) / (pair[1] + .05);
  }
  function mount(container) {
    let draft = { ...saved };
    const controls = new Map();
    const form = element('form', null, 'theme-controls');
    const display = element('section', null, 'theme-sample');
    display.setAttribute('aria-labelledby', 'sample-label');
    const sampleTitle = element('h2', 'Live preview');
    sampleTitle.id = 'sample-label';
    const sampleNav = element('div', 'Inbox / Drafts', 'sample-nav');
    const sampleCard = element('article', null, 'sample-card');
    sampleCard.append(element('strong', 'A quieter inbox'), element('p', 'This sample does not use your mail.'));
    const sampleAction = element('span', 'Primary action', 'sample-action');
    const sampleDelete = element('span', 'Destructive action', 'sample-danger');
    sampleCard.append(sampleAction, sampleDelete);
    const ratios = element('p', '', 'theme-ratios');
    display.append(sampleTitle, sampleNav, sampleCard, ratios);
    const notice = element('p', '', 'theme-notice');
    notice.setAttribute('role', 'status');
    const libraryList = element('div', null, 'theme-library');
    const actions = element('div', null, 'theme-actions');
    const heading = (title) => form.append(element('h2', title));
    function button(text, handler, style) {
      const node = element('button', text, style);
      node.type = 'button'; node.addEventListener('click', handler);
      return node;
    }
    function field(name, label, input, callback) {
      input.name = name;
      const wrap = element('label', null, 'theme-field');
      wrap.append(element('span', label), input);
      form.append(wrap);
      controls.set(name, input);
      input.addEventListener('input', () => {
        if (!input.checkValidity()) return;
        draft[name] = callback ? callback(input.value) : input.value;
        update(input);
      });
    }
    function dropdown(name, label, values) {
      const select = element('select');
      for (const [value, title] of Object.entries(values)) {
        const option = element('option', title); option.value = value; select.append(option);
      }
      field(name, label, select);
    }
    function update(source) {
      apply(draft);
      for (const [name, input] of controls) {
        if (input === source) continue;
        const value = Object.hasOwn(palette, name) ? draft[name] || swatch(palette[name][1]) : draft[name];
        if (input.value !== String(value)) input.value = value;
      }
      for (const picker of form.querySelectorAll('[data-swatch]')) picker.value = controls.get(picker.dataset.swatch).value;
      const metrics = [['Canvas text', 'foreground', 'background'], ['Card text', 'foreground', 'card'],
        ['Action text', 'primary-foreground', 'primary'], ['Sidebar text', 'sidebar-foreground', 'sidebar']];
      ratios.replaceChildren(...metrics.map(([label, ink, bg]) => {
        const ratio = contrast(swatch(ink), swatch(bg));
        return element('span', `${label}: ${ratio.toFixed(2)}:1${ratio < 4.5 ? ' (low contrast)' : ''}`);
      }));
    }
    function iconButton(button, label, path) {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
      const stroke = document.createElementNS(ns, 'path'); stroke.setAttribute('d', path);
      svg.append(stroke); button.append(svg);
      button.setAttribute('aria-label', label); button.title = label;
    }
    function renderLibrary() {
      libraryList.replaceChildren(element('h2', 'Saved themes'));
      if (!library.length) libraryList.append(element('p', 'No saved themes yet.'));
      for (const theme of library) {
        const row = element('article', null, 'saved-theme');
        const preview = element('div', null, 'saved-theme-preview');
        preview.dataset.scheme = theme.mode === 'system' ? (system.matches ? 'dark' : 'light') : theme.mode;
        for (const [field, [, token]] of Object.entries(palette)) if (theme[field]) preview.style.setProperty(`--${token}`, theme[field]);
        preview.style.fontFamily = fonts[theme.font];
        preview.setAttribute('aria-hidden', 'true');
        const rail = element('div', 'Inbox', 'saved-theme-rail');
        const pane = element('div', null, 'saved-theme-pane');
        pane.append(element('strong', 'Sample message'), element('span', 'Compose', 'saved-theme-action'));
        preview.append(rail, pane);
        const controls = element('div', null, 'saved-theme-controls');
        const applyButton = button('', () => {
          try { persist(theme, library); draft = { ...saved }; update(); renderLibrary(); notice.textContent = 'Theme applied.'; }
          catch { notice.textContent = 'Theme could not be saved on this device.'; }
        }, 'theme-icon theme-apply');
        const deleteButton = button('', () => {
          try { persist(saved, library.filter((item) => item !== theme)); renderLibrary(); notice.textContent = 'Theme deleted from library.'; }
          catch { notice.textContent = 'Theme could not be deleted.'; }
        }, 'theme-icon theme-delete');
        iconButton(applyButton, `Apply ${theme.name}`, 'M5 12l4 4L19 6');
        iconButton(deleteButton, `Delete ${theme.name}`, 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5');
        applyButton.setAttribute('aria-pressed', String(JSON.stringify(theme) === JSON.stringify(saved)));
        controls.append(applyButton, deleteButton);
        row.append(preview, element('strong', theme.name), controls);
        libraryList.append(row);
      }
    }
    heading('Preset and name');
    const preset = element('select');
    preset.setAttribute('aria-label', 'Theme preset');
    preset.append(element('option', 'Choose a starting point'));
    presets.forEach((theme, index) => { const option = element('option', theme.name); option.value = index; preset.append(option); });
    preset.addEventListener('change', () => { if (preset.selectedIndex > 0) { draft = { ...presets[Number(preset.value)] }; update(); } });
    form.append(preset);
    const name = element('input'); name.required = true; name.maxLength = 64;
    field('name', 'Theme name', name);
    dropdown('mode', 'Color scheme', { light: 'Light', dark: 'Dark', system: 'Follow system' });
    dropdown('dark_controls', 'Native controls', { auto: 'Match scheme', light: 'Light', dark: 'Dark' });
    heading('Colors');
    for (const [key, [label]] of Object.entries(palette)) {
      const input = element('input'); input.maxLength = 7; input.pattern = '#[0-9a-fA-F]{6}'; input.required = true;
      input.spellcheck = false;
      field(key, label, input);
      const picker = element('input'); picker.type = 'color'; picker.dataset.swatch = key;
      picker.setAttribute('aria-label', `Pick ${label.toLowerCase()}`);
      input.after(picker);
      picker.addEventListener('input', () => { draft[key] = picker.value; update(); });
    }
    heading('Typography and spacing');
    const fontLabels = { system: 'Waypoint sans', serif: 'Georgia', mono: 'Monospace', humanist: 'Verdana' };
    dropdown('font', 'Body font', fontLabels);
    dropdown('sidebar_font', 'Sidebar font', fontLabels);
    dropdown('heading', 'Heading style', { sans: 'Match body', serif: 'Serif' });
    dropdown('density', 'Density', { comfortable: 'Comfortable', compact: 'Compact' });
    for (const [key, label] of Object.entries({ font_size: 'Body text (px)', sidebar_size: 'Sidebar text (px)',
      radius: 'Corner radius (px)', spacing: 'Content spacing (%)', sidebar_spacing: 'Sidebar spacing (%)' })) {
      const input = element('input'); input.type = 'number'; input.required = true;
      [input.min, input.max] = ranges[key];
      field(key, label, input, Number);
    }
    actions.append(button('Save theme', () => {
      if (!form.reportValidity()) return;
      try {
        const theme = validate(draft);
        if (!draft.name.trim()) throw Error('Name your theme before saving.');
        persist(theme, [theme, ...library.filter((item) => item.name.toLowerCase() !== theme.name.toLowerCase())].slice(0, 64));
        draft = { ...saved }; update(); renderLibrary(); notice.textContent = 'Theme saved on this device.';
      } catch (error) { notice.textContent = error instanceof DOMException ? 'Theme could not be saved on this device.' : error.message; }
    }, 'primary'), button('Revert preview', () => { draft = { ...saved }; update(); notice.textContent = 'Restored the saved theme.'; }),
    button('Reset to Waypoint', () => { draft = { ...defaults }; update(); notice.textContent = 'Waypoint preview. Save to keep it.'; }));
    form.addEventListener('submit', (event) => event.preventDefault());
    heading('Theme files');
    const upload = element('input'); upload.type = 'file'; upload.accept = '.json,.yaml,.yml';
    const importLabel = element('label', 'Import a theme', 'theme-file'); importLabel.append(upload);
    upload.addEventListener('change', async () => {
      const file = upload.files[0]; if (!file) return;
      try {
        if (file.size > 16000) throw Error('Theme files must be smaller than 16 KB.');
        const data = window.InkwellThemeFiles.parse(await file.text());
        if (!container.contains(form)) return;
        if (data.version !== 1) throw Error('Unsupported theme file version.');
        draft = validate(data.theme); update(); notice.textContent = 'Imported as a preview. Save to keep it.';
      } catch (error) { notice.textContent = error.message; }
      finally { upload.value = ''; }
    });
    const format = element('select'); format.setAttribute('aria-label', 'Export format');
    for (const value of ['yaml', 'json']) { const option = element('option', value.toUpperCase()); option.value = value; format.append(option); }
    const exportButton = button('Export theme', async () => {
      if (!form.reportValidity() || exportButton.disabled) return;
      exportButton.disabled = true;
      try {
        const contents = window.InkwellThemeFiles.stringify(validate(draft), format.value);
        const written = await window.__TAURI__.core.invoke('export_theme', { format: format.value, contents });
        if (written) notice.textContent = 'Theme exported.';
      } catch (error) { notice.textContent = String(error); }
      finally { exportButton.disabled = false; }
    });
    form.append(importLabel, format, exportButton);
    const side = element('div', null, 'theme-preview'); side.append(display, libraryList);
    const split = element('div', null, 'theme-grid'); split.append(side, form);
    container.append(actions, notice, split);
    update(); renderLibrary();
  }
  return { mount, revert: () => apply(saved) };
})();
