'use strict';
window.InkwellFolderDrag = (navigation, { folders, onMove, onError }) => {
  const mime = 'application/x-inkwell-folder';
  let source = null,
    plan = null,
    hover = null,
    hoverTimer = null;
  let lastPointer = null;
  const marker = document.createElement('div');
  marker.id = 'folder-drop-placeholder';
  marker.className = 'hidden';
  marker.setAttribute('aria-hidden', 'true');
  document.body.append(marker);
  const key = (b) =>
    b?.dataset.remoteFolder ? 'remote:' + b.dataset.remoteFolder : b?.dataset.view;
  const local = (k) => folders().find((f) => 'local-' + f.id === k);
  const effective = (parent) => {
    if (
      !parent ||
      ['inbox', 'archive', 'sent', 'drafts', 'trash'].includes(parent) ||
      local(parent)
    )
      return parent || '';
    if (
      /^remote:[1-9][0-9]*$/.test(parent) &&
      navigation.querySelector(`[data-remote-folder="${parent.slice(7)}"]`)
    )
      return parent;
    return '';
  };
  const parentOf = (k) => effective(local(k)?.parent || '');
  const valid = (target, placement) => {
    if (!source || target === 'local-' + source) return false;
    if (placement !== 'inside' && !local(target)) return false;
    const parent = placement === 'inside' ? target : parentOf(target);
    let cursor = parent,
      depth = 0;
    const seen = new Set();
    while (local(cursor)) {
      const f = local(cursor);
      if (f.id === source || seen.has(f.id)) return false;
      seen.add(f.id);
      depth++;
      cursor = f.parent;
    }
    const height = (id, visited = new Set()) => {
      if (visited.has(id)) return 100;
      const next = new Set(visited);
      next.add(id);
      return (
        1 +
        Math.max(
          0,
          ...folders()
            .filter((f) => f.parent === 'local-' + id)
            .map((f) => height(f.id, next)),
        )
      );
    };
    if (depth + height(source) > 32) return false;
    const name = folders().find((f) => f.id === source)?.name;
    const fold = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
    if (!name) return false;
    if (
      parentOf('local-' + source) !== parent &&
      folders().some(
        (f) => f.id !== source && effective(f.parent) === parent && fold(f.name) === fold(name),
      )
    )
      return false;
    return true;
  };
  const clear = () => {
    marker.classList.add('hidden');
    navigation
      .querySelectorAll('.folder-drop-inside')
      .forEach((n) => n.classList.remove('folder-drop-inside'));
    plan = null;
  };
  const stopHover = () => {
    clearTimeout(hoverTimer);
    hoverTimer = null;
    hover = null;
  };
  const finish = () => {
    clear();
    source = null;
    lastPointer = null;
    stopHover();
    navigation.classList.remove('folder-dragging');
  };
  const preview = (e) => {
    if (!source || !e.dataTransfer?.types.includes(mime)) return;
    lastPointer = { clientX: e.clientX, clientY: e.clientY, dataTransfer: e.dataTransfer };
    clear();
    const button = e.target.closest('[data-view],[data-remote-folder],#folder-root-drop');
    if (!button || !navigation.contains(button) || button.classList.contains('pinned-link')) {
      stopHover();
      return;
    }
    const target = button.id === 'folder-root-drop' ? '' : key(button);
    if (
      !/^(|inbox|archive|sent|drafts|trash|local-[1-9][0-9]*|remote:[1-9][0-9]*)$/.test(
        target || '',
      )
    ) {
      stopHover();
      return;
    }
    const rect = button.getBoundingClientRect(),
      ratio = (e.clientY - rect.top) / rect.height;
    const placement = local(target)
      ? ratio < 0.25
        ? 'before'
        : ratio > 0.75
          ? 'after'
          : 'inside'
      : 'inside';
    if (!valid(target, placement)) {
      stopHover();
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    plan = { id: source, target, placement };
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    let box = rect;
    if (placement === 'after' && button.parentElement?.tagName === 'SUMMARY')
      box = button.parentElement.parentElement.getBoundingClientRect();
    marker.dataset.placement = placement;
    marker.textContent =
      placement === 'inside'
        ? 'Move inside' + (target ? '' : ' · Top level')
        : 'Place ' + placement;
    marker.style.left = rect.left / zoom + 'px';
    marker.style.top =
      (placement === 'inside' ? rect.top : placement === 'before' ? rect.top : box.bottom) / zoom +
      'px';
    marker.style.width = rect.width / zoom + 'px';
    marker.classList.remove('hidden');
    if (placement === 'inside') button.classList.add('folder-drop-inside');
    const details =
      button.parentElement?.tagName === 'SUMMARY' ? button.parentElement.parentElement : null;
    if (details !== hover) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
      hover = details;
    }
    if (placement === 'inside' && details && !details.open && !hoverTimer)
      hoverTimer = setTimeout(() => {
        details.open = true;
        hoverTimer = null;
      }, 600);
    if (placement !== 'inside') {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  };
  navigation.addEventListener('dragstart', (e) => {
    const button = e.target.closest('[data-view]'),
      folder = local(key(button));
    if (!folder || button.classList.contains('pinned-link')) return;
    source = folder.id;
    e.dataTransfer.clearData();
    e.dataTransfer.setData(mime, String(source));
    e.dataTransfer.effectAllowed = 'move';
    navigation.classList.add('folder-dragging');
  });
  navigation.addEventListener('dragover', preview);
  navigation.addEventListener('drop', (e) => {
    if (!source || !e.dataTransfer?.types.includes(mime)) return;
    preview(e);
    const chosen = plan;
    if (chosen && e.dataTransfer.getData(mime) === String(source)) {
      e.preventDefault();
      e.stopPropagation();
      finish();
      Promise.resolve(onMove(chosen)).catch((error) => onError(error.message));
    } else finish();
  });
  navigation.addEventListener('dragleave', (e) => {
    if (!navigation.contains(e.relatedTarget)) {
      clear();
      clearTimeout(hoverTimer);
      hoverTimer = null;
      hover = null;
    }
  });
  document.addEventListener('dragend', finish);
  document.addEventListener('drop', finish);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') finish();
  });
  window.addEventListener('blur', finish);
  window.addEventListener('hashchange', finish);
  window.addEventListener('resize', finish);
  document.addEventListener(
    'scroll',
    () => {
      if (source && lastPointer) {
        const target = document.elementFromPoint(lastPointer.clientX, lastPointer.clientY);
        if (target) preview({ ...lastPointer, target, preventDefault() {} });
        else clear();
      }
    },
    true,
  );
  return {
    bind() {
      navigation.querySelectorAll('[data-view]:not(.pinned-link)').forEach((b) => {
        if (local(key(b))) {
          b.draggable = true;
          b.title =
            (b.getAttribute('aria-label') || 'Folder') +
            ' · Drag to move; right-click for Move folder';
        }
      });
    },
  };
};
