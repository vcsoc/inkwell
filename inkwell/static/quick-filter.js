'use strict';
window.InkwellMailFilters = {
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
    const toolbar = document.querySelector('.mail-toolbar');
    toolbar.insertAdjacentHTML(
      'beforeend',
      `<button class="secondary" id="quick-filter-toggle" aria-expanded="${preferences.quick_filter_visible !== false}" aria-controls="quick-filter">Quick filter</button><span class="quick-active-note" id="quick-active-note"></span><div id="quick-filter" class="quick-filter" ${preferences.quick_filter_visible === false ? 'hidden' : ''}><button class="secondary" id="quick-starred" aria-pressed="${!!state.quick?.starred}">Starred</button><label>Tags<select id="quick-tag-state"><option value="all">Any</option><option value="tagged">Tagged</option><option value="untagged">Untagged</option></select></label><label>Tag<select id="quick-tag"><option value="">Any tag</option>${(state.tagCatalog || []).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label><label>Sort by<select id="quick-sort">${Object.entries(
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
        )}</select></label><label>Order<select id="quick-order"><option value="desc">Descending</option><option value="asc">Ascending</option></select></label><label>View<select id="quick-view"><option value="cards">Cards</option><option value="table">Table</option></select></label><label class="quick-pin" title="Group by message date in your local timezone; weeks start Monday. Uses date sorting while enabled."><input type="checkbox" role="switch" id="group-by-date"> Group by date</label><label class="quick-pin" title="Keep current filters when switching folders in this session"><input type="checkbox" id="quick-pin"> Pin</label><button class="secondary" id="clear-quick-filter">Clear filters</button></div>`,
    );
    const root = toolbar.querySelector('#quick-filter');
    root.querySelector('#quick-tag-state').value = state.quick?.tag_state || 'all';
    root.querySelector('#quick-tag').value = state.quick?.tag_id || '';
    root.querySelector('#quick-sort').value = preferences.group_messages_by_date
      ? 'date'
      : preferences.mail_sort || 'date';
    root.querySelector('#quick-sort').disabled = !!preferences.group_messages_by_date;
    root.querySelector('#group-by-date').checked = !!preferences.group_messages_by_date;
    root.querySelector('#group-by-date').onchange = (event) => {
      saveWorkspace({ group_messages_by_date: event.target.checked });
      root.querySelector('#quick-sort').disabled = event.target.checked;
      root.querySelector('#quick-sort').value = event.target.checked
        ? 'date'
        : preferences.mail_sort || 'date';
      void refreshGroups();
    };
    root.querySelector('#quick-order').value = preferences.mail_order || 'desc';
    root.querySelector('#quick-view').value = preferences.mail_view || 'cards';
    root.querySelector('#quick-pin').checked = !!preferences.quick_filter_pinned;
    toolbar.querySelector('#quick-active-note').textContent = [
      state.filter === 'unread' ? 'Unread' : '',
      state.quick?.starred ? 'Starred' : '',
      state.quick?.tag_state && state.quick.tag_state !== 'all' ? state.quick.tag_state : '',
      state.quick?.tag_id
        ? state.tagCatalog.find((t) => t.id === state.quick.tag_id)?.name || 'Tag'
        : '',
    ]
      .filter(Boolean)
      .join(' · ');
    toolbar.querySelector('#quick-filter-toggle').onclick = () => {
      root.hidden = !root.hidden;
      toolbar
        .querySelector('#quick-filter-toggle')
        .setAttribute('aria-expanded', String(!root.hidden));
      saveWorkspace({ quick_filter_visible: !root.hidden });
    };
    root.querySelector('#quick-starred').onclick = () => {
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
    root.querySelector('#quick-pin').onchange = (event) =>
      saveWorkspace({ quick_filter_pinned: event.target.checked });
    root.querySelector('#clear-quick-filter').onclick = () => {
      state.quick = {};
      state.filter = 'all';
      void refresh();
    };
  },
};
