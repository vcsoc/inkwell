'use strict';
window.InkwellHighlight = (root, query) => {
  const words = [
    ...new Set(
      (query || '')
        .slice(0, 200)
        .trim()
        .replace(/^tags?:/i, '')
        .replace(/^["']|["']$/g, '')
        .split(/\s+/)
        .filter((w) => w.length >= 2),
    ),
  ]
    .sort((a, b) => b.length - a.length)
    .slice(0, 20);
  if (!words.length) return;
  const regex = new RegExp(
    words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'giu',
  );
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node,
    hits = 0;
  while ((node = walker.nextNode()))
    if (!node.parentElement.closest('script,style,textarea,input,mark')) nodes.push(node);
  for (const node of nodes) {
    const text = node.textContent,
      fragment = document.createDocumentFragment();
    let offset = 0;
    for (const match of text.matchAll(regex)) {
      if (hits >= 2000) break;
      fragment.append(document.createTextNode(text.slice(offset, match.index)));
      const mark = document.createElement('mark');
      mark.dataset.searchHit = 'true';
      mark.textContent = match[0];
      fragment.append(mark);
      offset = match.index + match[0].length;
      hits++;
    }
    if (offset) {
      fragment.append(document.createTextNode(text.slice(offset)));
      node.replaceWith(fragment);
    }
  }
};
