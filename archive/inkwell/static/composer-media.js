'use strict';
window.InkwellComposerMedia = (form, data, toast) => {
  const root = document.documentElement;
  const fitViewport = () => {
    const zoom = Number.parseFloat(getComputedStyle(root).zoom) || 1;
    const nav = form.closest('dialog').classList.contains('inline-form')
      ? document.querySelector('.mobile-tabs')?.getBoundingClientRect().height || 0
      : 0;
    for (const [key, value] of [
      ['--compose-viewport-height', innerHeight / zoom + 'px'],
      ['--compose-mobile-nav-height', nav / zoom + 'px'],
    ])
      if (root.style.getPropertyValue(key) !== value) root.style.setProperty(key, value);
  };
  fitViewport();
  const viewportObserver = new MutationObserver(fitViewport);
  viewportObserver.observe(root, { attributes: true, attributeFilter: ['style'] });
  const viewportEvents = new AbortController();
  window.addEventListener('resize', fitViewport, { signal: viewportEvents.signal });
  form.closest('dialog').addEventListener(
    'close',
    () => {
      viewportObserver.disconnect();
      viewportEvents.abort();
      root.style.removeProperty('--compose-viewport-height');
      root.style.removeProperty('--compose-mobile-nav-height');
    },
    { once: true },
  );
  const plain = form.elements.body;
  const field = plain.closest('.field');
  field.classList.add('compose-message-field');
  for (const node of Array.from(field.childNodes))
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
      const caption = document.createElement('span');
      caption.className = 'sr-only';
      caption.textContent = node.textContent;
      node.replaceWith(caption);
    }
  const shell = document.createElement('div');
  shell.className = 'compose-body-shell';
  plain.before(shell);
  shell.append(plain);
  const editor = document.createElement('div');
  editor.id = 'compose-rich-body';
  editor.contentEditable = 'true';
  editor.setAttribute('role', 'textbox');
  editor.setAttribute('aria-label', 'Message with inline images');
  editor.setAttribute('aria-multiline', 'true');
  editor.hidden = true;
  shell.append(editor);
  const tools = document.createElement('div');
  tools.className = 'compose-media-tools';
  tools.innerHTML = `<button type="button" id="compose-attach" title="Attach files"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 12 7-7a4 4 0 0 1 6 6L10 22a6 6 0 0 1-8-8L13 3m-7 13 9-9"/></svg>Attach files</button><button type="button" id="compose-insert-image" title="Insert an image at the cursor"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/></svg>Insert image</button><button type="button" id="compose-format" aria-expanded="false" aria-controls="compose-format-tools"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M12 5v15M8 20h8"/></svg>Format</button><span class="fine-print compose-file-limit" title="Drop image files into the message at their insertion point. Up to 20 MB combined.">20 MB total</span><input type="file" id="compose-files" multiple hidden><input type="file" id="compose-images" multiple accept="image/png,image/jpeg,image/gif,image/webp" hidden>`;
  const formatTools = document.createElement('div');
  formatTools.id = 'compose-format-tools';
  formatTools.hidden = true;
  formatTools.innerHTML =
    '<button type="button" data-command="bold" aria-label="Bold" aria-pressed="false"><b>B</b></button><button type="button" data-command="italic" aria-label="Italic" aria-pressed="false"><i>I</i></button><button type="button" data-command="underline" aria-label="Underline" aria-pressed="false"><u>U</u></button>';
  tools.querySelector('#compose-format').after(formatTools);
  field.before(tools);
  const list = document.createElement('div');
  list.className = 'compose-file-list';
  list.setAttribute('aria-label', 'Outgoing attachments');
  field.before(list);
  const imageTools = document.createElement('div');
  imageTools.className = 'compose-image-tools';
  imageTools.hidden = true;
  imageTools.innerHTML =
    '<label>Image width <input type="number" aria-label="Image width" min="16" max="5000"></label><span>px · aspect ratio locked</span><button type="button" id="compose-crop">Crop image</button><button type="button" id="compose-remove-image">Remove image</button>';
  field.before(imageTools);
  const envelope = document.createElement('div');
  envelope.className = 'compose-envelope';
  for (const node of Array.from(form.children)) {
    if (node === tools) break;
    envelope.append(node);
  }
  form.prepend(envelope);
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.id = 'compose-image-resize';
  handle.hidden = true;
  handle.setAttribute('aria-label', 'Drag to resize image');
  shell.append(handle);
  let files = [...(data.compose_attachments || [])],
    rich = false,
    selected,
    savedRange,
    failure,
    cropPanel;
  let queue = Promise.resolve();
  const limit = 20 * 1024 * 1024;
  const activeFiles = () => {
    const ids = new Set(
      Array.from(editor.querySelectorAll('img')).map((image) => image.dataset.cid),
    );
    return files.filter((file) => !file.inline || ids.has(file.content_id));
  };
  const size = (f) =>
    Math.floor((f.content.length * 3) / 4) -
    (f.content.endsWith('==') ? 2 : f.content.endsWith('=') ? 1 : 0);
  const checkSize = (items) => {
    if (items.length > 50) throw Error('A message can contain up to 50 attachments.');
    if (items.reduce((n, f) => n + size(f), 0) > limit)
      throw Error(
        'Attachments are limited to 20 MB combined. Remove a file or use smaller images.',
      );
  };
  const uri = (file) => `data:${file.content_type};base64,${file.content}`;
  const changed = () => {
    if (rich) plain.value = editor.innerText;
    form.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const remember = () => {
    const selection = getSelection();
    if (selection.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer))
      savedRange = selection.getRangeAt(0).cloneRange();
  };
  const activate = () => {
    if (rich) return;
    const scroll = { top: plain.scrollTop, left: plain.scrollLeft };
    rich = true;
    plain.hidden = true;
    editor.hidden = false;
    editor.textContent = plain.value;
    savedRange = document.createRange();
    if (editor.firstChild)
      savedRange.setStart(
        editor.firstChild,
        Math.min(plain.selectionStart || 0, editor.firstChild.length),
      );
    else savedRange.selectNodeContents(editor);
    savedRange.collapse(true);

    editor.scrollTop = scroll.top;
    editor.scrollLeft = scroll.left;
  };
  function positionHandle() {
    if (!selected?.isConnected) {
      handle.hidden = true;
      return;
    }
    const a = selected.getBoundingClientRect(),
      b = shell.getBoundingClientRect();
    const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    handle.hidden = a.bottom > b.bottom || a.bottom < b.top || a.right > b.right;
    handle.style.left = `${(a.right - b.left) / zoom - 13}px`;
    handle.style.top = `${(a.bottom - b.top) / zoom - 13}px`;
  }
  function select(image) {
    selected?.classList.remove('compose-selected-image');
    selected = image;
    imageTools.hidden = !image;
    handle.hidden = !image;
    if (image) {
      image.classList.add('compose-selected-image');
      imageTools.querySelector('input').value = image.width;
      requestAnimationFrame(positionHandle);
    }
  }
  function renderFiles() {
    list.replaceChildren();
    for (const file of files.filter((f) => !f.inline)) {
      const item = document.createElement('span');
      item.className = 'compose-file';
      const label = document.createElement('span');
      label.textContent = `${file.name} · ${Math.ceil(size(file) / 1024)} KB`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Remove attachment ' + file.name);
      remove.onclick = () => {
        files = files.filter((f) => f !== file);
        renderFiles();
        changed();
      };
      item.append(label, remove);
      list.append(item);
    }
    if (failure) {
      const message = document.createElement('span');
      message.setAttribute('role', 'alert');
      message.textContent = failure.message + ' ';
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.textContent = 'Discard failed addition';
      dismiss.onclick = () => {
        failure = null;
        renderFiles();
        changed();
      };
      message.append(dismiss);
      list.append(message);
    }
  }
  function restore(html) {
    activate();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const allowed = new Set([
      'P',
      'DIV',
      'BR',
      'SPAN',
      'STRONG',
      'B',
      'EM',
      'I',
      'U',
      'S',
      'BLOCKQUOTE',
      'A',
      'UL',
      'OL',
      'LI',
      'IMG',
    ]);
    for (const node of Array.from(doc.body.querySelectorAll('*'))) {
      if (!allowed.has(node.tagName)) {
        node.remove();
        continue;
      }
      for (const attr of Array.from(node.attributes))
        if (
          !(
            node.tagName === 'IMG'
              ? ['src', 'alt', 'width', 'height']
              : node.tagName === 'A'
                ? ['href', 'title']
                : []
          ).includes(attr.name)
        )
          node.removeAttribute(attr.name);
      if (node.tagName === 'A' && !/^(https?:|mailto:)/i.test(node.getAttribute('href') || ''))
        node.removeAttribute('href');
      if (node.tagName === 'IMG') {
        const file = files.find(
          (f) => f.inline && 'cid:' + f.content_id === node.getAttribute('src'),
        );
        if (!file) {
          node.remove();
          continue;
        }
        node.dataset.cid = file.content_id;
        node.src = uri(file);
        node.draggable = false;
      }
    }
    editor.replaceChildren(...doc.body.childNodes);
    plain.value = editor.innerText;
  }
  if (data.html_body && data.folder === 'drafts') restore(data.html_body);
  renderFiles();
  const enqueue = (work) => {
    queue = queue.then(work).catch((error) => {
      failure = error;
      renderFiles();
      toast(error.message);
    });
    queue.then(() => changed());
  };
  const read = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(Error('Could not read ' + file.name));
      reader.readAsDataURL(file);
    });
  function insert(image, range) {
    editor.focus({ preventScroll: true });
    if (!range || !editor.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    // Insertion, not replacement: preserve the text on both sides of the drop caret.
    range.collapse(true);
    range.insertNode(image);
    range.setStartAfter(image);
    range.collapse(true);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    savedRange = range.cloneRange();
    select(image);
    changed();
  }
  function add(chosen, inline, range) {
    const items = Array.from(chosen);
    enqueue(async () => {
      for (const item of items) {
        if (item.size + activeFiles().reduce((n, f) => n + size(f), 0) > limit)
          throw Error('Attachments are limited to 20 MB combined.');
        const file = {
          name: item.name || 'image.png',
          content_type: item.type || 'application/octet-stream',
          content: await read(item),
          content_id: crypto.randomUUID() + '@inkwell',
          inline: inline && /^(image\/(png|jpeg|gif|webp))$/.test(item.type),
        };
        let image;
        if (file.inline) {
          image = new Image();
          image.alt = file.name;
          image.draggable = false;
          image.dataset.cid = file.content_id;
          await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () =>
              reject(Error('Cannot decode ' + file.name + '. Attach it as a file instead.'));
            image.src = uri(file);
          });
          if (
            image.naturalWidth * image.naturalHeight > 40_000_000 ||
            Math.max(image.naturalWidth, image.naturalHeight) > 16384
          )
            throw Error('This image is too large to edit inline. Attach it as a file instead.');
          image.width = Math.max(
            16,
            Math.round(Math.min(image.naturalWidth, editor.clientWidth - 32 || 640)),
          );
          image.height = Math.max(
            1,
            Math.round((image.width * image.naturalHeight) / image.naturalWidth),
          );
        }
        checkSize([...activeFiles(), file]);
        files.push(file);
        if (image) {
          insert(image, range);
          range = savedRange;
        }
      }
      failure = null;
      renderFiles();
    });
  }
  tools.querySelector('#compose-attach').onclick = () =>
    tools.querySelector('#compose-files').click();
  tools.querySelector('#compose-insert-image').onclick = () => {
    activate();
    remember();
    tools.querySelector('#compose-images').click();
  };
  tools.querySelector('#compose-format').onclick = () => {
    activate();
    formatTools.hidden = !formatTools.hidden;
    tools
      .querySelector('#compose-format')
      .setAttribute('aria-expanded', String(!formatTools.hidden));
    editor.focus({ preventScroll: true });
    changed();
  };
  for (const button of formatTools.querySelectorAll('button')) {
    button.onmousedown = (event) => event.preventDefault();
    button.onclick = () => {
      editor.focus({ preventScroll: true });
      if (savedRange && editor.contains(savedRange.commonAncestorContainer)) {
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(savedRange);
      }
      document.execCommand(button.dataset.command, false);
      remember();
      for (const control of formatTools.querySelectorAll('button'))
        control.setAttribute(
          'aria-pressed',
          String(document.queryCommandState(control.dataset.command)),
        );
      changed();
    };
  }

  for (const [id, inline] of [
    ['compose-files', false],
    ['compose-images', true],
  ])
    tools.querySelector('#' + id).onchange = (event) => {
      add(event.target.files, inline, savedRange?.cloneRange());
      event.target.value = '';
    };
  shell.addEventListener('dragenter', (event) => {
    if (
      Array.from(event.dataTransfer?.items || []).some(
        (i) => i.kind === 'file' && i.type.startsWith('image/'),
      )
    )
      activate();
  });
  shell.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  });
  shell.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files.length) {
      if (rich) {
        event.preventDefault();
        editor.focus();
        const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
        if (range && editor.contains(range.commonAncestorContainer)) {
          const selection = getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
        document.execCommand('insertText', false, event.dataTransfer?.getData('text/plain') || '');
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const chosen = Array.from(event.dataTransfer.files);
    if (chosen.some((f) => f.type.startsWith('image/'))) activate();
    let range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (!range && document.caretPositionFromPoint) {
      const caret = document.caretPositionFromPoint(event.clientX, event.clientY);
      if (caret) {
        range = document.createRange();
        range.setStart(caret.offsetNode, caret.offset);
        range.collapse(true);
      }
    }
    add(chosen, true, range?.cloneRange());
  });
  editor.addEventListener('paste', (event) => {
    event.preventDefault();
    remember();
    const pasted = Array.from(event.clipboardData.files);
    if (pasted.length) add(pasted, true, savedRange?.cloneRange());
    else document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
  });
  plain.addEventListener('paste', (event) => {
    if (event.clipboardData.files.length) {
      event.preventDefault();
      activate();
      add(event.clipboardData.files, true, savedRange?.cloneRange());
    }
  });
  editor.addEventListener('input', () => {
    plain.value = editor.innerText;
    if (selected && !selected.isConnected) select(null);
    positionHandle();
  });
  editor.addEventListener('click', (event) => {
    select(event.target.closest('img'));
    remember();
  });
  editor.addEventListener('keyup', remember);
  editor.addEventListener('mouseup', remember);
  editor.addEventListener('scroll', positionHandle);
  function resize(width) {
    if (!selected) return;
    selected.width = Math.round(
      Math.max(16, Math.min(Number(width) || 16, editor.clientWidth - 32)),
    );
    selected.height = Math.max(
      1,
      Math.round((selected.width * selected.naturalHeight) / selected.naturalWidth),
    );
    imageTools.querySelector('input').value = selected.width;
    positionHandle();
    changed();
  }
  imageTools.querySelector('input').oninput = (event) => resize(event.target.value);
  handle.onpointerdown = (event) => {
    event.preventDefault();
    const x = event.clientX,
      width = selected.width;
    const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    handle.setPointerCapture(event.pointerId);
    handle.onpointermove = (move) => resize(width + (move.clientX - x) / zoom);
    handle.onpointerup = handle.onpointercancel = () => {
      handle.onpointermove = null;
      changed();
    };
  };
  imageTools.querySelector('#compose-remove-image').onclick = () => {
    selected?.remove();
    select(null);
    changed();
  };
  imageTools.querySelector('#compose-crop').onclick = () => {
    if (!selected || cropPanel) return;
    const image = selected,
      width = image.naturalWidth,
      height = image.naturalHeight;
    cropPanel = document.createElement('section');
    cropPanel.className = 'compose-crop-panel';
    cropPanel.setAttribute('aria-label', 'Crop inline image');
    cropPanel.innerHTML =
      '<strong>Crop image · drag a rectangle or enter pixels</strong><canvas aria-label="Select crop rectangle"></canvas><div class="compose-crop-fields">' +
      ['Left', 'Top', 'Width', 'Height']
        .map(
          (label) =>
            `<label>${label}<input type="number" aria-label="Crop ${label.toLowerCase()}" min="${['Width', 'Height'].includes(label) ? 1 : 0}"></label>`,
        )
        .join('') +
      '</div><div><button type="button" class="primary" id="compose-apply-crop">Apply crop</button><button type="button" id="compose-cancel-crop">Cancel crop</button></div>';
    shell.append(cropPanel);
    handle.hidden = true;
    const canvas = cropPanel.querySelector('canvas'),
      ctx = canvas.getContext('2d');
    const scale = Math.min(1, 900 / width, 600 / height);
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const inputs = Array.from(cropPanel.querySelectorAll('input'));
    [0, 0, width, height].forEach((n, i) => {
      inputs[i].value = n;
    });
    const rect = () => inputs.map((input) => Number(input.value));
    const draw = () => {
      const [x, y, w, h] = rect(),
        scale = canvas.width / width;
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#0008';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x * scale, y * scale, w * scale, h * scale);
      ctx.clip();
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      ctx.restore();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(x * scale, y * scale, w * scale, h * scale);
    };
    inputs.forEach((input) => {
      input.oninput = draw;
    });
    draw();
    const point = (event) => {
      const b = canvas.getBoundingClientRect();
      return [
        Math.max(0, Math.min(width, ((event.clientX - b.left) * width) / b.width)),
        Math.max(0, Math.min(height, ((event.clientY - b.top) * height) / b.height)),
      ];
    };
    canvas.onpointerdown = (event) => {
      event.preventDefault();
      const first = point(event);
      canvas.setPointerCapture(event.pointerId);
      canvas.onpointermove = (move) => {
        const last = point(move);
        [
          Math.min(first[0], last[0]),
          Math.min(first[1], last[1]),
          Math.abs(first[0] - last[0]),
          Math.abs(first[1] - last[1]),
        ].forEach((n, i) => {
          inputs[i].value = Math.round(n);
        });
        draw();
      };
      canvas.onpointerup = canvas.onpointercancel = () => {
        canvas.onpointermove = null;
      };
    };
    const close = () => {
      cropPanel.remove();
      cropPanel = null;
      positionHandle();
    };
    cropPanel.querySelector('#compose-cancel-crop').onclick = close;
    cropPanel.querySelector('#compose-apply-crop').onclick = () => {
      const [x, y, w, h] = rect();
      if (
        ![x, y, w, h].every(Number.isInteger) ||
        x < 0 ||
        y < 0 ||
        w < 1 ||
        h < 1 ||
        x + w > width ||
        y + h > height
      ) {
        toast('Choose a crop rectangle inside the image.');
        return;
      }
      enqueue(async () => {
        const output = document.createElement('canvas');
        output.width = w;
        output.height = h;
        output.getContext('2d').drawImage(image, x, y, w, h, 0, 0, w, h);
        const file = files.find((f) => f.content_id === image.dataset.cid);
        const replacement = {
          ...file,
          name: file.name.replace(/\.[^.]+$/, '') + '.png',
          content_type: 'image/png',
          content: output.toDataURL('image/png').split(',')[1],
        };
        checkSize(activeFiles().map((f) => (f === file ? replacement : f)));
        files = files.map((f) => (f === file ? replacement : f));
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = () => reject(Error('Could not load cropped image'));
          image.src = uri(replacement);
        });
        image.width = Math.max(16, Math.min(image.width, w));
        image.height = Math.max(1, Math.round((image.width * h) / w));
        close();
        select(image);
        changed();
      });
    };
  };
  const observer = new ResizeObserver(positionHandle);
  observer.observe(shell);
  form.closest('dialog').addEventListener('close', () => observer.disconnect(), { once: true });
  const values = () => {
    let html = null;
    if (rich) {
      const copy = editor.cloneNode(true),
        used = new Set();
      for (const image of copy.querySelectorAll('img')) {
        used.add(image.dataset.cid);
        image.setAttribute('src', 'cid:' + image.dataset.cid);
        image.removeAttribute('class');
        image.removeAttribute('data-cid');
        image.removeAttribute('draggable');
      }
      html = copy.innerHTML;
      return {
        html_body: html,
        attachments: files.filter((f) => !f.inline || used.has(f.content_id)),
      };
    }
    return { html_body: html, attachments: files.filter((f) => !f.inline) };
  };
  return {
    values,
    focus: () => (rich ? editor.focus() : InkwellTranslation.focus(plain)),
    get ready() {
      return queue.then(() => {
        if (failure) throw failure;
      });
    },
    get cropping() {
      return !!cropPanel;
    },
  };
};
