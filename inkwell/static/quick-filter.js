'use strict';
window.InkwellMailFilters = (() => {
  let dispose = () => {};
  const svg = (path) =>
    `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  const button = (id, label, path, extra = '') =>
    `<button type="button" class="quick-icon" id="${id}" title="${label}" aria-label="${label}" ${extra}>${svg(path)}</button>`;
  return {
    payload(state, preferences) {
      return {
        unread_only: state.filter === 'unread',
        starred_only: !!state.quick?.starred,
        tag_state: state.quick?.tag_state || 'all',
        ...(state.quick?.tag_id ? { tag_id: state.quick.tag_id } : {}),
        sort_by: preferences.group_messages_by_date ? 'date' : preferences.mail_sort || 'date',
        sort_order: preferences.mail_order || 'desc',
        ...(state.dateFrom ? { date_from: state.dateFrom } : {}),
        ...(state.dateTo ? { date_to: state.dateTo } : {}),
        ...(state.dateFrom || state.dateTo
          ? { date_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }
          : {}),
      };
    },
    mount({ state, preferences, esc, saveWorkspace, refresh, refreshGroups }) {
      dispose();
      const toolbar = document.querySelector('.mail-toolbar');
      const enabled = preferences.quick_filter_visible !== false;
      toolbar.insertAdjacentHTML(
        'beforeend',
        `<div class="quick-toolbar-actions" aria-label="Mail filters and display options">${button('quick-filter-toggle', 'Filter and display options', '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>', 'aria-expanded="false" aria-controls="quick-filter"')}
        <div class="quick-action-buttons" ${enabled ? '' : 'hidden'}>${button('quick-starred', 'Starred messages', '<path d="m12 3 2.8 6 6.7.8-4.9 4.7 1.2 6.5-5.8-3.1L6.2 21l1.2-6.5-4.9-4.7L9.2 9z"/>', `aria-pressed="${!!state.quick?.starred}"`)}${button('quick-tags-button', 'Filter by tag', '<path d="M3 4h9l9 9-8 8-10-10z"/><circle cx="8" cy="8" r="1"/>', 'aria-expanded="false" aria-controls="quick-filter"')}${button('quick-sort-button', 'Sort and order messages', '<path d="M4 6h13M4 12h10M4 18h7M19 12v8m-3-3 3 3 3-3"/>', 'aria-expanded="false" aria-controls="quick-filter"')}${button('quick-view-button', 'Card or table view', '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18M9 10v10"/>', 'aria-expanded="false" aria-controls="quick-filter"')}${button('group-by-date', 'Group messages by date', '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 14h3M8 18h3"/>', `aria-pressed="${!!preferences.group_messages_by_date}"`)}${button('quick-pin', 'Keep filters when switching folders', '<path d="M9 3h6l-1 6 4 4v2H6v-2l4-4zM12 15v7"/>', `aria-pressed="${!!preferences.quick_filter_pinned}"`)}${button('clear-quick-filter', 'Clear filters', '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>')}</div><span class="sr-only" id="quick-active-note"></span></div>
        <div id="quick-filter" class="quick-filter" role="group" aria-label="Filter and display options" hidden><section data-quick-pane="tags"><label>Tags<select id="quick-tag-state"><option value="all">Any</option><option value="tagged">Tagged</option><option value="untagged">Untagged</option></select></label><label>Tag<select id="quick-tag"><option value="">Any tag</option>${(state.tagCatalog || []).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label></section><section data-quick-pane="sort"><label>Sort by<select id="quick-sort">${Object.entries(
          {
            date: 'Date',
            sender: 'From',
            recipient: 'Recipient',
            subject: 'Subject',
            unread: 'Unread',
            starred: 'Starred',
            tags: 'Tags',
            imported: 'Import order',
          },
        )
          .map(([value, label]) => `<option value="${value}">${label}</option>`)
          .join(
            '',
          )}</select></label><label>Order<select id="quick-order"><option value="desc">Descending</option><option value="asc">Ascending</option></select></label></section><section data-quick-pane="view"><label>View<select id="quick-view"><option value="cards">Cards</option><option value="table">Table</option></select></label></section></div>`,
      );
      const actions = toolbar.querySelector('.quick-action-buttons');
      const root = toolbar.querySelector('#quick-filter');
      const trigger = toolbar.querySelector('#quick-filter-toggle');
      const menus = [
        'quick-filter-toggle',
        'quick-tags-button',
        'quick-sort-button',
        'quick-view-button',
      ];
      const close = () => {
        root.hidden = true;
        toolbar
          .querySelectorAll('[aria-controls="quick-filter"]')
          .forEach((element) => element.setAttribute('aria-expanded', 'false'));
      };
      const open = (id, pane) => {
        if (id !== 'quick-filter-toggle' && root.dataset.pane === pane && !root.hidden) {
          close();
          return;
        }
        root.dataset.pane = pane;
        root.querySelectorAll('[data-quick-pane]').forEach((section) => {
          section.hidden = pane !== 'all' && section.dataset.quickPane !== pane;
        });
        root.hidden = false;
        toolbar
          .querySelectorAll('[aria-controls="quick-filter"]')
          .forEach((element) => element.setAttribute('aria-expanded', String(element.id === id)));
      };
      root.querySelector('#quick-tag-state').value = state.quick?.tag_state || 'all';
      root.querySelector('#quick-tag').value = state.quick?.tag_id || '';
      root.querySelector('#quick-sort').value = preferences.group_messages_by_date
        ? 'date'
        : preferences.mail_sort || 'date';
      root.querySelector('#quick-sort').disabled = !!preferences.group_messages_by_date;
      root.querySelector('#quick-order').value = preferences.mail_order || 'desc';
      root.querySelector('#quick-view').value = preferences.mail_view || 'cards';
      const active = [
        state.filter === 'unread' ? 'Unread' : '',
        state.quick?.starred ? 'Starred' : '',
        state.quick?.tag_state && state.quick.tag_state !== 'all' ? state.quick.tag_state : '',
        state.quick?.tag_id
          ? state.tagCatalog.find((t) => t.id === state.quick.tag_id)?.name || 'Tag'
          : '',
      ]
        .filter(Boolean)
        .join(' · ');
      toolbar.querySelector('#quick-active-note').textContent = active;
      trigger.title = active
        ? `Filter and display options · ${active}`
        : 'Filter and display options';
      for (const [id, pane] of [
        ['quick-filter-toggle', 'all'],
        ['quick-tags-button', 'tags'],
        ['quick-sort-button', 'sort'],
        ['quick-view-button', 'view'],
      ])
        toolbar.querySelector('#' + id).onclick = () => {
          if (id === 'quick-filter-toggle' && !root.hidden && root.dataset.pane === 'all') {
            close();
            return;
          }
          if (actions.hidden) {
            actions.hidden = false;
            saveWorkspace({ quick_filter_visible: true });
          }
          open(id, pane);
        };
      toolbar.querySelector('#quick-starred').onclick = () => {
        state.quick = { ...state.quick, starred: !state.quick?.starred };
        void refresh();
      };
      root.querySelector('#quick-tag-state').onchange = (event) => {
        state.quick = { ...state.quick, tag_state: event.target.value };
        if (event.target.value === 'untagged') delete state.quick.tag_id;
        void refresh();
      };
      root.querySelector('#quick-tag').onchange = (event) => {
        state.quick = { ...state.quick, tag_id: Number(event.target.value) || null };
        if (state.quick.tag_id) state.quick.tag_state = 'tagged';
        void refresh();
      };
      for (const [id, key] of [
        ['quick-sort', 'mail_sort'],
        ['quick-order', 'mail_order'],
        ['quick-view', 'mail_view'],
      ])
        root.querySelector('#' + id).onchange = (event) => {
          saveWorkspace({ [key]: event.target.value });
          void refresh();
        };
      toolbar.querySelector('#group-by-date').onclick = () => {
        const grouped = !preferences.group_messages_by_date;
        saveWorkspace({ group_messages_by_date: grouped });
        root.querySelector('#quick-sort').disabled = grouped;
        root.querySelector('#quick-sort').value = grouped
          ? 'date'
          : preferences.mail_sort || 'date';
        void refreshGroups();
      };
      toolbar.querySelector('#quick-pin').onclick = (event) => {
        const pinned = !preferences.quick_filter_pinned;
        saveWorkspace({ quick_filter_pinned: pinned });
        event.currentTarget.setAttribute('aria-pressed', String(pinned));
      };
      toolbar.querySelector('#clear-quick-filter').onclick = () => {
        state.quick = {};
        state.filter = 'all';
        void refresh();
      };
      const outside = (event) => {
        if (!toolbar.contains(event.target)) close();
      };
      const escape = (event) => {
        if (event.key === 'Escape' && !root.hidden) {
          close();
          trigger.focus();
        }
      };
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', escape, true);
      dispose = () => {
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('keydown', escape, true);
      };
    },
  };
})();
