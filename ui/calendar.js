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
  const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const weekdays = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const startOfWeek = (date) => shift(date, -date.getDay());
  const agendaDays = 30;
  function mount(root) {
    let selected = new Date(), ticket = 0, view = 'Month', records = [];
    const month = () => new Date(selected.getFullYear(), selected.getMonth(), 1);
    const newEvent = () => edit(null, selected, load);
    const bar = node('div', null, 'theme-actions');
    const title = node('h2');
    const grid = node('div', null, 'calendar-grid');
    const agenda = node('section', null, 'calendar-agenda');
    const status = node('p'); status.setAttribute('role', 'status');
    const previous = button('Previous', () => move(-1));
    const next = button('Next', () => move(1));
    const picker = node('input'); picker.type = 'date'; picker.setAttribute('aria-label', 'Go to date');
    picker.onchange = () => { if (picker.value) { selected = parse(picker.value); void load(); } };
    const mode = node('select'); mode.setAttribute('aria-label', 'Calendar view');
    mode.append(...['Month', 'Week', 'Day', 'Agenda'].map((name) => node('option', name)));
    mode.onchange = () => { view = mode.value; void load(); };
    bar.append(previous, button('Today', () => move(0)), next, picker, mode, button('New event', newEvent, 'primary'));
    root.append(bar, title, status, grid, agenda);
    function move(delta) {
      if (!delta) selected = new Date();
      else if (view === 'Month') {
        const first = new Date(selected.getFullYear(), selected.getMonth() + delta, 1);
        const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
        selected = shift(first, Math.min(selected.getDate(), last) - 1);
      } else selected = shift(selected, delta * ({ Week: 7, Day: 1, Agenda: agendaDays }[view]));
      void load();
    }
    function range() {
      if (view === 'Month') return [startOfWeek(month()), 42];
      if (view === 'Week') return [startOfWeek(selected), 7];
      return [selected, view === 'Agenda' ? agendaDays : 1];
    }
    function forDay(date) {
      const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const endOfDay = shift(startOfDay, 1);
      return records.filter((event) => event.startDate < endOfDay && event.endDate > startOfDay);
    }
    function draw() {
      const [first, days] = range();
      picker.value = dateKey(selected);
      previous.setAttribute('aria-label', `Previous ${view.toLowerCase()}`);
      next.setAttribute('aria-label', `Next ${view.toLowerCase()}`);
      title.textContent = view === 'Month' ? monthLabel.format(month()) : view === 'Day'
        ? dayLabel.format(selected) : shortDate.formatRange(first, shift(first, days - 1));
      const focusedDay = grid.contains(document.activeElement) && document.activeElement.dataset.date;
      grid.replaceChildren();
      if (view === 'Month' || view === 'Week') {
        for (let i = 0; i < 7; i++) grid.append(node('span', weekdays.format(shift(first, i)), 'calendar-weekday'));
        for (let i = 0; i < days; i++) {
          const day = shift(first, i), key = dateKey(day), entries = forDay(day);
          const el = button(String(day.getDate()), () => {
            const changedMonth = day.getMonth() !== selected.getMonth();
            selected = day;
            if (view === 'Month' && changedMonth) void load();
            else draw();
          }, 'calendar-day');
          el.style.minWidth = '0';
          el.dataset.date = key;
          const visible = entries.slice(0, view === 'Month' ? 3 : 5);
          for (const event of visible) {
            const chip = node('small', event.title);
            Object.assign(chip.style, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
            chip.title = event.title;
            el.append(chip);
          }
          if (entries.length > visible.length) el.append(node('small', `+${entries.length - visible.length} more`));
          el.setAttribute('aria-label', [dayLabel.format(day), ...(entries.length ? [`${entries.length} events`, ...visible.map((event) => event.title)] : [])].join(', '));
          el.setAttribute('aria-pressed', String(key === dateKey(selected)));
          if (key === dateKey(new Date())) el.setAttribute('aria-current', 'date');
          if (view === 'Month' && day.getMonth() !== month().getMonth()) el.classList.add('outside');
          grid.append(el);
        }
        if (focusedDay) grid.querySelector(`[data-date="${focusedDay}"]`)?.focus({ preventScroll: true });
      }
      agenda.replaceChildren();
      function list(day, entries) {
        agenda.append(node('h2', dayLabel.format(day)));
        for (const event of entries) {
          const row = node('article', null, 'record');
          const time = event.all_day ? 'All day' : dateKey(event.startDate) !== dateKey(day)
            ? `Continues from ${shortDate.format(event.startDate)}`
            : dateKey(event.endDate) === dateKey(day) ? `${timeLabel.format(event.startDate)} - ${timeLabel.format(event.endDate)}` : timeLabel.format(event.startDate);
          row.append(node('h3', event.title), node('p', [time, event.location].filter(Boolean).join(' | ')));
          if (event.notes) row.append(node('p', event.notes, 'contact-notes'));
          row.append(event.editable ? button('Edit event', () => edit(event, selected, load)) : node('p', 'Open in the legacy app to edit.'));
          agenda.append(row);
        }
      }
      if (view === 'Agenda') {
        for (let i = 0; i < days; i++) {
          const day = shift(first, i), entries = forDay(day);
          if (entries.length) list(day, entries);
        }
        if (!agenda.hasChildNodes() && !status.textContent) agenda.append(node('p', 'No events in this date range.'));
      } else {
        const entries = forDay(selected);
        list(selected, entries);
        if (!entries.length && !status.textContent) agenda.append(node('p', 'No events on this day.'));
      }
    }
    async function load() {
      if (!grid.isConnected) return;
      const id = ++ticket;
      const [first, days] = range();
      records = [];
      status.textContent = 'Loading calendar...';
      draw();
      try {
        // The backend bounds use stored date prefixes, not browser-local dates.
        const data = await invoke('events', { start: dateKey(shift(first, -1)), end: dateKey(shift(first, days + 1)) });
        if (id !== ticket || !grid.isConnected) return;
        records = data.map((event) => ({ ...event, startDate: parse(event.start, event.all_day), endDate: parse(event.end, event.all_day) }))
          .sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.startDate - b.startDate);
        status.textContent = ''; draw();
      } catch (error) { if (id === ticket && grid.isConnected) status.textContent = String(error); }
    }
    void load();
  }
  function edit(event, selected, reload, seed = {}) {
      const dialog = document.getElementById('event-dialog');
      const form = document.getElementById('event-form');
      const feedback = document.getElementById('event-status');
      if (dialog.open) return false;
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
      input.title.value = event?.title ?? (typeof seed.title === 'string' ? seed.title.trim().slice(0, 200) : '');
      input.location.value = event?.location ?? (typeof seed.location === 'string' ? seed.location.slice(0, 500) : '');
      input.notes.value = event?.notes ?? (typeof seed.notes === 'string' ? seed.notes.slice(0, 10000) : '');
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
        try { await invoke(command, args); dialog.close(); await reload?.(); }
        catch (error) { feedback.textContent = String(error); }
        finally { working = false; actions.forEach((action) => action.disabled = false); }
      }
      dialog.oncancel = (e) => { if (working) e.preventDefault(); };
      document.getElementById('cancel-event').onclick = () => { if (!working) dialog.close(); };
      remove.onclick = event ? () => { if (window.confirm('Delete this event?')) void perform('delete_local_event', { id: event.id, prior: event }); } : null;
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
      return true;
  }
  function openFromMail(seed) {
    return edit(null, new Date(), null, seed ?? {});
  }
  return { mount, openFromMail };
})();
