'use strict';
window.InkwellDocuments = (() => {
  let session = null;
  const folderIcon = (opened = false) =>
    `<svg class="doc-item-icon" data-icon="folder-${opened ? 'open' : 'closed'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${opened ? '<path d="M3 9V5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v2"/><path d="M3 9h18a1 1 0 0 1 1 1.3l-2.5 9A2 2 0 0 1 17.6 21H5a2 2 0 0 1-1.9-1.5L1.9 11A1.5 1.5 0 0 1 3 9Z"/>' : '<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'}</svg>`;
  const fileIcon = (kind) => {
    const ext = String(kind || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 5);
    const category = ['doc', 'docx', 'odt', 'rtf'].includes(ext)
      ? 'word'
      : ['csv', 'tsv'].includes(ext)
        ? 'sheet'
        : ['md', 'mdx'].includes(ext)
          ? 'markdown'
          : ['html', 'htm', 'xml'].includes(ext)
            ? 'markup'
            : ['json', 'yaml', 'yml', 'toml', 'ini', 'py', 'js', 'css'].includes(ext)
              ? 'code'
              : ext === 'pdf'
                ? 'pdf'
                : 'text';
    return `<span class="doc-file-icon doc-file-${category}" data-file-type="${ext}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 2h9l5 5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1Z"/><path d="M14 2v5h5"/></svg><span>${ext.toUpperCase().slice(0, 3) || 'FILE'}</span></span>`;
  };
  const uiIcon = (name) => {
    const shapes = {
      sort: '<path d="M4 7h12M4 12h9M4 17h6M18 10v10m-3-3 3 3 3-3"/>',
      redact:
        '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M7 9h10v6H7z" fill="currentColor"/>',
      image:
        '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1"/><path d="m4 17 5-5 3 3 3-4 5 6"/>',
      text: '<path d="M4 5h16M12 5v14M8 19h8"/>',
      sign: '<path d="m4 17 12-12 3 3L7 20H4zM14 7l3 3M10 19h11"/>',
      apply: '<path d="m4 12 5 5L20 6"/>',
      compress: '<path d="M12 2v7m-3-3 3 3 3-3M12 22v-7m-3 3 3-3 3 3M4 12h16"/>',
      export: '<path d="M5 3h9l5 5v13H5zM14 3v5h5M8 13h8M8 17h6"/><path d="m13 19 3 2 3-2"/>',
      print: '<path d="M6 9V3h12v6M6 17H4V9h16v8h-2M6 14h12v7H6z"/>',
      save: '<path d="M4 3h14l3 3v15H3V3zM7 3v7h10V3M7 21v-8h10v8"/>',
      download: '<path d="M12 3v13m-4-4 4 4 4-4M4 19v2h16v-2"/>',
      minus: '<path d="M5 12h14"/>',
      plus: '<path d="M5 12h14M12 5v14"/>',
      zoom: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
      indent: '<path d="M3 7h8M3 12h8M3 17h8m1-11 6 6-6 6m-1-6h10"/>',
      outdent: '<path d="M13 7h8m-8 5h8m-8 5h8M9 6l-6 6 6 6M3 12h10"/>',
      wrap: '<path d="M3 6h18M3 10h18M3 14h13a3 3 0 0 1 0 6h-4m3-3-3 3 3 3M3 20h6"/>',
      preview:
        '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2"/>',
      bullets: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
      numbered: '<path d="M9 6h12M9 12h12M9 18h12M4 5h2v3M4 11h2v2H4v2h2M4 17h2l-2 3h2"/>',
      table:
        '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>',
      pages: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 8h8M8 12h8M8 16h5"/>',
      trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v6m4-6v6"/>',
      edit: '<path d="m4 16 11-11 4 4L8 20H4zM13 7l4 4M15 5l2-2 4 4-2 2"/>',
      link: '<path d="M9 15l6-6M8 9l-3 3a4 4 0 0 0 6 6l3-3M10 9l3-3a4 4 0 0 1 6 6l-3 3"/>',
    };
    return `<svg class="doc-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || shapes.zoom}</svg>`;
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
    if (session?.pdfDraft)
      return confirm('This PDF has a staged edit. Discard it without saving a new copy?');
    return !session?.dirty || confirm('This document has unsaved edits. Discard them?');
  }
  window.addEventListener('beforeunload', (event) => {
    if (!session?.dirty && !session?.pdfDraft) return;
    event.preventDefault();
    event.returnValue = '';
  });
  function stop() {
    for (const dialog of session?.dialogs || []) if (dialog.open) dialog.close();
    session?.dispose?.();
    document.querySelector('#doc-top-name')?.remove();
    const footer = document.querySelector('#documents-footer-status');
    if (footer) {
      footer.hidden = true;
      footer.textContent = '';
    }
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
      pdfText: '',
      pdfFontSize: 12,
      pdfDraft: false,
      directory: '',
      sort: 'name-asc',
      zoom: 100,
      selectedPaths: new Set(),
      selectionAnchor: null,
      copiedPaths: [],
      dragPath: null,
      dragDestination: null,
      showLineNumbers: false,
    };
    session = current;
    const topName = document.createElement('div');
    topName.id = 'doc-top-name';
    topName.hidden = true;
    topName.innerHTML = `<button type="button" id="doc-top-rename" title="Rename the open document"><span id="doc-top-filename"></span>${uiIcon('edit')}</button><input type="text" id="doc-top-rename-input" aria-label="Rename open document" maxlength="160" hidden>`;
    document.querySelector('#page-title')?.after(topName);
    const footer = document.querySelector('#documents-footer-status');
    if (footer) {
      footer.hidden = false;
      footer.textContent = 'Select a file from Documents or Recent.';
    }
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
      $('#doc-export-pdf').disabled = disabled || !current.document;
      $('#doc-print').disabled = disabled || !current.document;
    };
    const status = (message) => {
      $('#doc-status').textContent = message;
      if (footer) footer.textContent = message;
    };
    const markDirty = () => {
      current.dirty = true;
      status('Unsaved changes');
      controls(false);
    };

    nav.innerHTML = `<div class="doc-sidebar"><div class="doc-sidebar-sticky"><div class="doc-nav-heading"><strong>Documents</strong><button type="button" id="doc-refresh" title="Refresh files" aria-label="Refresh files">↻</button></div><div class="doc-nav-path" id="doc-nav-path" title="Documents" aria-label="Visible folder path">${folderIcon(true)}<span>Documents</span></div><div class="doc-find-row"><input id="doc-search" type="search" placeholder="Search Documents" aria-label="Search Documents" autocomplete="off"><button id="doc-sort" type="button" title="Order by" aria-label="Order by" aria-haspopup="true" aria-expanded="false">${uiIcon('sort')}</button><div id="doc-sort-menu" class="doc-sort-menu" hidden role="menu" aria-label="Order by"><button type="button" role="menuitemradio" aria-checked="true" data-doc-order="name-asc">Name · A to Z</button><button type="button" role="menuitemradio" aria-checked="false" data-doc-order="name-desc">Name · Z to A</button><button type="button" role="menuitemradio" aria-checked="false" data-doc-order="modified-desc">Modified · newest first</button><button type="button" role="menuitemradio" aria-checked="false" data-doc-order="modified-asc">Modified · oldest first</button></div></div><div class="doc-nav-actions"><button type="button" id="doc-new-folder" title="New folder">＋ Folder</button><button type="button" id="doc-new-file" title="New file">＋ File</button><label title="Import files into the selected folder">↥ Import<input id="doc-import" type="file" multiple hidden></label></div></div><div id="doc-search-results" hidden aria-label="Document search results"></div><details id="doc-recent-group" open><summary>Recent files</summary><div id="doc-recent"></div></details><div id="doc-tree" role="tree" aria-label="Documents folder tree"></div></div>`;
    nav.insertAdjacentHTML(
      'beforeend',
      '<div id="doc-context-menu" class="doc-context-menu" role="menu" aria-label="Document actions" hidden><button type="button" role="menuitem" data-doc-menu="rename">Rename…</button><button type="button" role="menuitem" data-doc-menu="trash">Move to OS Trash…</button><button type="button" role="menuitem" data-doc-menu="copy">Copy</button><button type="button" role="menuitem" data-doc-menu="paste">Paste</button></div>',
    );
    root.innerHTML = `<div class="doc-shell" id="documents-workspace"><aside class="doc-pages" id="doc-pages" aria-label="Document page thumbnails"><div class="doc-pages-heading">Pages <button type="button" id="doc-hide-pages" aria-label="Close page thumbnails" title="Close page thumbnails">×</button></div><div id="doc-thumbnails"><p class="doc-empty">Open a document to see its pages.</p></div></aside><section class="doc-main"><header class="doc-ribbon"><div class="doc-ribbon-title"><button class="secondary" type="button" id="doc-show-pages" title="Show page thumbnails" aria-label="Show page thumbnails">${uiIcon('pages')}</button><strong id="doc-file-name">Document editor</strong><span id="doc-status" role="status">Select a file from Documents or Recent.</span><button class="doc-icon-button primary" type="button" id="doc-save" disabled title="Save document (Ctrl+S)" aria-label="Save document">${uiIcon('save')}</button><button class="doc-icon-button" type="button" id="doc-export-pdf" disabled title="Export the current document to PDF" aria-label="Export to PDF">${uiIcon('export')}</button><button class="doc-icon-button" type="button" id="doc-print" disabled title="Choose printer and print settings" aria-label="Print document">${uiIcon('print')}</button><a class="doc-icon-button secondary hidden" id="doc-download" download title="Download a copy of this document" aria-label="Download document">${uiIcon('download')}</a><div class="doc-zoom-controls" aria-label="Document zoom"><button type="button" id="doc-zoom-out" title="Zoom out (Ctrl+-)" aria-label="Zoom out">${uiIcon('minus')}</button><output id="doc-zoom-label" title="Document zoom level">100%</output><button type="button" id="doc-zoom-in" title="Zoom in (Ctrl++)" aria-label="Zoom in">${uiIcon('plus')}</button></div></div><div class="doc-ribbon-tools" id="doc-ribbon-tools" hidden><div id="doc-rich-tools" class="doc-toolset" hidden><select id="doc-style" aria-label="Paragraph style" title="Paragraph style"><option value="p">Normal text</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="blockquote">Quote</option></select><select id="doc-font" aria-label="Font"><option value="Arial">Arial</option><option value="Georgia">Georgia</option><option value="Times New Roman">Times New Roman</option><option value="Courier New">Courier New</option></select><select id="doc-font-size" aria-label="Font size"><option value="2">Small</option><option value="3" selected>Normal</option><option value="4">Large</option><option value="5">Extra large</option></select><button data-doc-command="bold" title="Bold (Ctrl+B)" aria-label="Bold"><b>B</b></button><button data-doc-command="italic" title="Italic (Ctrl+I)" aria-label="Italic"><i>I</i></button><button data-doc-command="underline" title="Underline (Ctrl+U)" aria-label="Underline"><u>U</u></button><button data-doc-command="strikeThrough" title="Strikethrough" aria-label="Strikethrough"><s>S</s></button><label class="doc-color-control" title="Text color">Text <input id="doc-color" type="color" aria-label="Text color" value="#26372b"></label><button class="doc-icon-button" data-doc-command="insertUnorderedList" title="Bulleted list" aria-label="Bulleted list">${uiIcon('bullets')}</button><button class="doc-icon-button" data-doc-command="insertOrderedList" title="Numbered list" aria-label="Numbered list">${uiIcon('numbered')}</button><button data-doc-command="justifyLeft" title="Align left" aria-label="Align left">≡</button><button data-doc-command="justifyCenter" title="Center" aria-label="Center text">≡</button><button data-doc-command="justifyRight" title="Align right" aria-label="Align right">≡</button><button class="doc-icon-button" data-doc-command="indent" title="Indent paragraph (Tab)" aria-label="Indent paragraph">${uiIcon('indent')}</button><button class="doc-icon-button" data-doc-command="outdent" title="Outdent paragraph (Shift+Tab)" aria-label="Outdent paragraph">${uiIcon('outdent')}</button><button class="doc-icon-button" id="doc-table" title="Insert a table" aria-label="Insert a table">${uiIcon('table')}</button><button class="doc-icon-button" id="doc-link" title="Insert a link" aria-label="Insert a link">${uiIcon('link')}</button><button class="doc-icon-button" id="doc-insert-image" title="Insert an image" aria-label="Insert an image">${uiIcon('image')}</button><label id="doc-image-settings" hidden>Image width <input id="doc-image-width" type="range" min="80" max="900" value="480"><select id="doc-image-wrap" aria-label="Image placement"><option value="">Inline</option><option value="doc-float-left">Left · wrap text</option><option value="doc-float-right">Right · wrap text</option></select></label></div><div id="doc-text-tools" class="doc-toolset" hidden><button class="doc-icon-button" id="doc-indent" type="button" title="Indent selected lines" aria-label="Indent selected lines">${uiIcon('indent')}</button><button class="doc-icon-button" id="doc-outdent" type="button" title="Outdent selected lines" aria-label="Outdent selected lines">${uiIcon('outdent')}</button><button class="doc-icon-button" id="doc-wrap" type="button" aria-pressed="true" title="Toggle word wrap" aria-label="Toggle word wrap">${uiIcon('wrap')}</button><button class="doc-icon-button" id="doc-preview" type="button" hidden title="Preview Markdown" aria-label="Preview Markdown">${uiIcon('preview')}</button></div><div id="doc-pdf-tools" class="doc-toolset" hidden><button class="doc-icon-button" type="button" data-pdf-tool="redact" title="Redact area permanently in a new PDF copy" aria-label="Redact area">${uiIcon('redact')}</button><button class="doc-icon-button" type="button" id="doc-pdf-place-image" title="Choose an image, draw its area, move or resize the preview, then Apply" aria-label="Place image">${uiIcon('image')}</button><button class="doc-icon-button" type="button" data-pdf-tool="text" title="Place text in a selected PDF area" aria-label="Add text">${uiIcon('text')}</button><button class="doc-icon-button" type="button" data-pdf-tool="replace_text" title="Replace existing text in a selected PDF area in a new copy" aria-label="Replace text">T↻</button><button class="doc-icon-button" type="button" id="doc-signature" title="Draw or import a signature, choose its area, move or resize the preview, then Apply" aria-label="Signature">${uiIcon('sign')}</button><button class="doc-icon-button" type="button" id="doc-pdf-compress" title="Try reducing the PDF file size and keep the original" aria-label="Compress PDF">${uiIcon('compress')}</button></div><label class="doc-line-toggle" title="Toggle line numbers"><input id="doc-line-numbers" type="checkbox" aria-label="Line numbers"><span class="doc-switch-track" aria-hidden="true"></span><span class="sr-only">Line numbers</span></label></div></header><div class="doc-editor-viewport" id="doc-editor-viewport"><div class="doc-empty doc-welcome"><h2>Your documents, together.</h2><p>Open or import a PDF, Word document, Markdown, CSV or another text file from the folder tree.</p><p>Files stay in your Documents directory. PDF redactions and signatures create new copies; originals remain available.</p></div></div></section><dialog id="doc-sign-dialog" aria-labelledby="doc-sign-title"><h2 id="doc-sign-title">Sign PDF</h2><p>Choose an area on the PDF page first, or use the bottom-right of the page by default.</p><div class="doc-sign-tabs"><button type="button" data-sign-tab="draw">Draw</button><button type="button" data-sign-tab="image">Image</button><button type="button" data-sign-tab="digital">Digital certificate</button></div><section id="doc-sign-draw"><canvas id="doc-sign-canvas" width="520" height="160" aria-label="Draw your signature using a mouse, pen or touch"></canvas><button type="button" id="doc-sign-clear">Clear drawing</button><button type="button" id="doc-sign-use-drawing" class="primary">Place drawn signature</button></section><section id="doc-sign-image" hidden><label>Signature image (PNG, JPEG, WebP or GIF) <input id="doc-sign-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><button type="button" id="doc-sign-use-image" class="primary">Place image signature</button></section><section id="doc-sign-digital" hidden><p>Cryptographically sign a new PDF copy with your PKCS#12 certificate (.p12 or .pfx). Your certificate and password are sent only to your Inkwell backend for this request and are never stored.</p><label>PKCS#12 certificate <input id="doc-cert-file" type="file" accept=".p12,.pfx"></label><label>Certificate password <input id="doc-cert-pass" type="password" autocomplete="off"></label><button type="button" id="doc-cert-apply" class="primary">Digitally sign a new PDF copy</button></section><button type="button" id="doc-sign-close" class="secondary">Cancel</button></dialog><dialog id="doc-password-dialog" aria-labelledby="doc-password-title"><form id="doc-password-form"><h2 id="doc-password-title">Unlock document</h2><p id="doc-password-description">Enter the password to open this protected document.</p><label for="doc-password-input">Document password</label><input id="doc-password-input" type="password" autocomplete="off" required><p id="doc-password-error" role="alert" hidden></p><div class="doc-dialog-actions"><button type="button" id="doc-password-cancel" class="secondary">Cancel</button><button type="submit" id="doc-password-submit" class="primary">Unlock</button></div></form></dialog><dialog id="doc-print-dialog" aria-labelledby="doc-print-title"><form id="doc-print-form"><h2 id="doc-print-title">Print document</h2><div class="doc-print-layout"><div class="doc-print-fields"><label>Printer<select id="doc-print-printer" required></select></label><label>Pages<input id="doc-print-pages" type="text" inputmode="text" placeholder="All pages, or 1-3,5" title="Leave blank for all pages"></label><label>Copies<input id="doc-print-copies" type="number" min="1" max="99" value="1" required></label><label>Paper size<select id="doc-print-paper"><option>A4</option><option>Letter</option><option>Legal</option></select></label><label>Orientation<select id="doc-print-orientation"><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label><label>Color<select id="doc-print-color"><option value="color">Color</option><option value="monochrome">Black and white</option></select></label><label>Double-sided<select id="doc-print-duplex"><option value="none">Single-sided</option><option value="long">Flip on long edge</option><option value="short">Flip on short edge</option></select></label><label>Scaling<select id="doc-print-scaling"><option value="fit">Fit to page</option><option value="actual">Actual size</option></select></label><label>Margins<select id="doc-print-margins"><option value="default">Printer default</option><option value="narrow">Narrow</option><option value="none">None (if supported)</option></select></label></div><div class="doc-print-preview"><strong>First page preview</strong><img id="doc-print-preview-image" alt="First printable page preview"><p id="doc-print-message" role="status"></p></div></div><div class="doc-dialog-actions"><button type="button" id="doc-print-cancel" class="secondary">Cancel</button><button type="submit" id="doc-print-submit" class="primary">Print</button></div></form></dialog><input id="doc-image-file" type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif">`;
    root.insertAdjacentHTML(
      'beforeend',
      '<dialog id="doc-create-dialog" aria-labelledby="doc-create-title"><form id="doc-create-form"><h2 id="doc-create-title">New document</h2><label for="doc-create-name" id="doc-create-label">File name (include .docx, .pdf, .md, .csv, etc.)</label><input id="doc-create-name" name="name" type="text" autocomplete="off" required maxlength="160"><p id="doc-create-error" role="alert" hidden></p><div class="doc-dialog-actions"><button type="button" id="doc-create-cancel" class="secondary">Cancel</button><button type="submit" id="doc-create-submit" class="primary">Create document</button></div></form></dialog><dialog id="doc-rename-dialog" aria-labelledby="doc-rename-title"><form id="doc-rename-form"><h2 id="doc-rename-title">Rename item</h2><label for="doc-rename-name">New name</label><input id="doc-rename-name" type="text" autocomplete="off" required maxlength="160"><p id="doc-rename-error" role="alert" hidden></p><div class="doc-dialog-actions"><button type="button" id="doc-rename-cancel" class="secondary">Cancel</button><button type="submit" id="doc-rename-submit" class="primary">Rename</button></div></form></dialog><dialog id="doc-trash-dialog" aria-labelledby="doc-trash-title"><form id="doc-trash-form"><h2 id="doc-trash-title">Move to OS Trash</h2><p id="doc-trash-description"></p><p>Restore this item from your operating system’s Trash if needed. It will not be permanently deleted by Inkwell.</p><p id="doc-trash-error" role="alert" hidden></p><div class="doc-dialog-actions"><button type="button" id="doc-trash-cancel" class="secondary">Cancel</button><button type="submit" id="doc-trash-submit" class="danger">Move to Trash</button></div></form></dialog>',
    );
    current.dialog = $('#doc-sign-dialog');
    current.dialogs = [
      current.dialog,
      $('#doc-password-dialog'),
      $('#doc-print-dialog'),
      $('#doc-create-dialog'),
      $('#doc-rename-dialog'),
      $('#doc-trash-dialog'),
    ];
    function showCreate(kind) {
      const dialog = $('#doc-create-dialog');
      const form = $('#doc-create-form');
      const input = $('#doc-create-name');
      const error = $('#doc-create-error');
      const submit = $('#doc-create-submit');
      const folder = kind === 'folder';
      $('#doc-create-title').textContent = folder ? 'New folder' : 'New document';
      $('#doc-create-label').textContent = folder
        ? 'Folder name'
        : 'File name (include .docx, .pdf, .md, .csv, etc.)';
      submit.textContent = folder ? 'Create folder' : 'Create document';
      input.value = folder ? '' : 'Untitled.docx';
      error.hidden = true;
      submit.disabled = false;
      $('#doc-create-cancel').onclick = () => dialog.close();
      form.onsubmit = async (event) => {
        event.preventDefault();
        if (!live() || submit.disabled) return;
        if (!folder && current.dirty) {
          error.textContent = 'Save your current document before creating another one.';
          error.hidden = false;
          return;
        }
        submit.disabled = true;
        error.hidden = true;
        try {
          const result = await api(folder ? '/documents/folder' : '/documents/file', {
            method: 'POST',
            body: { path: current.directory, name: input.value.trim() },
          });
          if (!live()) return;
          await refreshTree();
          dialog.close();
          if (!folder) await open(result.path);
        } catch (cause) {
          if (!live()) return;
          error.textContent = cause.message;
          error.hidden = false;
          input.focus();
        } finally {
          submit.disabled = false;
        }
      };
      dialog.showModal();
      input.focus();
      input.select();
    }
    function remapPath(path, oldPath, newPath) {
      if (path === oldPath) return newPath;
      return path?.startsWith(oldPath + '/') ? newPath + path.slice(oldPath.length) : path;
    }
    async function renameItem(path, name) {
      const result = await api('/documents/rename', { method: 'POST', body: { path, name } });
      if (!live() || result.unchanged) return result;
      const oldPath = result.old_path;
      const newPath = result.path;
      current.directory = remapPath(current.directory, oldPath, newPath);
      current.selectionAnchor = remapPath(current.selectionAnchor, oldPath, newPath);
      current.selectedPaths = new Set(
        [...current.selectedPaths].map((item) => remapPath(item, oldPath, newPath)),
      );
      current.copiedPaths = current.copiedPaths.map((item) => remapPath(item, oldPath, newPath));
      if (current.document?.path === oldPath || current.document?.path.startsWith(oldPath + '/')) {
        current.document.path = remapPath(current.document.path, oldPath, newPath);
        current.document.name = current.document.path.split('/').at(-1);
        $('#doc-file-name').textContent = current.document.name;
        topName.querySelector('#doc-top-filename').textContent = current.document.name;
        topName.querySelector('#doc-top-rename').title = `Rename ${current.document.name}`;
        document.querySelector('#breadcrumb').textContent = `documents. ${current.document.name}`;
        $('#doc-download').href = '/api/documents/download?path=' + query(current.document.path);
        $('#doc-download').download = current.document.name;
        if (current.document.mode === 'pdf') {
          const image = $('#doc-pdf-image');
          if (image)
            image.src = url(current.document.path, current.page, Math.min(1800, current.zoom * 11));
          $('#doc-thumbnails')
            .querySelectorAll('[data-doc-page] img')
            .forEach((thumb, index) => (thumb.src = url(current.document.path, index)));
        }
      }
      await refreshTree(result);
      if (nav.querySelector('#doc-search').value.trim()) await searchTree();
      status(
        `Renamed to ${newPath.split('/').at(-1)}${current.dirty || current.pdfDraft ? ' · staged edits remain open' : ''}`,
      );
      return result;
    }
    const renameDialog = $('#doc-rename-dialog');
    $('#doc-rename-cancel').onclick = () => renameDialog.close();
    function showRename(path) {
      const input = $('#doc-rename-name');
      const name = path.split('/').at(-1);
      input.value = name;
      $('#doc-rename-title').textContent = `Rename ${name}`;
      $('#doc-rename-error').hidden = true;
      $('#doc-rename-submit').disabled = false;
      $('#doc-rename-form').onsubmit = async (event) => {
        event.preventDefault();
        const submit = $('#doc-rename-submit');
        if (!live() || submit.disabled) return;
        submit.disabled = true;
        try {
          await renameItem(path, input.value.trim());
          if (live()) renameDialog.close();
        } catch (error) {
          $('#doc-rename-error').textContent = error.message;
          $('#doc-rename-error').hidden = false;
          input.focus();
        } finally {
          submit.disabled = false;
        }
      };
      renameDialog.showModal();
      input.focus();
      input.setSelectionRange(
        0,
        path.includes('.') && !path.endsWith('/') && name.lastIndexOf('.') > 0
          ? name.lastIndexOf('.')
          : name.length,
      );
    }
    const topRename = topName.querySelector('#doc-top-rename');
    const topInput = topName.querySelector('#doc-top-rename-input');
    topRename.onclick = () => {
      if (!current.document) return;
      topInput.value = current.document.name;
      topRename.hidden = true;
      topInput.hidden = false;
      topInput.focus();
      const name = current.document.name;
      topInput.setSelectionRange(
        0,
        name.lastIndexOf('.') > 0 ? name.lastIndexOf('.') : name.length,
      );
    };
    const endTopRename = () => {
      topInput.hidden = true;
      topRename.hidden = false;
    };
    topInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        endTopRename();
        topRename.focus();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (topInput.disabled) return;
        topInput.disabled = true;
        go(async () => {
          try {
            await renameItem(current.document.path, topInput.value.trim());
            if (live()) endTopRename();
          } catch (error) {
            status(error.message);
            topInput.focus();
            throw error;
          } finally {
            topInput.disabled = false;
          }
        });
      }
    });
    const trashDialog = $('#doc-trash-dialog');
    $('#doc-trash-cancel').onclick = () => trashDialog.close();
    function showTrash(path) {
      const name = path.split('/').at(-1);
      const affected =
        current.document?.path === path || current.document?.path.startsWith(path + '/');
      $('#doc-trash-description').textContent =
        `Move “${name}”${affected && (current.dirty || current.pdfDraft) ? ' and discard its unsaved edits' : ''} to your operating system’s Trash? Folders include their contents.`;
      $('#doc-trash-error').hidden = true;
      $('#doc-trash-submit').disabled = false;
      $('#doc-trash-form').onsubmit = async (event) => {
        event.preventDefault();
        const submit = $('#doc-trash-submit');
        if (!live() || submit.disabled) return;
        submit.disabled = true;
        try {
          await api('/documents/trash', { method: 'POST', body: { path } });
          if (!live()) return;
          trashDialog.close();
          current.selectedPaths = new Set(
            [...current.selectedPaths].filter(
              (item) => item !== path && !item.startsWith(path + '/'),
            ),
          );
          current.copiedPaths = current.copiedPaths.filter(
            (item) => item !== path && !item.startsWith(path + '/'),
          );
          if (current.directory === path || current.directory.startsWith(path + '/'))
            current.directory = path.split('/').slice(0, -1).join('/');
          if (affected) {
            current.document = null;
            current.dirty = false;
            current.pdfDraft = false;
            current.pdfTool = '';
            current.selection = null;
            topName.hidden = true;
            endTopRename();
            document.querySelector('#breadcrumb').textContent = 'documents.';
            $('#doc-file-name').textContent = 'Document editor';
            $('#doc-ribbon-tools').hidden = true;
            $('#doc-download').classList.add('hidden');
            $('#doc-thumbnails').innerHTML =
              '<p class="doc-empty">Open a document to see its pages.</p>';
            $('#doc-editor-viewport').innerHTML =
              '<div class="doc-empty doc-welcome"><h2>Your documents, together.</h2><p>Choose a document in the sidebar to continue.</p></div>';
            controls(true);
          }
          await refreshTree();
          if (nav.querySelector('#doc-search').value.trim()) await searchTree();
          status(`Moved ${name} to your operating system’s Trash`);
        } catch (error) {
          $('#doc-trash-error').textContent = error.message;
          $('#doc-trash-error').hidden = false;
        } finally {
          submit.disabled = false;
        }
      };
      trashDialog.showModal();
    }
    function requestPassword(path) {
      current.passwordPath = path;
      $('#doc-password-description').textContent =
        `Enter the password for ${path.split('/').pop()}. The password stays in this app session only.`;
      $('#doc-password-error').hidden = true;
      $('#doc-password-input').value = '';
      if (!$('#doc-password-dialog').open) $('#doc-password-dialog').showModal();
      $('#doc-password-input').focus();
    }
    const sizePage = () => {
      const editor = $('#doc-editor-viewport');
      editor.style.setProperty(
        '--doc-page-width',
        `${Math.min(850, Math.max(280, editor.clientWidth - 48))}px`,
      );
    };
    const setZoom = (value) => {
      if (!current.document) return;
      sizePage();
      current.zoom = Math.max(60, Math.min(240, value));
      $('#doc-zoom-label').textContent = `${current.zoom}%`;
      $('#doc-editor-viewport').style.setProperty('--doc-zoom', current.zoom / 100);
      if (current.document?.mode === 'pdf' && $('#doc-pdf-image'))
        $('#doc-pdf-image').src = url(
          current.document.path,
          current.page,
          Math.min(1800, Math.round(current.zoom * 11)),
        );
    };
    current.adjustZoom = (step) => {
      if (live() && current.document && !current.dialogs.some((dialog) => dialog.open))
        setZoom(current.zoom + step);
    };
    const zoomKey = (event) => {
      if (
        !live() ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        current.dialogs.some((dialog) => dialog.open)
      )
        return;
      const direction = ['+', '='].includes(event.key)
        ? 10
        : ['-', '_'].includes(event.key)
          ? -10
          : event.key === '0'
            ? 0
            : null;
      if (direction === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setZoom(direction === 0 ? 100 : current.zoom + direction);
    };
    const zoomWheel = (event) => {
      if (
        !live() ||
        !current.document ||
        !(event.ctrlKey || event.metaKey) ||
        !root.contains(event.target)
      )
        return;
      event.preventDefault();
      setZoom(current.zoom + (event.deltaY < 0 ? 10 : -10));
    };
    document.addEventListener('keydown', zoomKey, true);
    root.addEventListener('wheel', zoomWheel, { passive: false });
    window.addEventListener('resize', sizePage);
    current.dispose = () => {
      document.removeEventListener('keydown', zoomKey, true);
      root.removeEventListener('wheel', zoomWheel);
      window.removeEventListener('resize', sizePage);
    };

    async function refreshRecent() {
      const entries = await api('/documents/recent');
      if (!live()) return;
      nav.querySelector('#doc-recent').innerHTML = entries.length
        ? entries
            .map(
              (entry) =>
                `<button type="button" data-doc-file="${safe(entry.path)}" title="${safe(entry.path)}">${fileIcon(entry.kind)}<span class="doc-item-label">${safe(entry.name)}</span></button>`,
            )
            .join('')
        : '<span class="doc-side-muted">No recently opened files</span>';
    }
    function sorted(entries) {
      return [...entries].sort((a, b) => {
        if (a.directory !== b.directory) return a.directory ? -1 : 1;
        const comparison = current.sort.startsWith('modified')
          ? (a.modified || 0) - (b.modified || 0)
          : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        return (
          (current.sort.endsWith('desc') ? -1 : 1) * comparison || a.name.localeCompare(b.name)
        );
      });
    }
    function renderEntry(child) {
      const kind = child.name.split('.').pop();
      const symbol = child.directory ? folderIcon(false) : fileIcon(kind);
      return `<div class="doc-tree-entry" role="treeitem" aria-label="${safe(child.name)}"><button type="button" draggable="true" class="doc-tree-row ${child.directory ? 'doc-folder-row' : ''}" ${child.directory ? `data-doc-folder="${safe(child.path)}" aria-expanded="false"` : `data-doc-file="${safe(child.path)}"`} title="${safe(child.path)}" data-modified="${child.modified || 0}">${symbol}<span class="doc-item-label">${safe(child.name)}</span></button>${child.directory ? `<div class="doc-tree-children" data-child-of="${safe(child.path)}" hidden role="group"></div>` : ''}</div>`;
    }
    async function list(path, target) {
      const result = await api('/documents/tree?path=' + query(path));
      if (!live() || !target.isConnected) return;
      target.innerHTML = result.children.length
        ? sorted(result.children).map(renderEntry).join('')
        : '<span class="doc-side-muted">Empty folder</span>';
      highlight();
      updatePath();
    }
    async function refreshTree(renamed = null) {
      const tree = nav.querySelector('#doc-tree');
      const scroll = nav.scrollTop;
      const expanded = [...tree.querySelectorAll('[data-doc-folder][aria-expanded="true"]')]
        .map((button) => button.dataset.docFolder)
        .filter(Boolean)
        .map((path) => (renamed ? remapPath(path, renamed.old_path, renamed.path) : path))
        .sort((a, b) => a.split('/').length - b.split('/').length);
      tree.innerHTML = `<button id="doc-root-folder" class="doc-tree-row doc-folder-row" type="button" aria-expanded="true" data-doc-folder="" title="Your Documents folder">${folderIcon(true)}<span class="doc-item-label">Documents</span></button><div id="doc-root-children" role="group"></div>`;
      await list('', nav.querySelector('#doc-root-children'));
      nav.querySelector('#doc-root-children').dataset.loaded = 'true';
      for (const path of expanded) {
        const button = [...tree.querySelectorAll('[data-doc-folder]')].find(
          (item) => item.dataset.docFolder === path,
        );
        if (button) await expandFolder(button, true);
      }
      await refreshRecent();
      nav.scrollTop = scroll;
      highlight();
      updatePath();
    }
    function highlight() {
      nav.querySelectorAll('[data-doc-file]').forEach((button) => {
        button.classList.toggle('active', button.dataset.docFile === current.document?.path);
        button.classList.toggle('doc-selected', current.selectedPaths.has(button.dataset.docFile));
      });
      nav.querySelectorAll('[data-doc-folder]').forEach((button) => {
        const active = button.dataset.docFolder === current.directory;
        button.classList.toggle('active-folder', active);
        button.classList.toggle(
          'doc-selected',
          current.selectedPaths.has(button.dataset.docFolder),
        );
        const icon = button.querySelector('.doc-item-icon');
        if (icon)
          icon.outerHTML = folderIcon(active || button.getAttribute('aria-expanded') === 'true');
      });
    }
    async function expandFolder(button, expanded = true) {
      const path = button.dataset.docFolder;
      button.setAttribute('aria-expanded', String(expanded));
      const container = path
        ? [...nav.querySelectorAll('[data-child-of]')].find((item) => item.dataset.childOf === path)
        : nav.querySelector('#doc-root-children');
      if (!container) return;
      container.hidden = !expanded;
      if (expanded && !container.dataset.loaded) {
        await list(path, container);
        container.dataset.loaded = 'true';
      }
      highlight();
      updatePath();
    }
    function updatePath() {
      const bar = nav.querySelector('#doc-nav-path');
      if (!bar) return;
      const threshold = nav.querySelector('.doc-sidebar-sticky').getBoundingClientRect().bottom + 3;
      const visible = [...nav.querySelectorAll('#doc-tree .doc-tree-row')].find((button) => {
        const rect = button.getBoundingClientRect();
        return rect.bottom > threshold && rect.top < nav.getBoundingClientRect().bottom;
      });
      const path =
        visible?.dataset.docFolder ||
        visible?.dataset.docFile?.split('/').slice(0, -1).join('/') ||
        current.directory;
      const parts = ['Documents', ...path.split('/').filter(Boolean)];
      const label = parts.join(' / ');
      bar.querySelector('span').textContent = (
        parts.length > 4 ? [parts[0], parts[1], '…', parts.at(-1)] : parts
      ).join(' / ');
      bar.title = label;
    }
    function pagePreview(page) {
      const doc = current.document;
      if (!doc) return;
      if (current.page !== page && current.pdfDraft && !confirmLeave()) return;
      if (current.page !== page) current.pdfDraft = false;
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
      $('#doc-pdf-overlay').classList.toggle('selecting', !!current.pdfTool);
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
      endTopRename();
      topName.hidden = false;
      topName.querySelector('#doc-top-filename').textContent = doc.name;
      topName.querySelector('#doc-top-rename').title = `Rename ${doc.name}`;
      const breadcrumb = document.querySelector('#breadcrumb');
      if (breadcrumb && live()) breadcrumb.textContent = `documents. ${doc.name}`;
      sizePage();
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
      let result;
      try {
        result = await api('/documents/open?path=' + query(path));
      } catch (error) {
        if (error.message === 'Document password required') {
          requestPassword(path);
          return;
        }
        throw error;
      }
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
    $('#doc-password-form').addEventListener('submit', (event) => {
      event.preventDefault();
      go(async () => {
        const input = $('#doc-password-input');
        const submit = $('#doc-password-submit');
        const path = current.passwordPath;
        submit.disabled = true;
        try {
          await api('/documents/unlock', {
            method: 'POST',
            body: { path, password: input.value },
          });
          $('#doc-password-dialog').close();
          input.value = '';
          await open(path);
        } catch (error) {
          $('#doc-password-error').hidden = false;
          $('#doc-password-error').textContent =
            error.message === 'Incorrect document password'
              ? 'The previous password was incorrect. Please try again.'
              : error.message;
          input.focus();
          input.select();
        } finally {
          submit.disabled = false;
        }
      });
    });
    $('#doc-password-cancel').addEventListener('click', () => $('#doc-password-dialog').close());
    $('#doc-password-dialog').addEventListener('close', () => {
      $('#doc-password-input').value = '';
      current.passwordPath = null;
    });
    async function exportPdf() {
      if (!current.document) return;
      if (current.dirty) await save();
      const result = await api('/documents/export-pdf', {
        method: 'POST',
        body: { path: current.document.path },
      });
      if (result.path === current.document.path) return status(result.message);
      await refreshTree();
      await open(result.path);
      status(`Exported to ${result.path}`);
    }
    async function showPrint() {
      if (!current.document) return;
      if (current.dirty) await save();
      const printers = await api('/documents/printers');
      const picker = $('#doc-print-printer');
      picker.innerHTML = printers.printers.length
        ? printers.printers
            .map((name) => `<option value="${safe(name)}">${safe(name)}</option>`)
            .join('')
        : '<option value="">No printer configured</option>';
      if (printers.default && printers.printers.includes(printers.default))
        picker.value = printers.default;
      $('#doc-print-submit').disabled = !printers.printers.length;
      $('#doc-print-message').textContent = printers.printers.length
        ? 'Review settings and the first page before submitting a print job.'
        : 'No system printers were found. Use Export to PDF instead.';
      $('#doc-print-preview-image').src =
        '/api/documents/print-preview?path=' + query(current.document.path);
      $('#doc-print-dialog').showModal();
    }
    $('#doc-print-cancel').addEventListener('click', () => $('#doc-print-dialog').close());
    $('#doc-print-preview-image').addEventListener('error', () => {
      $('#doc-print-message').textContent =
        'Print preview unavailable for this file. Check conversion support before printing.';
    });
    $('#doc-print-form').addEventListener('submit', (event) => {
      event.preventDefault();
      go(async () => {
        const submit = $('#doc-print-submit');
        submit.disabled = true;
        try {
          const result = await api('/documents/print', {
            method: 'POST',
            body: {
              path: current.document.path,
              printer: $('#doc-print-printer').value,
              copies: Number($('#doc-print-copies').value),
              pages: $('#doc-print-pages').value.trim(),
              paper: $('#doc-print-paper').value,
              orientation: $('#doc-print-orientation').value,
              color: $('#doc-print-color').value,
              duplex: $('#doc-print-duplex').value,
              scaling: $('#doc-print-scaling').value,
              margins: $('#doc-print-margins').value,
            },
          });
          $('#doc-print-dialog').close();
          toast(result.message);
        } catch (error) {
          $('#doc-print-message').textContent = error.message;
        } finally {
          submit.disabled = false;
        }
      });
    });
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
    function renderSelection() {
      const overlay = $('#doc-pdf-overlay');
      if (!overlay || !current.selection) return;
      const page = current.document.pages[current.page];
      const bounds = overlay.getBoundingClientRect();
      const [x0, y0, x1, y1] = current.selection;
      const selected = document.createElement('div');
      selected.className = 'doc-selection';
      Object.assign(selected.style, {
        left: `${(x0 * bounds.width) / page.width}px`,
        top: `${(y0 * bounds.height) / page.height}px`,
        width: `${((x1 - x0) * bounds.width) / page.width}px`,
        height: `${((y1 - y0) * bounds.height) / page.height}px`,
      });
      if (current.image && ['image', 'signature'].includes(current.pdfTool)) {
        selected.classList.add('doc-selection-preview');
        const image = document.createElement('img');
        image.src = current.image;
        image.alt = 'Image placement preview';
        const resize = document.createElement('span');
        resize.className = 'doc-selection-resize';
        resize.setAttribute('aria-label', 'Drag to resize image');
        resize.title = 'Drag to resize image';
        selected.append(image, resize);
      }
      const textMode = ['text', 'replace_text'].includes(current.pdfTool);
      if (textMode) {
        selected.classList.add('doc-selection-text');
        if (current.pdfTool === 'replace_text') selected.classList.add('doc-selection-replace');
        const editor = document.createElement('textarea');
        editor.className = 'doc-inline-text';
        editor.setAttribute('aria-label', 'Type text directly on the PDF');
        editor.setAttribute('placeholder', 'Type here…');
        editor.maxLength = 5000;
        editor.value = current.pdfText;
        editor.style.fontSize = `${Math.max(8, (current.pdfFontSize * bounds.width) / page.width)}px`;
        selected.append(editor);
        const resize = document.createElement('span');
        resize.className = 'doc-selection-resize';
        resize.title = 'Drag to resize text area';
        selected.append(resize);
      }
      const actions = document.createElement('div');
      actions.className = 'doc-stage-actions';
      if (textMode) {
        const handle = document.createElement('span');
        handle.className = 'doc-stage-move';
        handle.title = 'Drag to move this text area';
        handle.textContent = '⠿';
        actions.append(handle);
        const label = document.createElement('label');
        label.textContent = 'Size ';
        const size = document.createElement('input');
        size.type = 'number';
        size.min = '6';
        size.max = '32';
        size.value = String(current.pdfFontSize);
        size.className = 'doc-inline-font';
        size.setAttribute('aria-label', 'PDF text size in points');
        label.append(size);
        actions.append(label);
      }
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.id = 'doc-pdf-apply';
      apply.innerHTML = uiIcon('apply');
      apply.setAttribute('aria-label', 'Apply PDF change');
      apply.title = 'Apply this change to a new PDF copy';
      apply.disabled =
        (textMode && !current.pdfText.trim()) ||
        (['image', 'signature'].includes(current.pdfTool) && !current.image);
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'doc-stage-cancel';
      cancel.innerHTML = uiIcon('trash');
      cancel.setAttribute('aria-label', 'Discard staged PDF change');
      cancel.title = 'Discard this staged change without altering the PDF';
      actions.append(apply, cancel);
      selected.append(actions);
      overlay.querySelector('.doc-selection')?.remove();
      overlay.append(selected);
      if (textMode) selected.querySelector('.doc-inline-text').focus({ preventScroll: true });
    }
    async function loadSelectedPdfText(selection) {
      try {
        const result = await api('/documents/pdf-text', {
          method: 'POST',
          body: { path: current.document.path, page: current.page, rect: selection },
        });
        const editor = $('#doc-pdf-overlay .doc-inline-text');
        if (
          !live() ||
          current.pdfTool !== 'replace_text' ||
          current.selection !== selection ||
          !editor ||
          editor.value
        )
          return;
        current.pdfText = result.text;
        current.pdfDraft = !!result.text.trim();
        editor.value = result.text;
        $('#doc-pdf-apply').disabled = !current.pdfDraft;
        if (result.text) {
          editor.focus({ preventScroll: true });
          editor.select();
          status('Edit selected PDF text directly on the page · green check saves a new copy.');
        } else status('No selectable PDF text found in this area. Type replacement text directly.');
      } catch (error) {
        status(error.message);
      }
    }
    function pdfMode(mode) {
      const previous = current.pdfTool;
      if (current.pdfDraft && previous !== mode && !confirmLeave()) return;
      if (previous !== mode || !mode) current.pdfDraft = false;
      current.pdfTool = mode;
      if (!['image', 'signature'].includes(mode)) current.selection = null;
      if (mode !== previous || !mode) current.pdfText = '';
      root
        .querySelectorAll('[data-pdf-tool]')
        .forEach((button) => button.classList.toggle('active', button.dataset.pdfTool === mode));
      status(
        mode === 'image' || mode === 'signature'
          ? current.selection
            ? 'Drag the image to move it; drag its corner to resize. Apply saves a new PDF copy.'
            : 'Draw an area on the PDF page, then drag or resize the image before applying.'
          : mode === 'text' || mode === 'replace_text'
            ? 'Draw an area or click the PDF, then type directly on the page. Apply saves a new copy.'
            : mode
              ? `Draw an area on the PDF page${mode === 'redact' ? ' to permanently remove its contents from a new copy' : ''}`
              : 'Select a PDF tool',
      );
      $('#doc-pdf-overlay')?.classList.toggle('selecting', !!mode);
      $('#doc-pdf-overlay')?.querySelector('.doc-selection')?.remove();
      if (current.selection) renderSelection();
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
      current.pdfDraft = false;
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
      current.pdfDraft = true;
      current.selection = selection;
      if (selection)
        status(
          'Drag the signature to move it; drag its corner to resize. Apply saves a new PDF copy.',
        );
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

    const contextMenu = nav.querySelector('#doc-context-menu');
    const closeMenu = () => {
      contextMenu.hidden = true;
      nav
        .querySelectorAll('.doc-context-target')
        .forEach((row) => row.classList.remove('doc-context-target'));
    };
    const itemPath = (button) => button?.dataset.docFile ?? button?.dataset.docFolder;
    const selectItem = (button, event) => {
      const path = itemPath(button);
      if (path === undefined || path === '') return;
      const visible = [
        ...nav.querySelectorAll(
          '#doc-tree:not([hidden]) .doc-tree-row, #doc-search-results:not([hidden]) .doc-tree-row',
        ),
      ].filter((row) => itemPath(row) && row.getClientRects().length);
      if (event.shiftKey && current.selectionAnchor) {
        const start = visible.findIndex((row) => itemPath(row) === current.selectionAnchor);
        const end = visible.indexOf(button);
        if (start >= 0 && end >= 0) {
          if (!event.ctrlKey && !event.metaKey) current.selectedPaths.clear();
          for (const row of visible.slice(Math.min(start, end), Math.max(start, end) + 1))
            current.selectedPaths.add(itemPath(row));
        } else current.selectedPaths.add(path);
      } else if (event.ctrlKey || event.metaKey) {
        if (current.selectedPaths.has(path)) current.selectedPaths.delete(path);
        else current.selectedPaths.add(path);
        current.selectionAnchor = path;
      } else {
        current.selectedPaths = new Set([path]);
        current.selectionAnchor = path;
      }
      highlight();
    };
    nav.addEventListener('contextmenu', (event) => {
      if (!live()) return;
      const button = event.target.closest(
        '#doc-tree [data-doc-file], #doc-tree [data-doc-folder], #doc-search-results [data-doc-file], #doc-search-results [data-doc-folder], #doc-recent [data-doc-file]',
      );
      if (!button && !event.target.closest('#doc-tree, #doc-search-results')) return;
      event.preventDefault();
      const path = itemPath(button);
      closeMenu();
      if (path && !current.selectedPaths.has(path)) selectItem(button, {});
      if (path) button.classList.add('doc-context-target');
      contextMenu.dataset.target = path || '';
      contextMenu.dataset.destination = button?.hasAttribute('data-doc-folder')
        ? button.dataset.docFolder
        : button?.hasAttribute('data-doc-file')
          ? path.includes('/')
            ? path.slice(0, path.lastIndexOf('/'))
            : ''
          : current.directory;
      contextMenu.querySelector('[data-doc-menu="copy"]').disabled = !current.selectedPaths.size;
      contextMenu.querySelector('[data-doc-menu="paste"]').disabled = !current.copiedPaths.length;
      for (const action of ['rename', 'trash'])
        contextMenu.querySelector(`[data-doc-menu="${action}"]`).disabled =
          !path || current.selectedPaths.size !== 1 || !current.selectedPaths.has(path);
      contextMenu.hidden = false;
      contextMenu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - contextMenu.offsetWidth - 8))}px`;
      contextMenu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - contextMenu.offsetHeight - 8))}px`;
    });
    const dismissMenu = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !contextMenu.contains(event.target))
        closeMenu();
    };
    document.addEventListener('pointerdown', dismissMenu);
    document.addEventListener('keydown', dismissMenu);
    const disposeZoom = current.dispose;
    current.dispose = () => {
      disposeZoom();
      document.removeEventListener('pointerdown', dismissMenu);
      document.removeEventListener('keydown', dismissMenu);
    };
    nav.addEventListener('click', (event) =>
      go(async () => {
        const menuAction = event.target.closest('[data-doc-menu]');
        if (menuAction) {
          closeMenu();
          if (menuAction.dataset.docMenu === 'rename')
            return showRename(contextMenu.dataset.target);
          if (menuAction.dataset.docMenu === 'trash') return showTrash(contextMenu.dataset.target);
          if (menuAction.dataset.docMenu === 'copy') {
            current.copiedPaths = [...current.selectedPaths].filter(
              (path, _, paths) =>
                !paths.some((other) => other !== path && path.startsWith(other + '/')),
            );
            toast(`Copied ${current.copiedPaths.length} item(s)`);
          } else if (current.copiedPaths.length) {
            const destination = contextMenu.dataset.destination ?? current.directory;
            const result = await api('/documents/copy', {
              method: 'POST',
              body: { paths: current.copiedPaths, destination },
            });
            await refreshTree();
            toast(`Pasted ${result.paths.length} item(s) into ${destination || 'Documents'}`);
          }
          return;
        }
        closeMenu();
        if (event.target.closest('#doc-refresh')) return refreshTree();
        const sortButton = event.target.closest('#doc-sort');
        if (sortButton) {
          const menu = nav.querySelector('#doc-sort-menu');
          menu.hidden = !menu.hidden;
          sortButton.setAttribute('aria-expanded', String(!menu.hidden));
          return;
        }
        const order = event.target.closest('[data-doc-order]');
        if (order) {
          current.sort = order.dataset.docOrder;
          nav
            .querySelectorAll('[data-doc-order]')
            .forEach((option) => option.setAttribute('aria-checked', String(option === order)));
          nav.querySelector('#doc-sort-menu').hidden = true;
          nav.querySelector('#doc-sort').setAttribute('aria-expanded', 'false');
          if (nav.querySelector('#doc-search').value.trim()) return searchTree();
          return refreshTree();
        }
        if (!event.target.closest('#doc-sort-menu')) {
          nav.querySelector('#doc-sort-menu').hidden = true;
          nav.querySelector('#doc-sort').setAttribute('aria-expanded', 'false');
        }
        if (event.target.closest('#doc-new-folder')) return showCreate('folder');
        if (event.target.closest('#doc-new-file')) return showCreate('file');
        const button = event.target.closest('[data-doc-file], [data-doc-folder]');
        if (!button) return;
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          event.preventDefault();
          selectItem(button, event);
          return;
        }
        if (itemPath(button)) selectItem(button, event);
        if (button.hasAttribute('data-doc-file')) return open(button.dataset.docFile);
        const path = button.dataset.docFolder;
        if (button.closest('#doc-search-results')) {
          nav.querySelector('#doc-search').value = '';
          nav.querySelector('#doc-search-results').hidden = true;
          nav.querySelector('#doc-tree').hidden = false;
          nav.querySelector('#doc-recent-group').hidden = false;
          const parts = path.split('/');
          for (let index = 1; index <= parts.length; index++) {
            const parent = parts.slice(0, index).join('/');
            const row = [...nav.querySelectorAll('#doc-tree [data-doc-folder]')].find(
              (item) => item.dataset.docFolder === parent,
            );
            if (row) await expandFolder(row, true);
          }
        } else await expandFolder(button, button.getAttribute('aria-expanded') !== 'true');
        current.directory = path;
        highlight();
        updatePath();
      }),
    );
    let searchSequence = 0;
    let searchTimer;
    async function searchTree() {
      const term = nav.querySelector('#doc-search').value.trim();
      const results = nav.querySelector('#doc-search-results');
      const active = ++searchSequence;
      if (!term) {
        results.hidden = true;
        nav.querySelector('#doc-tree').hidden = false;
        nav.querySelector('#doc-recent-group').hidden = false;
        updatePath();
        return;
      }
      results.hidden = false;
      nav.querySelector('#doc-tree').hidden = true;
      nav.querySelector('#doc-recent-group').hidden = true;
      results.innerHTML = '<p class="doc-side-muted">Searching…</p>';
      const items = await api('/documents/search?q=' + query(term));
      if (!live() || active !== searchSequence) return;
      results.innerHTML = items.length
        ? sorted(items)
            .map(
              (item) =>
                `<button type="button" class="doc-tree-row ${item.directory ? 'doc-folder-row' : ''}" ${item.directory ? `data-doc-folder="${safe(item.path)}"` : `data-doc-file="${safe(item.path)}"`} title="${safe(item.path)}">${item.directory ? folderIcon(false) : fileIcon(item.name.split('.').pop())}<span class="doc-item-label">${safe(item.path)}</span></button>`,
            )
            .join('')
        : '<p class="doc-side-muted">No matching documents</p>';
      updatePath();
    }
    nav.querySelector('#doc-search').addEventListener('input', () => {
      searchSequence++;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => go(searchTree), 180);
    });
    let scrollTimer;
    let scrollFrame;
    nav.addEventListener('scroll', () => {
      nav.classList.add('doc-scrolling');
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => nav.classList.remove('doc-scrolling'), 850);
      cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(updatePath);
    });
    const placeholder = document.createElement('div');
    placeholder.className = 'doc-drop-placeholder';
    placeholder.setAttribute('role', 'status');
    const clearDrop = () => {
      placeholder.remove();
      current.dragDestination = null;
      nav
        .querySelectorAll('.doc-dragging')
        .forEach((item) => item.classList.remove('doc-dragging'));
    };
    nav.addEventListener('dragstart', (event) => {
      const button = event.target.closest('#doc-tree .doc-tree-row[draggable="true"]');
      if (!button) return;
      current.dragPath = button.dataset.docFile || button.dataset.docFolder;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-inkwell-document', current.dragPath);
      requestAnimationFrame(() => button.classList.add('doc-dragging'));
    });
    nav.addEventListener('dragover', (event) => {
      if (!current.dragPath) return;
      if (event.target.closest('.doc-drop-placeholder')) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        return;
      }
      const button = event.target.closest('#doc-tree [data-doc-folder], #doc-tree [data-doc-file]');
      if (!button) return;
      const targetPath = button.dataset.docFolder;
      const destination =
        targetPath === undefined
          ? button.dataset.docFile.split('/').slice(0, -1).join('/')
          : targetPath;
      if (current.dragPath === destination || destination.startsWith(current.dragPath + '/')) {
        event.dataTransfer.dropEffect = 'none';
        clearDrop();
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const key = `${destination}:${button.dataset.docFile || button.dataset.docFolder || 'root'}`;
      if (current.dragDestination === key) return;
      current.dragDestination = key;
      placeholder.dataset.destination = destination;
      placeholder.textContent = `Move to ${destination || 'Documents'}`;
      if (targetPath !== undefined) button.after(placeholder);
      else button.closest('.doc-tree-entry').before(placeholder);
    });
    nav.addEventListener('drop', (event) =>
      go(async () => {
        if (!current.dragPath || !placeholder.isConnected) return;
        event.preventDefault();
        const source = current.dragPath;
        const destination = placeholder.dataset.destination;
        clearDrop();
        current.dragPath = null;
        const result = await api('/documents/move', {
          method: 'POST',
          body: { path: source, destination },
        });
        if (result.unchanged) return;
        const translate = (value) =>
          value === source || value.startsWith(source + '/')
            ? result.path + value.slice(source.length)
            : value;
        current.directory = destination;
        if (current.document) {
          current.document.path = translate(current.document.path);
          $('#doc-download').href = '/api/documents/download?path=' + query(current.document.path);
        }
        await refreshTree();
        const parts = destination.split('/').filter(Boolean);
        for (let index = 1; index <= parts.length; index++) {
          const path = parts.slice(0, index).join('/');
          const row = [...nav.querySelectorAll('#doc-tree [data-doc-folder]')].find(
            (item) => item.dataset.docFolder === path,
          );
          if (row) await expandFolder(row, true);
        }
        const folder = [...nav.querySelectorAll('#doc-tree [data-doc-folder]')].find(
          (item) => item.dataset.docFolder === destination,
        );
        folder?.scrollIntoView({ block: 'nearest' });
        highlight();
        updatePath();
        toast(`Moved to ${destination || 'Documents'}`);
      }),
    );
    nav.addEventListener('dragend', () => {
      current.dragPath = null;
      clearDrop();
    });
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
        if (event.target.closest('#doc-export-pdf')) return exportPdf();
        if (event.target.closest('#doc-print')) return showPrint();
        if (event.target.closest('#doc-zoom-out')) return setZoom(current.zoom - 10);
        if (event.target.closest('#doc-zoom-in')) return setZoom(current.zoom + 10);
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
          if (event.target.closest('#doc-pdf-place-image') && current.pdfDraft) {
            if (!confirmLeave()) return;
            current.pdfDraft = false;
          }
          $('#doc-image-file').dataset.mode = event.target.closest('#doc-pdf-place-image')
            ? 'pdf'
            : 'rich';
          $('#doc-image-file').click();
          return;
        }
        if (event.target.closest('#doc-signature')) {
          if (current.pdfDraft) {
            if (!confirmLeave()) return;
            current.pdfDraft = false;
          }
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
        if (event.target.closest('.doc-stage-cancel')) {
          current.pdfDraft = false;
          pdfMode('');
          current.image = null;
          status('Staged PDF change discarded · original unchanged');
          return;
        }
        if (event.target.closest('#doc-pdf-apply')) {
          if (!current.selection) throw Error('Select an area on the PDF first');
          const textMode = ['text', 'replace_text'].includes(current.pdfTool);
          if (textMode && !current.pdfText.trim()) {
            $('#doc-pdf-overlay .doc-inline-text')?.focus();
            return;
          }
          try {
            return await operation(
              current.pdfTool,
              textMode
                ? { text: current.pdfText, font_size: current.pdfFontSize }
                : ['signature', 'image'].includes(current.pdfTool)
                  ? { image: current.image }
                  : {},
            );
          } catch (error) {
            status(error.message);
            throw error;
          }
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
      if (event.target.closest('.doc-inline-text, .doc-inline-font, .doc-stage-actions button'))
        return;
      event.preventDefault();
      overlay.setPointerCapture(event.pointerId);
      const bounds = overlay.getBoundingClientRect();
      const existing = event.target.closest('.doc-selection-preview, .doc-selection-text');
      const size = current.document.pages[current.page];
      if (existing && overlay.contains(existing)) {
        const initial = {
          left: parseFloat(existing.style.left),
          top: parseFloat(existing.style.top),
          width: parseFloat(existing.style.width),
          height: parseFloat(existing.style.height),
        };
        const resizing = !!event.target.closest('.doc-selection-resize');
        const move = (pointer) => {
          const dx = pointer.clientX - event.clientX;
          const dy = pointer.clientY - event.clientY;
          const left = resizing
            ? initial.left
            : Math.max(0, Math.min(bounds.width - initial.width, initial.left + dx));
          const top = resizing
            ? initial.top
            : Math.max(0, Math.min(bounds.height - initial.height, initial.top + dy));
          Object.assign(existing.style, {
            left: `${left}px`,
            top: `${top}px`,
            width: `${resizing ? Math.max(8, Math.min(bounds.width - left, initial.width + dx)) : initial.width}px`,
            height: `${resizing ? Math.max(8, Math.min(bounds.height - top, initial.height + dy)) : initial.height}px`,
          });
        };
        overlay.addEventListener('pointermove', move);
        overlay.addEventListener(
          'pointerup',
          (pointer) => {
            overlay.removeEventListener('pointermove', move);
            move(pointer);
            const x0 = parseFloat(existing.style.left),
              y0 = parseFloat(existing.style.top),
              x1 = x0 + parseFloat(existing.style.width),
              y1 = y0 + parseFloat(existing.style.height);
            current.selection = [
              (x0 * size.width) / bounds.width,
              (y0 * size.height) / bounds.height,
              (x1 * size.width) / bounds.width,
              (y1 * size.height) / bounds.height,
            ];
            status('Placement updated. Apply saves a new PDF copy; the original is unchanged.');
          },
          { once: true },
        );
        return;
      }
      const start = {
        x: Math.max(0, Math.min(event.clientX - bounds.left, bounds.width)),
        y: Math.max(0, Math.min(event.clientY - bounds.top, bounds.height)),
      };
      const selected = document.createElement('div');
      selected.className = 'doc-selection';
      current.selection = null;
      current.pdfText = '';
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
          let [x0, y0, x1, y1] = move(pointer);
          const textMode = current.pdfTool === 'text' || current.pdfTool === 'replace_text';
          if (x1 - x0 < 4 || y1 - y0 < 4) {
            if (!textMode) return selected.remove();
            x1 = Math.min(bounds.width, x0 + 220);
            y1 = Math.min(bounds.height, y0 + 80);
          }
          current.selection = [
            (x0 * size.width) / bounds.width,
            (y0 * size.height) / bounds.height,
            (x1 * size.width) / bounds.width,
            (y1 * size.height) / bounds.height,
          ];
          renderSelection();
          if (current.pdfTool === 'replace_text') void loadSelectedPdfText(current.selection);
          status(
            textMode
              ? 'Type directly on the PDF. Use the green check by the text to save a new copy.'
              : ['image', 'signature'].includes(current.pdfTool)
                ? 'Drag the image to move it; drag its corner to resize. Apply saves a new copy.'
                : 'Area selected. Apply the PDF change to a new copy.',
          );
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
          current.pdfDraft = true;
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
      if (event.target.matches('.doc-inline-text')) {
        current.pdfText = event.target.value;
        current.pdfDraft = !!current.pdfText.trim();
        $('#doc-pdf-apply').disabled = !current.pdfDraft;
        status('Editing text on the PDF · use the green check beside it to save a new copy.');
        return;
      }
      if (event.target.matches('.doc-inline-font')) {
        const size = Number(event.target.value);
        if (size >= 6 && size <= 32) {
          current.pdfFontSize = size;
          const page = current.document.pages[current.page];
          const width = $('#doc-pdf-overlay').getBoundingClientRect().width;
          $('#doc-pdf-overlay .doc-inline-text').style.fontSize =
            `${Math.max(8, (size * width) / page.width)}px`;
        }
        return;
      }
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
    root.addEventListener('keydown', (event) => {
      if (!event.target.matches('.doc-inline-text')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        current.pdfDraft = false;
        pdfMode('');
        status('Staged PDF text discarded · original unchanged');
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        $('#doc-pdf-apply')?.click();
      }
    });
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
  return {
    mount,
    confirmLeave,
    stop,
    openName: () => session?.document?.name || '',
    zoom: (step) => session?.adjustZoom?.(step),
  };
})();
