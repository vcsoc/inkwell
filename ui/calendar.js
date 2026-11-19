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
  const minutesPerDay = 24 * 60;
  const wallMinute = (date) => date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  const percentOfDay = (minutes) => `${minutes / minutesPerDay * 100}%`;

  function timedBlocks(day, entries) {
    const midnight = parse(dateKey(day)), tomorrow = shift(midnight, 1);
    const blocks = entries.filter((event) => !event.all_day).map((event) => {
      const start = event.startDate <= midnight ? 0 : wallMinute(event.startDate);
      let end = event.endDate >= tomorrow ? minutesPerDay : wallMinute(event.endDate);
      // A fall-back clock change can put the wall-clock end before the start.
      if (end <= start) end = Math.min(minutesPerDay, start + (event.endDate - event.startDate) / 60000);
      return { event, start, end };
    }).sort((a, b) => a.start - b.start || b.end - a.end);
    let group = [], lanes = [], groupEnd = 0;
    function finishGroup() {
      for (const block of group) block.lanes = lanes.length;
      group = []; lanes = []; groupEnd = 0;
    }
    for (const block of blocks) {
      if (block.start >= groupEnd) finishGroup();
      const free = lanes.findIndex((end) => end <= block.start);
      block.lane = free === -1 ? lanes.length : free;
      lanes[block.lane] = block.end;
      groupEnd = Math.max(groupEnd, block.end);
      group.push(block);
    }
    finishGroup();
    return blocks;
  }
  function mount(root) {
    let selected = new Date(), ticket = 0, view = 'Month', records = [];
    const month = () => new Date(selected.getFullYear(), selected.getMonth(), 1);
    const newEvent = () => edit(null, selected, load);
    const workspace = node('section', null, 'calendar-workspace');
    workspace.setAttribute('aria-labelledby', 'calendar-period');
    const bar = node('div', null, 'calendar-toolbar');
    const navigation = node('div', null, 'calendar-controls');
    const options = node('div', null, 'calendar-controls');
    const title = node('h2', null, 'calendar-period'); title.id = 'calendar-period';
    const surface = node('div', null, 'calendar-surface');
    surface.setAttribute('role', 'region');
    surface.setAttribute('aria-labelledby', title.id);
    surface.tabIndex = 0;
    const details = node('dialog', null, 'calendar-details');
    details.setAttribute('aria-labelledby', 'calendar-details-title');
    const status = node('p', null, 'calendar-status'); status.setAttribute('role', 'status');
    const previous = button('\u2039', () => move(-1), 'calendar-arrow');
    const next = button('\u203a', () => move(1), 'calendar-arrow');
    const timelineScroll = new Map();
    const picker = node('input'); picker.type = 'date'; picker.setAttribute('aria-label', 'Go to date');
    picker.onchange = () => { if (picker.value) { selected = parse(picker.value); void load(); } };
    const mode = node('select'); mode.setAttribute('aria-label', 'Calendar view');
    mode.append(...['Month', 'Week', 'Day', 'Agenda'].map((name) => node('option', name)));
    mode.onchange = () => { view = mode.value; void load(); };
    navigation.append(button('Today', () => move(0)), previous, next);
    options.append(picker, mode, button('New event', newEvent, 'primary'));
    bar.append(navigation, title, options);
    workspace.append(bar, status, surface, details);
    root.append(workspace);
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
    function openDay(day) {
      selected = day;
      view = mode.value = 'Day';
      void load();
    }
    function dayButton(day, label) {
      const key = dateKey(day);
      const el = button(label, () => openDay(day), 'calendar-date');
      el.dataset.date = key;
      el.setAttribute('aria-label', dayLabel.format(day));
      if (key === dateKey(new Date())) el.setAttribute('aria-current', 'date');
      return el;
    }
    function eventDescription(event) {
      if (event.all_day) {
        return `All day | ${shortDate.formatRange(event.startDate, shift(event.endDate, -1))}`;
      }
      if (dateKey(event.startDate) === dateKey(event.endDate)) {
        return `${shortDate.format(event.startDate)} | ${timeLabel.formatRange(event.startDate, event.endDate)}`;
      }
      return `${shortDate.format(event.startDate)}, ${timeLabel.format(event.startDate)} - ${shortDate.format(event.endDate)}, ${timeLabel.format(event.endDate)}`;
    }
    function eventRow(event, day) {
      const row = node('article', null, 'record');
      row.append(node('h3', event.title), node('p', [eventDescription(event), event.location].filter(Boolean).join(' | ')));
      if (event.notes) row.append(node('p', event.notes, 'contact-notes'));
      row.append(event.editable ? button('Edit event', () => {
        if (details.open) details.close();
        edit(event, day, load);
      }) : node('p', 'Open in the legacy app to edit.'));
      return row;
    }
    function showDetails(day, entries) {
      const heading = node('h2', dayLabel.format(day)); heading.id = 'calendar-details-title';
      const header = node('div', null, 'calendar-details-header');
      header.append(heading, button('Close', () => details.close()));
      details.replaceChildren(header, ...entries.map((event) => eventRow(event, day)));
      details.showModal();
    }
    function eventButton(event, day, style, label = event.title) {
      const el = button(label, () => showDetails(day, [event]), style);
      el.title = `${event.title} | ${eventDescription(event)}`;
      el.setAttribute('aria-label', el.title);
      if (event.all_day) el.classList.add('calendar-all-day');
      return el;
    }
    function chips(cell, day, entries, limit) {
      for (const event of entries.slice(0, limit)) {
        const label = event.all_day || dateKey(event.startDate) !== dateKey(day)
          ? event.title : `${timeLabel.format(event.startDate)} ${event.title}`;
        cell.append(eventButton(event, day, 'calendar-chip', label));
      }
      if (entries.length > limit) {
        const more = button(`+${entries.length - limit} more`, () => showDetails(day, entries), 'calendar-more');
        more.setAttribute('aria-label', `${more.textContent} on ${dayLabel.format(day)}`);
        cell.append(more);
      }
    }
    function drawMonth(dates) {
      const grid = node('div', null, 'calendar-month');
      for (const day of dates.slice(0, 7)) grid.append(node('div', weekdays.format(day), 'calendar-weekday'));
      for (const day of dates) {
        const cell = node('div', null, 'calendar-month-cell');
        if (day.getMonth() !== month().getMonth()) cell.classList.add('calendar-outside');
        cell.append(dayButton(day, String(day.getDate())));
        chips(cell, day, forDay(day), 2);
        grid.append(cell);
      }
      surface.append(grid);
    }
    function drawTimeline(dates) {
      const timeline = node('div', null, 'calendar-timeline');
      timeline.style.setProperty('--calendar-days', dates.length);
      const header = node('div', null, 'calendar-timeline-header');
      header.append(node('div', 'Local time', 'calendar-time-caption'));
      for (const day of dates) {
        const cell = node('div', null, 'calendar-timeline-date');
        cell.append(node('span', weekdays.format(day), 'calendar-weekday'));
        if (view === 'Week') cell.append(dayButton(day, String(day.getDate())));
        else {
          const date = node('span', String(day.getDate()), 'calendar-date');
          if (dateKey(day) === dateKey(new Date())) date.setAttribute('aria-current', 'date');
          cell.append(date);
        }
        header.append(cell);
      }
      header.append(node('div', 'All day', 'calendar-time-caption'));
      const track = node('div', null, 'calendar-time-grid');
      const ruler = node('div', null, 'calendar-hour-ruler');
      for (let hour = 0; hour < 24; hour++) {
        const label = node('span', timeLabel.format(new Date(2000, 0, 1, hour)), 'calendar-hour');
        label.style.top = percentOfDay(hour * 60);
        ruler.append(label);
      }
      track.append(ruler);
      for (const day of dates) {
        const entries = forDay(day);
        const allDay = node('div', null, 'calendar-all-day-cell');
        chips(allDay, day, entries.filter((event) => event.all_day), 2);
        header.append(allDay);
        const column = node('div', null, 'calendar-hour-column');
        column.setAttribute('role', 'group');
        column.setAttribute('aria-label', dayLabel.format(day));
        column.onclick = (e) => {
          if (e.target !== column) return;
          const rect = column.getBoundingClientRect();
          const minute = Math.max(0, Math.min(1425, Math.floor((e.clientY - rect.top) / rect.height * 96) * 15));
          const start = parse(dateKey(day)); start.setMinutes(minute);
          edit(null, day, load, { start });
        };
        for (const { event, start, end, lane, lanes } of timedBlocks(day, entries)) {
          const label = dateKey(event.startDate) === dateKey(day) ? `${timeLabel.format(event.startDate)} ${event.title}` : event.title;
          const el = eventButton(event, day, 'calendar-time-event', label);
          Object.assign(el.style, {
            top: percentOfDay(start), height: percentOfDay(end - start),
            insetInlineStart: `${lane / lanes * 100}%`, width: `${100 / lanes}%`,
          });
          column.append(el);
        }
        track.append(column);
      }
      timeline.append(header, track);
      surface.append(timeline);
      return track.offsetHeight / 3; // Start at 08:00 local time.
    }
    function draw() {
      const [first, days] = range();
      const dates = Array.from({ length: days }, (_, i) => shift(first, i));
      picker.value = dateKey(selected);
      previous.setAttribute('aria-label', `Previous ${view.toLowerCase()}`);
      next.setAttribute('aria-label', `Next ${view.toLowerCase()}`);
      title.textContent = view === 'Month' ? monthLabel.format(month()) : view === 'Day'
        ? dayLabel.format(selected) : shortDate.formatRange(first, dates.at(-1));
      const focusedDay = surface.contains(document.activeElement) && document.activeElement.dataset.date;
      const previousView = surface.dataset.mode;
      const sameView = previousView === view;
      if (previousView === 'Week' || previousView === 'Day') timelineScroll.set(previousView, surface.scrollTop);
      const left = sameView ? surface.scrollLeft : 0;
      surface.dataset.mode = view;
      surface.replaceChildren();
      if (view === 'Month') drawMonth(dates);
      else if (view === 'Week' || view === 'Day') {
        const initialTop = drawTimeline(dates);
        surface.scrollTop = timelineScroll.get(view) ?? initialTop;
      } else {
        const agenda = node('section', null, 'calendar-list');
        for (const day of dates) {
          const entries = forDay(day);
          if (entries.length) agenda.append(node('h2', dayLabel.format(day)), ...entries.map((event) => eventRow(event, day)));
        }
        if (!agenda.hasChildNodes() && !status.textContent) agenda.append(node('p', 'No events in this date range.'));
        surface.append(agenda);
      }
      if (!sameView && view !== 'Week' && view !== 'Day') surface.scrollTop = 0;
      surface.scrollLeft = left;
      if (focusedDay) (surface.querySelector(`[data-date="${focusedDay}"]`) || surface).focus({ preventScroll: true });
    }
    async function load() {
      if (!surface.isConnected) return;
      const id = ++ticket;
      const [first, days] = range();
      records = [];
      status.textContent = 'Loading calendar...';
      draw();
      try {
        // The backend bounds use stored date prefixes, not browser-local dates.
        const data = await invoke('events', { start: dateKey(shift(first, -1)), end: dateKey(shift(first, days + 1)) });
        if (id !== ticket || !surface.isConnected) return;
        records = data.map((event) => ({ ...event, startDate: parse(event.start, event.all_day), endDate: parse(event.end, event.all_day) }))
          .filter((event) => event.endDate > event.startDate)
          .sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.startDate - b.startDate);
        status.textContent = ''; draw();
      } catch (error) { if (id === ticket && surface.isConnected) status.textContent = String(error); }
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
      const defaultStart = seed.start instanceof Date ? seed.start : new Date(selected.getFullYear(), selected.getMonth(), selected.getDate(), 9);
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
