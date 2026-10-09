'use strict';
window.InkwellTranslation = (() => {
  const core = InkwellTranslationCore;
  const languages = [
    ['en', 'English'],
    ['af', 'Afrikaans'],
    ['ar', 'Arabic'],
    ['zh', 'Chinese (Simplified)'],
    ['zh-Hant', 'Chinese (Traditional)'],
    ['cs', 'Czech'],
    ['da', 'Danish'],
    ['nl', 'Dutch'],
    ['fi', 'Finnish'],
    ['fr', 'French'],
    ['de', 'German'],
    ['el', 'Greek'],
    ['he', 'Hebrew'],
    ['hi', 'Hindi'],
    ['hu', 'Hungarian'],
    ['id', 'Indonesian'],
    ['it', 'Italian'],
    ['ja', 'Japanese'],
    ['ko', 'Korean'],
    ['no', 'Norwegian'],
    ['pl', 'Polish'],
    ['pt', 'Portuguese'],
    ['ro', 'Romanian'],
    ['ru', 'Russian'],
    ['es', 'Spanish'],
    ['sv', 'Swedish'],
    ['th', 'Thai'],
    ['tr', 'Turkish'],
    ['uk', 'Ukrainian'],
    ['vi', 'Vietnamese'],
  ];
  const mirrors = new WeakMap();
  const frames = new WeakMap();
  const acknowledgements = new Map();
  let api,
    toast,
    menu,
    busy = false;
  const hostSelector =
    '#reader .message-body, #doc-rich-editor, .translation-editor, .doc-pdf-text-layer';
  const textareaSelector =
    '#compose-form textarea[name="body"], #doc-code-editor, .doc-inline-text';
  const closeMenu = () => {
    menu?.remove();
    menu = null;
  };
  const mirror = (textarea) => {
    if (mirrors.has(textarea)) return mirrors.get(textarea);
    const root = document.createElement('div');
    root.className = 'translation-editor';
    root.contentEditable = 'true';
    root.setAttribute('role', 'textbox');
    root.setAttribute('aria-multiline', 'true');
    root.setAttribute('aria-label', textarea.getAttribute('aria-label') || 'Message');
    root.dataset.translationSource = textarea.id || textarea.name;
    root.spellcheck = textarea.spellcheck;
    root.textContent = textarea.value;
    const css = getComputedStyle(textarea);
    root.style.minHeight = Math.max(100, textarea.clientHeight) + 'px';
    root.style.font = css.font;
    root.style.lineHeight = css.lineHeight;
    root.style.padding = css.padding;
    if (textarea.id === 'doc-code-editor') root.classList.add('translation-code-editor');
    textarea.after(root);
    textarea.hidden = true;
    textarea.setAttribute('aria-hidden', 'true');
    const sync = () => {
      textarea.value = core.plain(root);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    };
    root.addEventListener('input', sync);
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        document.execCommand('insertText', false, '\n');
      }
      if (event.key === 'Tab' && textarea.id === 'doc-code-editor') {
        event.preventDefault();
        document.execCommand('insertText', false, '\t');
      }
    });
    for (const type of ['paste', 'drop'])
      root.addEventListener(type, (event) => {
        event.preventDefault();
        const text = (event.clipboardData || event.dataTransfer)?.getData('text/plain');
        if (text) document.execCommand('insertText', false, text);
      });
    root.addEventListener('scroll', () => {
      textarea.scrollTop = root.scrollTop;
      const lines = document.querySelector('#doc-code-lines');
      if (lines && textarea.id === 'doc-code-editor') lines.scrollTop = root.scrollTop;
    });
    mirrors.set(textarea, { root, sync });
    return { root, sync };
  };
  const snapshotTextarea = (textarea) => {
    if (textarea.readOnly || textarea.disabled || textarea.selectionStart === textarea.selectionEnd)
      return null;
    const value = textarea.value,
      start = textarea.selectionStart,
      end = textarea.selectionEnd;
    const text = value.slice(start, end);
    if (!text.trim()) return null;
    return {
      text,
      valid: () => textarea.isConnected && textarea.value === value,
      apply: (translated, language) => {
        if (!textarea.isConnected || textarea.value !== value) return false;
        const { root, sync } = mirror(textarea);
        const node = root.firstChild;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        return core.insert(
          { root, range, text, signature: root.innerHTML },
          translated,
          language,
          sync,
          toast,
        );
      },
    };
  };
  const snapshotDom = (root) => {
    const snapshot = core.capture(root);
    if (!snapshot) return null;
    if (root.classList.contains('doc-pdf-text-layer')) {
      const rect = snapshot.range.getBoundingClientRect(),
        paper = root.parentElement;
      const parentRect = paper.getBoundingClientRect();
      return {
        text: snapshot.text,
        valid: () => core.valid(snapshot),
        apply: (translated, language) => {
          if (!core.valid(snapshot)) return false;
          const overlay = document.createElement('div');
          overlay.className = 'translation-pdf-overlay';
          const zoom = paper.offsetWidth / parentRect.width;
          overlay.style.left = (rect.left - parentRect.left) * zoom + 'px';
          overlay.style.top = (rect.top - parentRect.top) * zoom + 'px';
          overlay.style.width = Math.max(8, rect.width * zoom) + 'px';
          overlay.style.minHeight = rect.height * zoom + 'px';
          const text = document.createElement('span'),
            pill = document.createElement('button');
          text.textContent = translated;
          text.lang = language;
          pill.type = 'button';
          pill.className = 'translation-pill';
          pill.textContent = 'original';
          pill.setAttribute('aria-label', 'Show original text');
          let original = false;
          pill.onclick = () => {
            original = !original;
            text.textContent = original ? snapshot.text : translated;
            text.style.visibility = original ? 'hidden' : 'visible';
            overlay.classList.toggle('showing-original', original);
            pill.textContent = original ? 'translated' : 'original';
            pill.setAttribute(
              'aria-label',
              original ? 'Show translated text' : 'Show original text',
            );
          };
          overlay.append(text, pill);
          paper.append(overlay);
          return true; // View overlay only: original PDF bytes are never modified.
        },
      };
    }
    return {
      text: snapshot.text,
      valid: () => core.valid(snapshot),
      apply: (translated, language) => {
        const proxy = [...document.querySelectorAll(textareaSelector)].find(
          (t) => mirrors.get(t)?.root === root,
        );
        const change = proxy
          ? mirrors.get(proxy).sync
          : () => {
              if (root.isContentEditable) root.dispatchEvent(new Event('input', { bubbles: true }));
            };
        return core.insert(snapshot, translated, language, change, toast);
      },
    };
  };
  const setup = (resume = null) => {
    const dialog = document.createElement('dialog');
    dialog.id = 'translation-setup';
    dialog.className = 'translation-setup';
    dialog.innerHTML =
      '<h2>Local translation</h2><p>Download the Qwen3 4B translation model (2.5 GB) once. Translation then runs on this computer, offline, without sending your text to a cloud AI service. No API key or separate model server is needed.</p><p>Small local models can make mistakes. Review translations before sending or saving, especially names, dates and legal or medical text.</p><p class="translation-setup-status" role="status">Checking local model…</p><div class="form-actions"><button class="secondary" type="button" data-cancel>Cancel</button><button class="primary" type="button" data-download disabled>Download model' +
      (resume ? ' and translate' : '') +
      '</button></div>';
    document.body.append(dialog);
    dialog.showModal();
    const status = dialog.querySelector('[role="status"]'),
      download = dialog.querySelector('[data-download]');
    let closed = false;
    dialog.onclose = () => {
      closed = true;
      dialog.remove();
    };
    dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
    const show = (result) => {
      status.textContent = result.ready
        ? 'Local model ready. Translation stays on this computer.'
        : !result.runtime_ready
          ? 'This build lacks the local runtime. Install the Linux desktop release, or run the documented local-runtime build step.'
          : result.downloading
            ? `Downloading model… ${Math.round((result.downloaded / result.size) * 100)}%`
            : result.error || 'The model is not downloaded yet.';
      download.disabled = !result.runtime_ready || result.downloading;
      download.textContent = result.ready
        ? resume
          ? 'Translate selection'
          : 'Done'
        : 'Download model' + (resume ? ' and translate' : '');
      return result.ready;
    };
    const monitor = async (resumeAfter) => {
      while (!closed) {
        const result = await api('/translation');
        if (closed) return;
        const ready = show(result);
        if (ready && resumeAfter) {
          dialog.close();
          if (resume) await resume();
          return;
        }
        if (!result.downloading) return;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    };
    download.onclick = async () => {
      download.disabled = true;
      try {
        const current = await api('/translation');
        if (closed) return;
        if (current.ready) {
          dialog.close();
          if (resume) await resume();
          return;
        }
        dialog.querySelector('[data-cancel]').textContent = 'Close (download continues)';
        const installed = await api('/translation/install', {
          method: 'POST',
          body: { download: true },
        });
        if (closed) return;
        show(installed);
        await monitor(true);
      } catch (error) {
        if (!closed) {
          status.textContent = error.message;
          download.disabled = false;
        }
      }
    };
    monitor(false).catch((error) => {
      if (!closed) status.textContent = error.message;
    });
  };
  const run = async (snapshot, language) => {
    closeMenu();
    if (busy) {
      toast('Another local translation is running. Try again shortly.');
      return;
    }
    if (!snapshot.valid()) {
      toast('The selected text changed. Select it again to translate without overwriting edits.');
      return;
    }
    if (snapshot.text.length > 2000) {
      toast('Select a shorter passage (up to 2,000 characters).');
      return;
    }
    busy = true;
    const badge = document.querySelector('#translation-status');
    if (badge) {
      badge.hidden = false;
      badge.textContent = 'Translating selected text locally…';
    }
    try {
      const result = await api('/translation', {
        method: 'POST',
        body: { text: snapshot.text, language },
      });
      if (!snapshot.valid() || !(await snapshot.apply(result.translation, language))) {
        toast(
          'Translation finished, but the text or page changed. Your edits were kept; select the passage again.',
        );
      } else
        toast('Translated locally. Click original to toggle. Review before sending or saving.');
    } catch (error) {
      if (error.message.includes('Local translation needs its model'))
        setup(() => run(snapshot, language));
      else toast(error.message);
    } finally {
      busy = false;
      if (badge) badge.hidden = true;
    }
  };
  const showMenu = (snapshot, x, y) => {
    closeMenu();
    menu = document.createElement('div');
    menu.id = 'translation-menu';
    menu.className = 'translation-menu';
    menu.setAttribute('role', 'menu');
    const first = document.createElement('button');
    first.type = 'button';
    first.setAttribute('role', 'menuitem');
    first.setAttribute('aria-haspopup', 'menu');
    first.setAttribute('aria-expanded', 'false');
    first.textContent = 'Translate ▸';
    const sub = document.createElement('div');
    sub.className = 'translation-languages';
    sub.hidden = true;
    sub.setAttribute('role', 'menu');
    sub.setAttribute('aria-label', 'Translation languages');
    for (const [code, name] of languages) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.textContent = name;
      button.onclick = () => run(snapshot, code);
      sub.append(button);
    }
    const expand = () => {
      sub.hidden = false;
      first.setAttribute('aria-expanded', 'true');
    };
    first.onclick = () => {
      expand();
      sub.querySelector('button').focus();
    };
    first.onpointerenter = expand;
    menu.append(first, sub);
    const dialog = document.querySelector('dialog[open]');
    (dialog || document.body).append(menu);
    menu.style.left = Math.min(Math.max(8, x), window.innerWidth - 280) + 'px';
    menu.style.top = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - 360)) + 'px';
    menu.onkeydown = (event) => {
      const buttons = [...menu.querySelectorAll('button')].filter((b) => !b.closest('[hidden]'));
      const index = buttons.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        expand();
        sub.querySelector('button').focus();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        sub.hidden = true;
        first.setAttribute('aria-expanded', 'false');
        first.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
      }
    };
    first.focus();
  };
  const initialize = (deps) => {
    ({ api, toast } = deps);
    document.addEventListener(
      'contextmenu',
      (event) => {
        const textarea = event.target.closest(textareaSelector),
          root = event.target.closest(hostSelector);
        const snapshot = textarea ? snapshotTextarea(textarea) : root ? snapshotDom(root) : null;
        if (!snapshot) return;
        event.preventDefault();
        event.stopPropagation();
        showMenu(snapshot, event.clientX, event.clientY);
      },
      true,
    );
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (menu && !menu.contains(event.target)) closeMenu();
      },
      true,
    );
    window.addEventListener('hashchange', closeMenu);
    window.addEventListener('message', (event) => {
      const frame = [...document.querySelectorAll('iframe.html-message')].find(
        (f) => f.contentWindow === event.source,
      );
      const data = event.data,
        token = frame && frames.get(frame);
      if (
        !token ||
        event.origin !== 'null' ||
        data?.type !== 'inkwell-translation' ||
        data.token !== token
      )
        return;
      if (data.action === 'applied') {
        const acknowledgement = acknowledgements.get(data.id);
        if (acknowledgement?.frame === frame && acknowledgement.token === token) {
          acknowledgement.resolve(data.applied === true);
          acknowledgements.delete(data.id);
        }
        return;
      }
      if (
        data.action !== 'selection' ||
        typeof data.text !== 'string' ||
        !data.text.trim() ||
        typeof data.id !== 'string' ||
        data.id.length > 100 ||
        !Number.isFinite(data.x) ||
        !Number.isFinite(data.y)
      )
        return;
      const rect = frame.getBoundingClientRect();
      const snapshot = {
        text: data.text,
        valid: () => frame.isConnected && frames.get(frame) === token,
        apply: (translated, language) =>
          new Promise((resolve) => {
            const timer = setTimeout(() => {
              acknowledgements.delete(data.id);
              resolve(false);
            }, 4000);
            acknowledgements.set(data.id, {
              frame,
              token,
              resolve: (value) => {
                clearTimeout(timer);
                resolve(value);
              },
            });
            frame.contentWindow.postMessage(
              {
                type: 'inkwell-translation',
                token,
                action: 'apply',
                id: data.id,
                translation: translated,
                language,
              },
              '*',
            );
          }),
      };
      showMenu(snapshot, rect.left + data.x, rect.top + data.y);
    });
  };
  const settings = (root) => {
    const section = document.createElement('section');
    section.className = 'card';
    section.id = 'settings-local-translation';
    section.innerHTML =
      '<h2>Local translation</h2><p>Select text in received mail, a message you are writing, or Documents. Right-click → Translate → choose a language. Use the inline original pill to toggle. Translations run on this computer, not your configured cloud assistant.</p><p role="status">Checking local model…</p><button class="secondary" type="button">Set up local translation</button>';
    root.append(section);
    section.querySelector('button').onclick = () => setup();
    api('/translation')
      .then((result) => {
        if (!section.isConnected) return;
        section.querySelector('[role="status"]').textContent = result.ready
          ? result.model + ' · ready · on-device'
          : 'Download the 2.5 GB local model once to enable translation.';
      })
      .catch(() => {
        if (section.isConnected)
          section.querySelector('[role="status"]').textContent =
            'Local model status is unavailable.';
      });
  };
  return {
    initialize,
    settings,
    registerFrame: (frame, token) => frames.set(frame, token),
    html: core.html,
    focus: (textarea) => (mirrors.get(textarea)?.root || textarea).focus(),
    syncFromSource: (textarea) => {
      const entry = mirrors.get(textarea);
      if (entry) entry.root.textContent = textarea.value;
    },
    setHidden: (textarea, hidden) => {
      const entry = mirrors.get(textarea);
      if (entry) entry.root.hidden = hidden;
      else textarea.hidden = hidden;
    },
  };
})();
