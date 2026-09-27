'use strict';
window.InkwellDocuments = (() => {
  let session = null;
  const icon = {
    folder: '▸',
    file: '▤',
  };
  const safe = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
  const query = (value) => encodeURIComponent(value);
  const url = (path, page, width = 220) =>
    `/api/documents/page?path=${query(path)}&page=${page}&width=${width}`;
  const money = (size) => `${Math.round(size / 1024)} KB`;

  function confirmLeave() {
    return !session?.dirty || confirm('This document has unsaved edits. Discard them?');
  }
  window.addEventListener('beforeunload', (event) => {
    if (!session?.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
  function stop() {
    if (session?.dialog?.open) session.dialog.close();
    session = null;
  }
  function mount({ root, nav, api, toast, isCurrent }) {
    stop();
    const current = {
      root,
      nav,
      api,
      toast,
      isCurrent,
      dirty: false,
      document: null,
      page: 0,
      pdfTool: '',
      selection: null,
      image: null,
      directory: '',
      showLineNumbers: false,
    };
    session = current;
    const $ = (selector) => root.querySelector(selector);
    const go = (task) =>
      Promise.resolve()
        .then(task)
        .catch((error) => toast(error.message));
    const live = () => current === session && isCurrent();
    const controls = (disabled) => {
      root.querySelectorAll('[data-doc-needs-file]').forEach((button) => {
        button.disabled = disabled;
      });
      $('#doc-save').disabled = disabled || !current.dirty || current.document?.mode === 'pdf';
    };
    const status = (message) => {
      $('#doc-status').textContent = message;
    };
    const markDirty = () => {
      current.dirty = true;
      status('Unsaved changes');
      controls(false);
    };

    nav.innerHTML =
      '<div class="doc-sidebar"><div class="doc-nav-heading"><strong>Documents</strong><button type="button" id="doc-refresh" title="Refresh files" aria-label="Refresh files">↻</button></div><div class="doc-nav-actions"><button type="button" id="doc-new-folder">＋ Folder</button><button type="button" id="doc-new-file">＋ File</button><label title="Import files into the selected folder">↥ Import<input id="doc-import" type="file" multiple hidden></label></div><details id="doc-recent-group" open><summary>Recent files</summary><div id="doc-recent"></div></details><div id="doc-tree" role="tree" aria-label="Documents folder tree"></div></div>';
    root.innerHTML = `<div class="doc-shell" id="documents-workspace"><aside class="doc-pages" id="doc-pages" aria-label="Document page thumbnails"><div class="doc-pages-heading">Pages <button type="button" id="doc-hide-pages" aria-label="Close page thumbnails" title="Close page thumbnails">×</button></div><div id="doc-thumbnails"><p class="doc-empty">Open a document to see its pages.</p></div></aside><section class="doc-main"><header class="doc-ribbon"><div class="doc-ribbon-title"><button class="secondary" type="button" id="doc-show-pages" title="Show page thumbnails" aria-label="Show page thumbnails">▤ Pages</button><strong id="doc-file-name">Document editor</strong><span id="doc-status" role="status">Select a file from Documents or Recent.</span><button class="primary" type="button" id="doc-save" disabled title="Save document (Ctrl+S)">Save</button><a class="secondary hidden" id="doc-download" download title="Download a copy of this document">Download</a></div><div class="doc-ribbon-tools" id="doc-ribbon-tools" hidden><div id="doc-rich-tools" class="doc-toolset" hidden><select id="doc-style" aria-label="Paragraph style" title="Paragraph style"><option value="p">Normal text</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="blockquote">Quote</option></select><select id="doc-font" aria-label="Font"><option value="Arial">Arial</option><option value="Georgia">Georgia</option><option value="Times New Roman">Times New Roman</option><option value="Courier New">Courier New</option></select><select id="doc-font-size" aria-label="Font size"><option value="2">Small</option><option value="3" selected>Normal</option><option value="4">Large</option><option value="5">Extra large</option></select><button data-doc-command="bold" title="Bold (Ctrl+B)" aria-label="Bold"><b>B</b></button><button data-doc-command="italic" title="Italic (Ctrl+I)" aria-label="Italic"><i>I</i></button><button data-doc-command="underline" title="Underline (Ctrl+U)" aria-label="Underline"><u>U</u></button><button data-doc-command="strikeThrough" title="Strikethrough" aria-label="Strikethrough"><s>S</s></button><label class="doc-color-control" title="Text color">Text <input id="doc-color" type="color" aria-label="Text color" value="#26372b"></label><button data-doc-command="insertUnorderedList" title="Bulleted list" aria-label="Bulleted list">• List</button><button data-doc-command="insertOrderedList" title="Numbered list" aria-label="Numbered list">1. List</button><button data-doc-command="justifyLeft" title="Align left" aria-label="Align left">≡</button><button data-doc-command="justifyCenter" title="Center" aria-label="Center text">≡</button><button data-doc-command="justifyRight" title="Align right" aria-label="Align right">≡</button><button data-doc-command="indent" title="Indent paragraph (Tab)" aria-label="Indent paragraph">→</button><button data-doc-command="outdent" title="Outdent paragraph (Shift+Tab)" aria-label="Outdent paragraph">←</button><button id="doc-table" title="Insert a table">▦ Table</button><button id="doc-link" title="Insert a link">↗ Link</button><button id="doc-insert-image" title="Insert an image">▧ Image</button><label id="doc-image-settings" hidden>Image width <input id="doc-image-width" type="range" min="80" max="900" value="480"><select id="doc-image-wrap" aria-label="Image placement"><option value="">Inline</option><option value="doc-float-left">Left · wrap text</option><option value="doc-float-right">Right · wrap text</option></select></label></div><div id="doc-text-tools" class="doc-toolset" hidden><button id="doc-indent" type="button" title="Indent selected lines">→ Indent</button><button id="doc-outdent" type="button" title="Outdent selected lines">← Outdent</button><button id="doc-wrap" type="button" aria-pressed="true">Wrap lines</button><button id="doc-preview" type="button" hidden>Preview Markdown</button></div><div id="doc-pdf-tools" class="doc-toolset" hidden><button type="button" data-pdf-tool="redact" title="Select an area to irreversibly remove content from a new PDF copy">■ Redact area</button><button type="button" id="doc-pdf-place-image" title="Place an image in a selected PDF area">▧ Place image</button><button type="button" data-pdf-tool="text" title="Place editable text overlay in a selected PDF area">T Add text</button><button type="button" id="doc-signature" title="Draw, import or digitally sign this PDF">✎ Signature</button><button type="button" id="doc-pdf-apply" disabled>Apply to new PDF copy</button><button type="button" id="doc-pdf-compress" title="Try reducing the PDF file size and keep the original">↧ Compress PDF</button></div><label class="doc-line-toggle"><input id="doc-line-numbers" type="checkbox"> Line numbers</label></div></header><div class="doc-editor-viewport" id="doc-editor-viewport"><div class="doc-empty doc-welcome"><h2>Your documents, together.</h2><p>Open or import a PDF, Word document, Markdown, CSV or another text file from the folder tree.</p><p>Files stay in your Documents directory. PDF redactions and signatures create new copies; originals remain available.</p></div></div></section><dialog id="doc-sign-dialog" aria-labelledby="doc-sign-title"><h2 id="doc-sign-title">Sign PDF</h2><p>Choose an area on the PDF page first, or use the bottom-right of the page by default.</p><div class="doc-sign-tabs"><button type="button" data-sign-tab="draw">Draw</button><button type="button" data-sign-tab="image">Image</button><button type="button" data-sign-tab="digital">Digital certificate</button></div><section id="doc-sign-draw"><canvas id="doc-sign-canvas" width="520" height="160" aria-label="Draw your signature using a mouse, pen or touch"></canvas><button type="button" id="doc-sign-clear">Clear drawing</button><button type="button" id="doc-sign-use-drawing" class="primary">Place drawn signature</button></section><section id="doc-sign-image" hidden><label>Signature image (PNG, JPEG, WebP or GIF) <input id="doc-sign-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><button type="button" id="doc-sign-use-image" class="primary">Place image signature</button></section><section id="doc-sign-digital" hidden><p>Cryptographically sign a new PDF copy with your PKCS#12 certificate (.p12 or .pfx). Your certificate and password are sent only to your Inkwell backend for this request and are never stored.</p><label>PKCS#12 certificate <input id="doc-cert-file" type="file" accept=".p12,.pfx"></label><label>Certificate password <input id="doc-cert-pass" type="password" autocomplete="off"></label><button type="button" id="doc-cert-apply" class="primary">Digitally sign a new PDF copy</button></section><button type="button" id="doc-sign-close" class="secondary">Cancel</button></dialog><input id="doc-image-file" type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif">`;
    current.dialog = $('#doc-sign-dialog');

    async function refreshRecent() {
      const entries = await api('/documents/recent');
      if (!live()) return;
      nav.querySelector('#doc-recent').innerHTML = entries.length
        ? entries
            .map(
              (entry) =>
                `<button type="button" data-doc-file="${safe(entry.path)}" title="${safe(entry.path)}">${icon.file} ${safe(entry.name)}</button>`,
            )
            .join('')
        : '<span class="doc-side-muted">No recently opened files</span>';
    }
    async function list(path, target) {
      const result = await api('/documents/tree?path=' + query(path));
      if (!live() || !target.isConnected) return;
      target.innerHTML = result.children.length
        ? result.children
            .map(
              (child) =>
                `<div class="doc-tree-entry" role="treeitem" aria-label="${safe(child.name)}"><button type="button" class="doc-tree-row ${child.directory ? 'doc-folder-row' : ''}" ${child.directory ? `data-doc-folder="${safe(child.path)}" aria-expanded="false"` : `data-doc-file="${safe(child.path)}"`} title="${safe(child.path)}"><span aria-hidden="true">${child.directory ? icon.folder : icon.file}</span><span>${safe(child.name)}</span></button>${child.directory ? `<div class="doc-tree-children" data-child-of="${safe(child.path)}" hidden role="group"></div>` : ''}</div>`,
            )
            .join('')
        : '<span class="doc-side-muted">Empty folder</span>';
    }
    async function refreshTree() {
      const tree = nav.querySelector('#doc-tree');
      tree.innerHTML =
        '<button id="doc-root-folder" class="doc-tree-row" type="button" aria-expanded="true" data-doc-folder="" title="Your Documents folder">▾ Documents</button><div id="doc-root-children" role="group"></div>';
      await list('', nav.querySelector('#doc-root-children'));
      await refreshRecent();
    }
    function highlight() {
      nav
        .querySelectorAll('[data-doc-file]')
        .forEach((button) =>
          button.classList.toggle('active', button.dataset.docFile === current.document?.path),
        );
    }
    function pagePreview(page) {
      const doc = current.document;
      if (!doc) return;
      current.page = page;
      current.selection = null;
      $('#doc-thumbnails')
        .querySelectorAll('[data-doc-page]')
        .forEach((button) =>
          button.classList.toggle('active', Number(button.dataset.docPage) === page),
        );
      const editor = $('#doc-editor-viewport');
      editor.innerHTML = `<div class="doc-pdf-paper" id="doc-pdf-paper"><img id="doc-pdf-image" src="${url(doc.path, page, 1100)}" alt="PDF page ${page + 1}"><div class="doc-pdf-overlay" id="doc-pdf-overlay" aria-label="Select an area on the PDF page"></div></div>`;
      editor.scrollTop = 0;
      status(
        `${doc.pages.length} page${doc.pages.length === 1 ? '' : 's'} · PDF edits save as new copies`,
      );
    }
    function thumbnails() {
      const doc = current.document;
      if (!doc) return;
      if (doc.mode === 'pdf') {
        $('#doc-thumbnails').innerHTML = doc.pages
          .map(
            (page, index) =>
              `<button type="button" class="doc-page-thumb ${index === current.page ? 'active' : ''}" data-doc-page="${index}" aria-label="Page ${index + 1}"><img loading="lazy" src="${url(doc.path, index)}" alt="Page ${index + 1} thumbnail"><span>Page ${index + 1}</span></button>`,
          )
          .join('');
      } else {
        const source =
          doc.mode === 'text'
            ? doc.content.split('\n')
            : doc.content
                .replace(/<img\b[^>]*>/gi, ' [Image] ')
                .replace(/<[^>]+>/g, ' ')
                .split(/\s+/);
        const chunk = doc.mode === 'text' ? 85 : 250;
        const pages = Math.max(1, Math.ceil(source.length / chunk));
        $('#doc-thumbnails').innerHTML = Array.from(
          { length: Math.min(pages, 300) },
          (_, index) =>
            `<button type="button" class="doc-page-thumb ${index === 0 ? 'active' : ''}" data-doc-page="${index}" aria-label="Section ${index + 1}"><span class="doc-thumb-text">${safe(source.slice(index * chunk, index * chunk + 18).join(' '))}</span><span>${doc.mode === 'text' ? `Lines ${index * chunk + 1}–${Math.min((index + 1) * chunk, source.length)}` : `Section ${index + 1}`}</span></button>`,
        ).join('');
      }
    }
    function showDoc() {
      const doc = current.document;
      $('#doc-file-name').textContent = doc.name;
      $('#doc-download').classList.remove('hidden');
      $('#doc-download').href = '/api/documents/download?path=' + query(doc.path);
      $('#doc-download').download = doc.name;
      $('#doc-ribbon-tools').hidden = false;
      for (const mode of ['rich', 'text', 'pdf'])
        $('#doc-' + mode + '-tools').hidden = doc.mode !== mode;
      $('#doc-line-numbers').checked = current.showLineNumbers;
      $('#doc-line-numbers').disabled = doc.mode === 'pdf';
      current.dirty = false;
      controls(false);
      thumbnails();
      const editor = $('#doc-editor-viewport');
      if (doc.mode === 'pdf') return pagePreview(0);
      if (doc.mode === 'rich') {
        editor.innerHTML = `<div class="doc-paper"><div id="doc-rich-editor" class="doc-rich-editor ${current.showLineNumbers ? 'line-numbers' : ''}" contenteditable="true" role="textbox" aria-label="Document content" aria-multiline="true" spellcheck="true"></div></div>`;
        $('#doc-rich-editor').innerHTML = doc.content;
        status('Ready to edit · Ctrl+S to save');
      } else {
        editor.innerHTML = `<div class="doc-code-shell"><pre class="doc-code-lines ${current.showLineNumbers ? '' : 'hidden'}" id="doc-code-lines" aria-hidden="true"></pre><textarea id="doc-code-editor" aria-label="Document content" spellcheck="false" wrap="soft"></textarea></div><div id="doc-markdown-preview" hidden></div>`;
        $('#doc-code-editor').value = doc.content;
        $('#doc-preview').hidden = !['md', 'mdx'].includes(doc.kind);
        refreshLines();
        status(`${doc.content.split('\n').length} lines · Ctrl+S to save`);
      }
      editor.scrollTop = 0;
      highlight();
    }
    function refreshLines() {
      const text = $('#doc-code-editor');
      const lines = $('#doc-code-lines');
      if (!text || !lines) return;
      const count = Math.min(text.value.split('\n').length, 5000);
      lines.textContent = Array.from({ length: count }, (_, index) => index + 1).join('\n');
      lines.scrollTop = text.scrollTop;
    }
    async function open(path) {
      if (current.dirty && !confirmLeave()) return;
      const result = await api('/documents/open?path=' + query(path));
      if (!live()) return;
      current.document = result;
      current.directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      current.pdfTool = '';
      current.image = null;
      showDoc();
      highlight();
      document.querySelector('#sidebar')?.classList.remove('open');
      await refreshRecent();
    }
    async function save() {
      const doc = current.document;
      if (!doc || doc.mode === 'pdf' || !current.dirty) return;
      const content =
        doc.mode === 'rich' ? $('#doc-rich-editor').innerHTML : $('#doc-code-editor').value;
      const result = await api('/documents/content', {
        method: 'PUT',
        body: { path: doc.path, revision: doc.revision, content },
      });
      if (!live()) return;
      doc.revision = result.revision;
      doc.content = content;
      current.dirty = false;
      status('Saved to Documents');
      controls(false);
      thumbnails();
    }
    async function fileToImage(file) {
      if (!file || file.size > 5_000_000 || !/^image\/(png|jpeg|webp|gif)$/.test(file.type))
        throw Error('Choose a PNG, JPEG, WebP or GIF under 5 MB');
      const source = await createImageBitmap(file);
      const ratio = Math.min(1, 1600 / Math.max(source.width, source.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(source.width * ratio));
      canvas.height = Math.max(1, Math.round(source.height * ratio));
      canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
      source.close();
      return canvas.toDataURL('image/png');
    }
    function pdfMode(mode) {
      current.pdfTool = mode;
      current.selection = null;
      root
        .querySelectorAll('[data-pdf-tool]')
        .forEach((button) => button.classList.toggle('active', button.dataset.pdfTool === mode));
      $('#doc-pdf-apply').disabled = !mode || mode === 'digital';
      status(
        mode
          ? `Draw a rectangle on the PDF page${mode === 'redact' ? ' to permanently remove its contents from a new copy' : ' to place ' + mode}`
          : 'Select a PDF tool',
      );
      $('#doc-pdf-overlay')?.classList.toggle('selecting', !!mode);
      $('#doc-pdf-overlay')?.querySelector('.doc-selection')?.remove();
    }
    function rectangle() {
      const doc = current.document;
      if (!doc || doc.mode !== 'pdf') throw Error('Open a PDF first');
      return (
        current.selection || [
          doc.pages[current.page].width - 220,
          doc.pages[current.page].height - 95,
          doc.pages[current.page].width - 20,
          doc.pages[current.page].height - 25,
        ]
      );
    }
    async function operation(action, extra = {}) {
      const doc = current.document;
      if (!doc || doc.mode !== 'pdf') return;
      if (
        action === 'redact' &&
        !confirm(
          'Permanently remove the selected PDF content in a NEW copy? The original will be kept.',
        )
      )
        return;
      const payload = {
        path: doc.path,
        page: current.page,
        action,
        ...(action === 'compress' ? {} : { rect: rectangle() }),
        ...extra,
      };
      const result = await api('/documents/pdf', { method: 'POST', body: payload });
      if (result.path === doc.path)
        return status(result.message || 'No smaller PDF could be created');
      await refreshTree();
      await open(result.path);
      status(
        action === 'compress'
          ? `Saved ${money(result.saved_bytes)} in a new PDF copy`
          : `${action} saved as a new PDF copy · original unchanged`,
      );
    }
    async function useSignature(data) {
      const selection = current.selection;
      current.image = data;
      current.dialog.close();
      pdfMode('signature');
      current.selection = selection;
      if (selection) await operation('signature', { image: data });
    }
    async function importFiles(files) {
      let last;
      for (const file of files) {
        if (!file.size || file.size > 40_000_000) {
          toast(`${file.name}: document must be under 40 MB`);
          continue;
        }
        const response = await fetch(
          `/api/documents/import?path=${query(current.directory)}&name=${query(file.name)}`,
          {
            method: 'POST',
            headers: { 'X-Inkwell': '1', 'Content-Type': 'application/octet-stream' },
            body: file,
          },
        );
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          toast(`${file.name}: ${detail.detail || 'Import failed'}`);
          continue;
        }
        last = (await response.json()).path;
      }
      await refreshTree();
      if (last) await open(last);
    }

    nav.addEventListener('click', (event) =>
      go(async () => {
        if (event.target.closest('#doc-refresh')) return refreshTree();
        if (event.target.closest('#doc-new-folder')) {
          const name = prompt('New folder name');
          if (!name) return;
          await api('/documents/folder', {
            method: 'POST',
            body: { path: current.directory, name },
          });
          await refreshTree();
          return;
        }
        if (event.target.closest('#doc-new-file')) {
          const name = prompt(
            'New document name (include .docx, .pdf, .md, .csv, etc.)',
            'Untitled.docx',
          );
          if (!name) return;
          const result = await api('/documents/file', {
            method: 'POST',
            body: { path: current.directory, name },
          });
          await refreshTree();
          return open(result.path);
        }
        const button = event.target.closest('[data-doc-file], [data-doc-folder]');
        if (!button) return;
        if (button.hasAttribute('data-doc-file')) return open(button.dataset.docFile);
        const path = button.dataset.docFolder;
        current.directory = path;
        const openFolder = button.getAttribute('aria-expanded') !== 'true';
        button.setAttribute('aria-expanded', String(openFolder));
        button.firstElementChild && (button.firstElementChild.textContent = openFolder ? '▾' : '▸');
        const children = path
          ? nav.querySelectorAll('[data-child-of]')
          : [nav.querySelector('#doc-root-children')];
        const container = [...children].find((child) => (child.dataset.childOf || '') === path);
        if (!container) return;
        container.hidden = !openFolder;
        if (openFolder && !container.dataset.loaded) {
          await list(path, container);
          container.dataset.loaded = 'true';
        }
      }),
    );
    nav.querySelector('#doc-import').addEventListener('change', (event) =>
      go(async () => {
        const files = [...event.target.files];
        event.target.value = '';
        if (files.length) await importFiles(files);
      }),
    );
    root.addEventListener('click', (event) =>
      go(async () => {
        const pageButton = event.target.closest('[data-doc-page]');
        if (pageButton) {
          const page = Number(pageButton.dataset.docPage);
          if (current.document.mode === 'pdf') return pagePreview(page);
          $('#doc-thumbnails')
            .querySelectorAll('[data-doc-page]')
            .forEach((button) => button.classList.toggle('active', button === pageButton));
          if (current.document.mode === 'text') {
            const target = $('#doc-code-editor');
            target.focus();
            target.setSelectionRange(0, 0);
            target.scrollTop = page * 85 * 20;
          } else $('#doc-rich-editor')?.children?.[page * 8]?.scrollIntoView({ block: 'start' });
          return;
        }
        if (event.target.closest('#doc-save')) return save();
        if (event.target.closest('#doc-show-pages')) return root.classList.toggle('pages-open');
        if (event.target.closest('#doc-hide-pages')) return root.classList.remove('pages-open');
        if (event.target.closest('#doc-indent')) return indentText(false);
        if (event.target.closest('#doc-outdent')) return indentText(true);
        if (event.target.closest('#doc-wrap')) {
          const button = $('#doc-wrap'),
            wrapped = button.getAttribute('aria-pressed') === 'true';
          button.setAttribute('aria-pressed', String(!wrapped));
          $('#doc-code-editor').wrap = wrapped ? 'off' : 'soft';
          return;
        }
        if (event.target.closest('#doc-preview')) {
          const panel = $('#doc-markdown-preview');
          if (!panel.hidden) {
            panel.hidden = true;
            return;
          }
          panel.innerHTML = (
            await api('/documents/preview', {
              method: 'POST',
              body: { content: $('#doc-code-editor').value },
            })
          ).html;
          panel.hidden = false;
          return;
        }
        if (event.target.closest('#doc-table')) {
          const rows = Math.max(1, Math.min(Number(prompt('Number of rows (1–20)', '3')), 20)),
            columns = Math.max(1, Math.min(Number(prompt('Number of columns (1–12)', '3')), 12));
          if (!rows || !columns) return;
          $('#doc-rich-editor').focus();
          document.execCommand(
            'insertHTML',
            false,
            '<table><tbody>' +
              Array.from(
                { length: rows },
                () => '<tr>' + '<td><p><br></p></td>'.repeat(columns) + '</tr>',
              ).join('') +
              '</tbody></table><p><br></p>',
          );
          markDirty();
          return;
        }
        if (event.target.closest('#doc-link')) {
          const href = prompt('Link URL (https:// or mailto:)');
          if (!href || !/^(https:\/\/|mailto:)/i.test(href)) return;
          $('#doc-rich-editor').focus();
          document.execCommand('createLink', false, href);
          markDirty();
          return;
        }
        if (
          event.target.closest('#doc-insert-image') ||
          event.target.closest('#doc-pdf-place-image')
        ) {
          $('#doc-image-file').dataset.mode = event.target.closest('#doc-pdf-place-image')
            ? 'pdf'
            : 'rich';
          $('#doc-image-file').click();
          return;
        }
        if (event.target.closest('#doc-signature')) {
          current.dialog.showModal();
          setSignTab('draw');
          return;
        }
        if (event.target.closest('#doc-sign-close')) {
          current.dialog.close();
          return;
        }
        if (event.target.closest('#doc-sign-clear')) {
          $('#doc-sign-canvas').getContext('2d').clearRect(0, 0, 520, 160);
          return;
        }
        if (event.target.closest('#doc-sign-use-drawing')) {
          const pixels = $('#doc-sign-canvas').getContext('2d').getImageData(0, 0, 520, 160).data;
          if (!pixels.some((value, index) => index % 4 === 3 && value))
            throw Error('Draw a signature first');
          return useSignature($('#doc-sign-canvas').toDataURL('image/png'));
        }
        if (event.target.closest('#doc-sign-use-image')) {
          const file = $('#doc-sign-file').files?.[0];
          return useSignature(await fileToImage(file));
        }
        if (event.target.closest('#doc-cert-apply')) {
          const file = $('#doc-cert-file').files?.[0];
          if (!file || file.size > 2_000_000)
            throw Error('Choose a .p12 or .pfx certificate under 2 MB');
          const data = await file.arrayBuffer();
          const bytes = new Uint8Array(data);
          let raw = '';
          for (const byte of bytes) raw += String.fromCharCode(byte);
          const result = await api('/documents/sign', {
            method: 'POST',
            body: {
              path: current.document.path,
              certificate: btoa(raw),
              password: $('#doc-cert-pass').value,
              page: current.page,
              rect: current.selection || null,
            },
          });
          $('#doc-cert-pass').value = '';
          current.dialog.close();
          await refreshTree();
          await open(result.path);
          status('Digitally signed a new PDF copy · original unchanged');
          return;
        }
        const signTab = event.target.closest('[data-sign-tab]');
        if (signTab) return setSignTab(signTab.dataset.signTab);
        const pdfTool = event.target.closest('[data-pdf-tool]');
        if (pdfTool)
          return pdfMode(
            current.pdfTool === pdfTool.dataset.pdfTool ? '' : pdfTool.dataset.pdfTool,
          );
        if (event.target.closest('#doc-pdf-apply')) {
          if (!current.selection) throw Error('Draw a rectangle on the PDF page first');
          if (current.pdfTool === 'text') {
            const text = prompt('Text to place on this PDF page');
            if (!text) return;
            return operation('text', { text });
          }
          return operation(
            current.pdfTool === 'signature' ? 'signature' : current.pdfTool,
            current.pdfTool === 'signature' || current.pdfTool === 'image'
              ? { image: current.image }
              : {},
          );
        }
        if (event.target.closest('#doc-pdf-compress')) return operation('compress');
        const command = event.target.closest('[data-doc-command]');
        if (command) {
          $('#doc-rich-editor').focus();
          document.execCommand(command.dataset.docCommand, false);
          markDirty();
        }
      }),
    );
    root.addEventListener('pointerdown', (event) => {
      if (event.target.closest('[data-doc-command]')) event.preventDefault();
      const overlay = event.target.closest('#doc-pdf-overlay');
      if (!overlay || !current.pdfTool) return;
      event.preventDefault();
      overlay.setPointerCapture(event.pointerId);
      const bounds = overlay.getBoundingClientRect();
      const start = {
        x: Math.max(0, Math.min(event.clientX - bounds.left, bounds.width)),
        y: Math.max(0, Math.min(event.clientY - bounds.top, bounds.height)),
      };
      const selected = document.createElement('div');
      selected.className = 'doc-selection';
      overlay.querySelector('.doc-selection')?.remove();
      overlay.append(selected);
      const move = (pointer) => {
        const x = Math.max(0, Math.min(pointer.clientX - bounds.left, bounds.width));
        const y = Math.max(0, Math.min(pointer.clientY - bounds.top, bounds.height));
        const left = Math.min(start.x, x),
          top = Math.min(start.y, y);
        Object.assign(selected.style, {
          left: `${left}px`,
          top: `${top}px`,
          width: `${Math.abs(x - start.x)}px`,
          height: `${Math.abs(y - start.y)}px`,
        });
        return [left, top, Math.max(x, start.x), Math.max(y, start.y)];
      };
      overlay.addEventListener('pointermove', move);
      overlay.addEventListener(
        'pointerup',
        (pointer) => {
          overlay.removeEventListener('pointermove', move);
          const [x0, y0, x1, y1] = move(pointer);
          if (x1 - x0 < 4 || y1 - y0 < 4) return selected.remove();
          const size = current.document.pages[current.page];
          current.selection = [
            (x0 * size.width) / bounds.width,
            (y0 * size.height) / bounds.height,
            (x1 * size.width) / bounds.width,
            (y1 * size.height) / bounds.height,
          ];
          $('#doc-pdf-apply').disabled = current.pdfTool === 'digital';
          status('Area selected. Apply the PDF change to a new copy.');
        },
        { once: true },
      );
    });
    function setSignTab(tab) {
      root
        .querySelectorAll('[data-sign-tab]')
        .forEach((button) => button.classList.toggle('active', button.dataset.signTab === tab));
      for (const id of ['draw', 'image', 'digital']) $('#doc-sign-' + id).hidden = id !== tab;
    }
    const canvas = $('#doc-sign-canvas');
    let drawing = false;
    canvas.addEventListener('pointerdown', (event) => {
      drawing = true;
      canvas.setPointerCapture(event.pointerId);
      const rect = canvas.getBoundingClientRect();
      const ctx = canvas.getContext('2d');
      ctx.strokeStyle = '#17212b';
      ctx.lineWidth = Math.max(2, event.pressure * 4);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(
        ((event.clientX - rect.left) * canvas.width) / rect.width,
        ((event.clientY - rect.top) * canvas.height) / rect.height,
      );
      event.preventDefault();
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!drawing) return;
      const rect = canvas.getBoundingClientRect();
      const ctx = canvas.getContext('2d');
      ctx.lineTo(
        ((event.clientX - rect.left) * canvas.width) / rect.width,
        ((event.clientY - rect.top) * canvas.height) / rect.height,
      );
      ctx.stroke();
      event.preventDefault();
    });
    canvas.addEventListener('pointerup', () => {
      drawing = false;
    });
    $('#doc-image-file').addEventListener('change', (event) =>
      go(async () => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        const data = await fileToImage(file);
        if (event.target.dataset.mode === 'pdf') {
          current.image = data;
          pdfMode('image');
          return;
        }
        $('#doc-rich-editor').focus();
        document.execCommand(
          'insertHTML',
          false,
          `<img src="${data}" alt="${safe(file.name)}" width="480">`,
        );
        markDirty();
      }),
    );
    $('#doc-ribbon-tools').addEventListener('change', (event) => {
      if (event.target.id === 'doc-line-numbers') {
        current.showLineNumbers = event.target.checked;
        $('#doc-rich-editor')?.classList.toggle('line-numbers', current.showLineNumbers);
        $('#doc-code-lines')?.classList.toggle('hidden', !current.showLineNumbers);
      }
      if (event.target.id === 'doc-style') {
        $('#doc-rich-editor').focus();
        document.execCommand('formatBlock', false, event.target.value);
        markDirty();
      }
      if (event.target.id === 'doc-font') {
        $('#doc-rich-editor').focus();
        document.execCommand('fontName', false, event.target.value);
        markDirty();
      }
      if (event.target.id === 'doc-font-size') {
        $('#doc-rich-editor').focus();
        document.execCommand('fontSize', false, event.target.value);
        markDirty();
      }
      if (event.target.id === 'doc-color') {
        $('#doc-rich-editor').focus();
        document.execCommand('foreColor', false, event.target.value);
        markDirty();
      }
      if (event.target.id === 'doc-image-wrap' && current.selectedImage) {
        current.selectedImage.className = event.target.value;
        markDirty();
      }
    });
    $('#doc-image-width').addEventListener('input', (event) => {
      if (!current.selectedImage) return;
      current.selectedImage.setAttribute('width', event.target.value);
      markDirty();
    });
    for (const type of ['paste', 'drop']) {
      root.addEventListener(type, (event) => {
        if (!event.target.closest('#doc-rich-editor')) return;
        event.preventDefault();
        const text = (type === 'paste' ? event.clipboardData : event.dataTransfer)?.getData(
          'text/plain',
        );
        if (text) {
          document.execCommand('insertText', false, text.slice(0, 1_000_000));
          markDirty();
        }
      });
    }
    root.addEventListener('input', (event) => {
      if (
        event.target.matches('#doc-code-editor, #doc-rich-editor') ||
        event.target.closest('#doc-rich-editor')
      ) {
        markDirty();
        if (event.target.id === 'doc-code-editor') refreshLines();
      }
    });
    root.addEventListener(
      'scroll',
      (event) => {
        if (event.target.id === 'doc-code-editor')
          $('#doc-code-lines').scrollTop = event.target.scrollTop;
      },
      true,
    );
    root.addEventListener('click', (event) => {
      const image = event.target.closest('#doc-rich-editor img');
      if (!image) return;
      current.selectedImage = image;
      $('#doc-image-settings').hidden = false;
      $('#doc-image-width').value = Number(image.getAttribute('width')) || 480;
      $('#doc-image-wrap').value = image.className || '';
    });
    function indentText(outdent) {
      const editor = $('#doc-code-editor');
      if (!editor) return;
      const start = editor.selectionStart,
        end = editor.selectionEnd;
      const first = editor.value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
      const chunk = editor.value.slice(first, end);
      const lines = chunk.split('\n');
      const mapped = lines
        .map((line) => (outdent ? line.replace(/^(\t| {1,4})/, '') : '\t' + line))
        .join('\n');
      editor.setRangeText(mapped, first, end, 'select');
      editor.selectionStart =
        start + (outdent ? -(lines[0].length - mapped.split('\n')[0].length) : 1);
      editor.selectionEnd = first + mapped.length;
      editor.focus();
      markDirty();
      refreshLines();
    }
    root.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        go(save);
        return;
      }
      if (event.key === 'Tab' && event.target.id === 'doc-code-editor') {
        event.preventDefault();
        indentText(event.shiftKey);
      }
      if (event.key === 'Tab' && event.target.closest('#doc-rich-editor')) {
        event.preventDefault();
        document.execCommand(event.shiftKey ? 'outdent' : 'indent', false);
        markDirty();
      }
    });
    void go(refreshTree);
    return { open, save };
  }
  return { mount, confirmLeave, stop };
})();
