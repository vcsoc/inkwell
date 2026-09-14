'use strict';
window.InkwellMessageSelection = ({ state, api, esc, toast, refresh }) => {
  const ids = new Set(),
    mime = 'application/x-inkwell-messages';
  let visible = [],
    anchor = null,
    scope = '',
    busy = false;
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
    const moving = [...ids];
    try {
      await api('/messages/' + (restore ? 'restore' : 'move'), {
        method: 'POST',
        body: restore ? { ids: moving } : { ids: moving, folder },
      });
      ids.clear();
      await refresh();
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
  const select = (id, event) => {
    if (busy) return;
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
    tools.innerHTML = `<label class="select-all-label"><input type="checkbox" id="select-all-messages" aria-label="Select all visible messages"><span id="selection-count"></span></label><span class="selection-bulk" hidden><select id="selection-destination" aria-label="Move selected messages to"><option value="inbox">Inbox</option><option value="archive">Archive</option><option value="trash">Trash</option>${(state.localFolders || []).map((f) => `<option value="local-${f.id}">${esc(f.name)}</option>`).join('')}${state.remoteFolders.map((f) => `<option value="remote:${f.id}">${esc(state.accounts.find((a) => a.id === f.account_id)?.email || 'Account')} / ${esc(f.path)}</option>`).join('')}</select><button class="secondary" id="move-selected">Move</button><button class="secondary" id="restore-selected" hidden>Restore</button><button class="secondary" id="clear-selection">Clear</button></span>`;
    tools.querySelector('#select-all-messages').onchange = (e) => {
      if (e.target.checked) visible.forEach((id) => ids.add(id));
      else ids.clear();
      paint();
    };
    tools.querySelector('#move-selected').onclick = () =>
      run(tools.querySelector('#selection-destination').value);
    tools.querySelector('#restore-selected').onclick = () => run(null, true);
    tools.querySelector('#clear-selection').onclick = () => {
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
      row.ondragstart = (event) => {
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
    rowClick: (row, event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        select(Number(row.dataset.message), event);
        return true;
      }
      return false;
    },
  };
};
