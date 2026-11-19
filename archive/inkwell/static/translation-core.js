'use strict';
// Shared by the main UI and the trusted, nonce-only opaque mail-frame bridge.
window.InkwellTranslationCore = (() => {
  const states = new WeakMap();
  const uuid = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
  const clean = (root) => {
    const clone = root.cloneNode(true);
    clone.querySelectorAll('.translation-pill').forEach((pill) => pill.remove());
    clone
      .querySelectorAll('[data-translation-segment], .translation-text')
      .forEach((span) => span.replaceWith(...span.childNodes));
    return clone;
  };
  const plain = (root) => {
    const block = (node) =>
      ['DIV', 'P', 'LI', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE'].includes(
        node.nodeName,
      );
    const read = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeName === 'BR') return '\n';
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE)
        return '';
      if (block(node) && node.childNodes.length === 1 && node.firstChild.nodeName === 'BR')
        return '';
      let value = '',
        previousBlock = false,
        first = true;
      for (const child of node.childNodes) {
        const currentBlock = block(child);
        if (!first && (currentBlock || previousBlock)) value += '\n';
        value += read(child);
        previousBlock = currentBlock;
        first = false;
      }
      return value;
    };
    return read(clean(root));
  };
  const capture = (root) => {
    const selection = root.ownerDocument.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0).cloneRange();
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
    if (
      root.querySelectorAll('[data-translation-segment]').length &&
      [...root.querySelectorAll('[data-translation-segment]')].some((span) =>
        range.intersectsNode(span),
      )
    )
      return null;
    const text = plain(range.cloneContents());
    if (!text.trim()) return null;
    return { root, range, text, signature: root.innerHTML };
  };
  const valid = (snapshot) =>
    snapshot.root.isConnected &&
    snapshot.root.innerHTML === snapshot.signature &&
    snapshot.root.contains(snapshot.range.startContainer) &&
    snapshot.root.contains(snapshot.range.endContainer) &&
    plain(snapshot.range.cloneContents()) === snapshot.text;
  const insert = (snapshot, translated, language, changed = () => {}, notify = () => {}) => {
    if (!valid(snapshot)) return false;
    const { root, range } = snapshot;
    const document = root.ownerDocument;
    const decorate = (fragment) => {
      if (!root.isContentEditable) return fragment;
      let node = range.commonAncestorContainer;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
      while (node && node !== root) {
        if (['B', 'STRONG', 'I', 'EM', 'U', 'S', 'FONT', 'SPAN', 'A'].includes(node.nodeName)) {
          const inline = node.cloneNode(false);
          inline.append(fragment);
          const outer = document.createDocumentFragment();
          outer.append(inline);
          fragment = outer;
        }
        node = node.parentElement;
      }
      return fragment;
    };
    const common = range.commonAncestorContainer;
    const originalWhiteSpace = getComputedStyle(
      common.nodeType === Node.TEXT_NODE ? common.parentElement : common,
    ).whiteSpace;
    const original = decorate(range.cloneContents());
    const translationFragment = document.createDocumentFragment();
    translationFragment.append(document.createTextNode(translated));
    const translatedFragment = decorate(translationFragment);
    const wrapper = document.createElement('span');
    wrapper.dataset.translationSegment = uuid();
    const text = document.createElement('span');
    text.className = 'translation-text';
    text.style.whiteSpace = 'pre-wrap';
    text.append(translatedFragment.cloneNode(true));
    text.lang = language;
    text.dir = 'auto';
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'translation-pill';
    pill.contentEditable = 'false';
    pill.textContent = 'original';
    pill.setAttribute('aria-label', 'Show original text');
    pill.title = 'Show original text (translation stays on this device)';
    wrapper.append(text, pill);
    // Browser edit transaction makes an editable replacement undoable.
    if (root.isContentEditable) {
      root.focus();
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      if (!document.execCommand('insertHTML', false, wrapper.outerHTML)) return false;
    } else {
      range.deleteContents();
      range.insertNode(wrapper);
    }
    const inserted = root.querySelector(
      `[data-translation-segment="${wrapper.dataset.translationSegment}"]`,
    );
    if (!inserted) return false;
    const state = {
      original,
      originalWhiteSpace,
      translated,
      translatedFragment,
      language,
      showingOriginal: false,
      expected: translated,
      changed,
      notify,
    };
    if (!states.has(root)) {
      states.set(root, new Map());
      root.addEventListener('click', (event) => {
        const inserted = event.target.closest('[data-translation-segment]');
        const state = inserted && states.get(root)?.get(inserted.dataset.translationSegment);
        if (!state || !event.target.closest('.translation-pill')) return;
        event.preventDefault();
        event.stopPropagation();
        const current = inserted.querySelector('.translation-text');
        if (plain(current) !== state.expected) {
          state.notify(
            'This translated passage was edited. Its original toggle will not overwrite your edits.',
          );
          return;
        }
        state.showingOriginal = !state.showingOriginal;
        if (state.showingOriginal) {
          current.replaceChildren(state.original.cloneNode(true));
          current.removeAttribute('lang');
          current.style.whiteSpace = state.originalWhiteSpace;
        } else {
          current.replaceChildren(state.translatedFragment.cloneNode(true));
          current.lang = state.language;
          current.style.whiteSpace = 'pre-wrap';
        }
        state.expected = plain(current);
        const button = inserted.querySelector('.translation-pill');
        button.textContent = state.showingOriginal ? 'translated' : 'original';
        button.setAttribute(
          'aria-label',
          state.showingOriginal ? 'Show translated text' : 'Show original text',
        );
        button.title = button.getAttribute('aria-label');
        state.changed();
      });
    }
    states.get(root).set(inserted.dataset.translationSegment, state);
    changed();
    return true;
  };
  const html = (root) => {
    const clone = root.cloneNode(true);
    clone.querySelectorAll('.translation-text').forEach((span) => {
      if (span.style.whiteSpace === 'normal') return;
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode())
        if (walker.currentNode.textContent.includes('\n')) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const fragment = document.createDocumentFragment();
        node.textContent.split('\n').forEach((line, index) => {
          if (index) fragment.append(document.createElement('br'));
          fragment.append(document.createTextNode(line));
        });
        node.replaceWith(fragment);
      }
    });
    return clean(clone).innerHTML;
  };
  return { capture, valid, insert, plain, html, uuid };
})();
