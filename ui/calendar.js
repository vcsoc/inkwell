'use strict';
window.InkwellCalendar = (() => {
  const invoke = (name, args) => window.__TAURI__.core.invoke(name, args);
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
  const dayLabel = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' });
  const timeLabel = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const pad = (value) => String(value).padStart(2, '0');
  const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const shift = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  const parse = (value, allDay = false) => new Date(allDay || /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value.slice(0, 10)}T00:00:00` : value);
  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text != null) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function button(label, handler, style) {
    const el = node('button', label, style); el.type = 'button'; el.onclick = handler; return el;
  }
  function mount(root) {
    let selected = new Date(), ticket = 0;
    let month = new Date(selected.getFullYear(), selected.getMonth(), 1), records = [];
    const bar = node('div', null, 'theme-actions');
    const title = node('h2');
    const grid = node('div', null, 'calendar-grid');
    const agenda = node('section', null, 'calendar-agenda');
    const status = node('p'); status.setAttribute('role', 'status');
    bar.append(button('Previous month', () => move(-1)), button('Today', () => move(0)), button('Next month', () => move(1)), button('New event', () => edit(), 'primary'));
    root.append(bar, title, status, grid, agenda);
    function move(delta) {
      selected = delta ? new Date(month.getFullYear(), month.getMonth() + delta, 1) : new Date();
      month = new Date(selected.getFullYear(), selected.getMonth(), 1);
      void load();
    }
    function forDay(date) {
      const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const endOfDay = shift(startOfDay, 1);
      return records.filter((event) => parse(event.start, event.all_day) < endOfDay && parse(event.end, event.all_day) > startOfDay);
    }
    function draw() {
      title.textContent = monthLabel.format(month);
      grid.replaceChildren(...['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => node('span', day, 'calendar-weekday')));
      const first = shift(month, -month.getDay());
      for (let i = 0; i < 42; i++) {
        const day = shift(first, i), count = forDay(day).length;
        const el = button(String(day.getDate()), () => { selected = day; draw(); }, 'calendar-day');
        if (count) el.append(node('small', `${count} event${count === 1 ? '' : 's'}`));
        el.setAttribute('aria-label', `${dayLabel.format(day)}${count ? `, ${count} events` : ''}`);
        el.setAttribute('aria-pressed', String(dateKey(day) === dateKey(selected)));
        if (day.getMonth() !== month.getMonth()) el.classList.add('outside');
        grid.append(el);
      }
      agenda.replaceChildren(node('h2', dayLabel.format(selected)));
      const entries = forDay(selected);
      if (!entries.length) agenda.append(node('p', 'No events on this day.'));
      for (const event of entries) {
        const row = node('article', null, 'record');
        const start = parse(event.start);
        row.append(node('h3', event.title), node('p', [event.all_day ? 'All day' : timeLabel.format(start), event.location].filter(Boolean).join(' | ')));
        if (event.notes) row.append(node('p', event.notes, 'contact-notes'));
        row.append(event.editable ? button('Edit event', () => edit(event)) : node('p', 'Open in the legacy app to edit.'));
        agenda.append(row);
      }
    }
    async function load() {
      const id = ++ticket;
      const first = shift(month, -month.getDay());
      status.textContent = 'Loading calendar...';
      try {
        const data = await invoke('events', { start: dateKey(shift(first, -1)), end: dateKey(shift(first, 43)) });
        if (id !== ticket || !grid.isConnected) return;
        records = data; status.textContent = ''; draw();
      } catch (error) { if (id === ticket) status.textContent = String(error); }
    }
    function edit(event) {
      const dialog = document.getElementById('event-dialog');
      const form = document.getElementById('event-form');
      const feedback = document.getElementById('event-status');
      const input = form.elements;
      const allDay = input.all_day;
      let working = false;
      const localTime = (date) => `${dateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
      function assignDates(start, end) {
        input.start.type = input.end.type = allDay.checked ? 'date' : 'datetime-local';
        input.start.value = allDay.checked ? dateKey(start) : localTime(start);
        input.end.value = allDay.checked ? dateKey(end) : localTime(end);
      }
      document.getElementById('event-title').textContent = event ? 'Edit event' : 'New event';
      input.title.value = event?.title || ''; input.location.value = event?.location || ''; input.notes.value = event?.notes || '';
      allDay.checked = event?.all_day || false;
      const defaultStart = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate(), 9);
      assignDates(event ? parse(event.start, event.all_day) : defaultStart, event ? parse(event.end, event.all_day) : new Date(defaultStart.getTime() + 3600000));
      allDay.onchange = () => {
        const start = parse(input.start.value), end = parse(input.end.value);
        if (!Number.isFinite(+start) || !Number.isFinite(+end)) {
          input.start.type = input.end.type = allDay.checked ? 'date' : 'datetime-local';
          return;
        }
        assignDates(start, allDay.checked && dateKey(start) === dateKey(end) ? shift(start, 1) : (end > start ? end : new Date(start.getTime() + 3600000)));
      };
      feedback.textContent = '';
      const remove = document.getElementById('delete-event'); remove.hidden = !event;
      async function perform(command, args) {
        if (working) return;
        working = true;
        const actions = [...form.querySelectorAll('button')]; actions.forEach((action) => action.disabled = true);
        try { await invoke(command, args); dialog.close(); if (grid.isConnected) await load(); }
        catch (error) { feedback.textContent = String(error); }
        finally { working = false; actions.forEach((action) => action.disabled = false); }
      }
      dialog.oncancel = (e) => { if (working) e.preventDefault(); };
      document.getElementById('cancel-event').onclick = () => { if (!working) dialog.close(); };
      remove.onclick = () => { if (window.confirm('Delete this event?')) void perform('delete_local_event', { id: event.id, prior: event }); };
      form.onsubmit = (e) => {
        e.preventDefault();
        const fields = Object.fromEntries(new FormData(form));
        fields.all_day = allDay.checked;
        if (!fields.all_day) {
          const start = parse(fields.start), end = parse(fields.end);
          if (!Number.isFinite(+start) || !Number.isFinite(+end)) { feedback.textContent = 'Enter valid event times.'; return; }
          fields.start = start.toISOString(); fields.end = end.toISOString();
        }
        void perform('save_local_event', { id: event?.id ?? null, prior: event ?? null, fields });
      };
      dialog.showModal();
    }
    void load();
  }
  return { mount };
})();
