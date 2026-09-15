'use strict';
window.InkwellMessageSelection = ({ state, api, esc, toast, refresh }) => {
  const ids = new Set(),
    mime = 'application/x-inkwell-messages';
  let visible = [],
    anchor = null,
    scope = '',
    busy = false,
    selectionStarted = false;
  const paint = () => {
    document.querySelectorAll('[data-message]').forEach((row) => {
      const checked = ids.has(Number(row.dataset.message));
      row.classList.toggle('batch-selected', checked);
      const box = row.querySelector('.select-message');
      if (box) box.checked = checked;
    });
    const tools = document.querySelector('#selection-tools');
    if (!tools) return;
    tools.querySelector('#selection-count').textContent = ids.size
      ? `${ids.size} selected`
      : 'Select messages';
    tools.querySelector('.selection-bulk').hidden = !ids.size;
    const all = tools.querySelector('#select-all-messages');
    all.checked = !!visible.length && ids.size === visible.length;
    all.indeterminate = !!ids.size && ids.size < visible.length;
    all.disabled = !visible.length;
    tools.querySelector('#restore-selected').hidden = ![...ids].every(
      (id) => state.messages.find((m) => m.id === id)?.folder === 'trash',
    );
    const deleting = tools.querySelector('#delete-selected');
    deleting.textContent =
      ids.size &&
      [...ids].every((id) => state.messages.find((m) => m.id === id)?.folder === 'trash')
        ? 'Delete permanently'
        : 'Trash';
    deleting.disabled = busy;
    const select = tools.querySelector('#selection-destination');
    const drafts = [...ids].some(
      (id) => state.messages.find((m) => m.id === id)?.folder === 'drafts',
    );
    [...select.options].forEach((o) => {
      o.disabled = drafts && o.value !== 'trash';
    });
    if (select.selectedOptions[0]?.disabled) select.value = 'trash';
  };
  const run = async (folder, restore = false) => {
    if (busy || !ids.size) return;
    busy = true;
    const moving = [...ids],
      generation = state.generation;
    try {
      await api('/messages/' + (restore ? 'restore' : 'move'), {
        method: 'POST',
        body: restore ? { ids: moving } : { ids: moving, folder },
      });
      if (generation === state.generation) ids.clear();
      await refresh({ generation, affected: moving });
      toast(
        `${moving.length} message${moving.length === 1 ? '' : 's'} ${restore ? 'restored' : 'moved'} locally. Server mail was not changed.`,
      );
    } catch (error) {
      toast(error.message);
    } finally {
      busy = false;
      paint();
    }
  };
  const deleteSelected = async () => {
    if (busy) return;
    const chosen = ids.size ? [...ids] : state.selected ? [state.selected.id] : [];
    if (!chosen.length) return;
    const records = chosen.map(
      (id) =>
        state.messages.find((m) => m.id === id) ||
        (state.selected?.id === id ? state.selected : null),
    );
    if (records.some((m) => !m)) return;
    const permanent = records.every((m) => m.folder === 'trash'),
      generation = state.generation;
    busy = true;
    paint();
    try {
      await api('/messages/trash-selection', { method: 'POST', body: { ids: chosen, permanent } });
      if (generation === state.generation) ids.clear();
      await refresh({ generation, affected: chosen });
      toast(
        `${chosen.length} local message${chosen.length === 1 ? '' : 's'} ${permanent ? 'permanently deleted' : 'moved to Trash'}. Server mail was not changed.`,
      );
    } catch (error) {
      toast(error.message);
    } finally {
      busy = false;
      paint();
    }
  };
  const select = (id, event) => {
    if (busy) return;
    selectionStarted = true;
    if (event.shiftKey && anchor !== null && visible.includes(anchor)) {
      const a = visible.indexOf(anchor),
        b = visible.indexOf(id);
      visible.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((v) => ids.add(v));
    } else {
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      anchor = id;
    }
    paint();
  };
  const bindRows = (messages) => {
    const next = JSON.stringify([
      state.view,
      state.remoteFolder?.id,
      state.collection?.key,
      state.query,
      state.offset,
      state.filter,
    ]);
    if (next !== scope) {
      ids.clear();
      anchor = null;
      selectionStarted = false;
      scope = next;
    }
    visible = messages.map((m) => m.id);
    [...ids].forEach((id) => {
      if (!visible.includes(id)) ids.delete(id);
    });
    let tools = document.querySelector('#selection-tools');
    if (!tools) {
      tools = document.createElement('div');
      tools.id = 'selection-tools';
      tools.className = 'selection-tools';
      document.querySelector('.mail-toolbar').after(tools);
    }
    const readerDock = tools.querySelector('.reader-tools-dock');
    const controls = document.createElement('div');
    controls.innerHTML = `<label class="select-all-label"><input type="checkbox" id="select-all-messages" aria-label="Select all visible messages"><span id="selection-count"></span></label><span class="selection-bulk" hidden><select id="selection-destination" aria-label="Move selected messages to"><option value="inbox">Inbox</option><option value="archive">Archive</option><option value="trash">Trash</option>${(state.localFolders || []).map((f) => `<option value="local-${f.id}">${esc(f.path || f.name)}</option>`).join('')}${state.remoteFolders.map((f) => `<option value="remote:${f.id}">${esc(state.accounts.find((a) => a.id === f.account_id)?.email || 'Account')} / ${esc(f.path)}</option>`).join('')}</select><button class="secondary" id="move-selected">Move</button><button class="secondary" id="restore-selected" hidden>Restore</button><button class="secondary danger" id="delete-selected">Trash</button><button class="secondary" id="clear-selection">Clear</button><select id="selection-tag" aria-label="Tag for selected messages"><option value="">Choose tag…</option>${(state.tagCatalog || []).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select><button class="secondary" id="add-selected-tag">Add tag</button><button class="secondary" id="remove-selected-tag">Remove tag</button></span>`;
    for (const child of [...tools.children]) if (child !== readerDock) child.remove();
    tools.prepend(...controls.childNodes);
    tools.querySelector('#select-all-messages').onchange = (e) => {
      if (busy) {
        paint();
        return;
      }
      selectionStarted = true;
      if (e.target.checked) visible.forEach((id) => ids.add(id));
      else ids.clear();
      paint();
    };
    for (const [button, add] of [
      ['add-selected-tag', true],
      ['remove-selected-tag', false],
    ])
      tools.querySelector('#' + button).onclick = async () => {
        const tag_id = Number(tools.querySelector('#selection-tag').value);
        if (!tag_id) {
          toast('Choose a tag first. Create tags in Tag Manager.');
          return;
        }
        if (busy) return;
        busy = true;
        const generation = state.generation,
          tagged = [...ids];
        try {
          await api('/tags/assign', { method: 'POST', body: { ids: tagged, tag_id, add } });
          await refresh({ generation, affected: tagged });
          toast(add ? 'Tag added locally.' : 'Tag removed locally.');
        } catch (error) {
          toast(error.message);
        } finally {
          busy = false;
          paint();
        }
      };
    tools.querySelector('#move-selected').onclick = () =>
      run(tools.querySelector('#selection-destination').value);
    tools.querySelector('#restore-selected').onclick = () => run(null, true);
    tools.querySelector('#delete-selected').onclick = deleteSelected;
    tools.querySelector('#clear-selection').onclick = () => {
      if (busy) return;
      selectionStarted = true;
      ids.clear();
      paint();
    };
    document.querySelectorAll('[data-message]').forEach((row) => {
      const id = Number(row.dataset.message),
        message = messages.find((m) => m.id === id);
      row.draggable = true;
      row.insertAdjacentHTML(
        'afterbegin',
        `<input class="select-message" type="checkbox" aria-label="Select ${esc(message.subject || '(No subject)')}">`,
      );
      const box = row.querySelector('.select-message');
      box.onclick = (event) => {
        event.stopPropagation();
        select(id, event);
      };
      const exportDrag = InkwellBindEmailExport(
        row,
        id,
        () => (ids.has(id) ? [...ids] : [id]),
        toast,
      );
      row.ondragstart = (event) => {
        if (event.altKey && exportDrag) return exportDrag(event);
        if (busy) {
          event.preventDefault();
          return;
        }
        if (!ids.has(id)) {
          ids.clear();
          ids.add(id);
          paint();
        }
        event.dataTransfer.setData(mime, JSON.stringify([...ids]));
        event.dataTransfer.effectAllowed = 'move';
      };
      row.ondragend = () =>
        document
          .querySelectorAll('.folder-drop-target')
          .forEach((n) => n.classList.remove('folder-drop-target'));
    });
    paint();
  };
  const bindFolders = () =>
    document.querySelectorAll('[data-view], [data-remote-folder]').forEach((node) => {
      const view = node.dataset.remoteFolder
        ? 'remote/' + node.dataset.remoteFolder
        : node.dataset.view;
      if (!/^(inbox|archive|trash|local-[1-9][0-9]*|remote\/[1-9][0-9]*)$/.test(view)) return;
      const valid = (e) => e.dataTransfer?.types.includes(mime);
      node.ondragover = (event) => {
        if (!valid(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        node.classList.add('folder-drop-target');
      };
      node.ondragleave = () => node.classList.remove('folder-drop-target');
      node.ondrop = (event) => {
        node.classList.remove('folder-drop-target');
        if (!valid(event)) return;
        event.preventDefault();
        event.stopPropagation();
        try {
          const list = JSON.parse(event.dataTransfer.getData(mime));
          if (
            !Array.isArray(list) ||
            !list.length ||
            list.length > 500 ||
            !list.every((id) => Number.isSafeInteger(id) && visible.includes(id))
          )
            return;
          ids.clear();
          list.forEach((id) => ids.add(id));
          void run(view.replace('remote/', 'remote:'));
        } catch (error) {
          toast(error.message);
        }
      };
    });
  return {
    bindRows,
    bindFolders,
    deleteSelected,
    rowClick: (row, event) => {
      const id = Number(row.dataset.message);
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        if (busy) return true;
        if (!selectionStarted && !ids.size) {
          const first = anchor ?? state.selected?.id;
          if (visible.includes(first)) {
            anchor = first;
            if ((event.ctrlKey || event.metaKey) && id !== anchor) ids.add(anchor);
          }
        }
        select(id, event);
        return true;
      }
      if (!ids.size) {
        anchor = id;
        selectionStarted = false;
      }
      return false;
    },
  };
};
