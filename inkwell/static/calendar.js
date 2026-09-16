'use strict';
window.InkwellCalendar = ({ api, modal, state, esc, field, textarea, toast, importCalendar }) => {
  const $ = (s) => document.querySelector(s);
  const key = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const date = (e, part) =>
    e.all_day ? new Date(e[part].slice(0, 10) + 'T00:00:00') : new Date(e[part]);
  const wall = (value, zone) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(new Date(value))
        .map((p) => [p.type, p.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  };
  function instant(value, zone) {
    let guess = Date.parse(value + 'Z');
    for (let i = 0; i < 4; i++)
      guess += Date.parse(value + 'Z') - Date.parse(wall(guess, zone) + 'Z');
    if (wall(guess, zone) !== value)
      throw Error(
        'This local time does not exist in the selected timezone (daylight saving). Choose another time.',
      );
    return new Date(guess).toISOString();
  }
  async function render() {
    const generation = state.generation,
      year = state.month.getFullYear(),
      month = state.month.getMonth();
    const start = new Date(year, month, 1);
    start.setDate(1 - start.getDay());
    const end = new Date(start);
    end.setDate(end.getDate() + 42);
    const events = await api(
      '/events/occurrences?' +
        new URLSearchParams({ start: start.toISOString(), end: end.toISOString() }),
    );
    if (generation !== state.generation) return;
    state.events = events;
    let days = '';
    for (let i = 0; i < 42; i++) {
      const day = new Date(start);
      day.setDate(day.getDate() + i);
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      const items = events.filter((e) => date(e, 'start') < next && date(e, 'end') > day);
      days += `<div class="calendar-day ${day.getMonth() !== month ? 'outside' : ''} ${key(day) === key(new Date()) ? 'is-today' : ''}" data-date="${key(day)}"><button class="day-number" data-day="${key(day)}" aria-label="Add event on ${esc(day.toDateString())}">${day.getDate()}</button>${items
        .slice(0, 3)
        .map(
          (e) =>
            `<button class="calendar-event" data-event="${e.id}" title="${esc(e.title)}">${e.all_day ? '▰ ' : ''}${esc(e.title)}</button>`,
        )
        .join('')}${items.length > 3 ? `<small>+${items.length - 3} more</small>` : ''}</div>`;
    }
    const visible = events.filter(
      (e) =>
        date(e, 'start') < new Date(year, month + 1, 1) &&
        date(e, 'end') > new Date(year, month, 1),
    );
    $('#workspace').innerHTML =
      `<div class="calendar-header"><h2>${state.month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</h2><div class="calendar-controls"><button class="secondary" id="import-calendar">Import .ics</button><button class="secondary" id="select-range" aria-pressed="false">Select date range</button><button class="icon-button" id="month-prev" aria-label="Previous month">‹</button><button class="secondary" id="month-today">Today</button><button class="icon-button" id="month-next" aria-label="Next month">›</button></div></div><p id="range-hint" class="notice" role="status">Click a date, drag across days, or use Select date range to choose two endpoints.</p><div class="calendar-grid">${['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((d) => `<div class="day-label">${d}</div>`).join('')}${days}</div><section class="agenda"><div class="calendar-header"><h2>This month’s agenda</h2><a class="secondary" href="/api/calendar.ics" download>Export .ics ↗</a></div>${visible.length ? visible.map((e) => `<button class="agenda-row" data-event="${e.id}"><div class="agenda-date">${date(e, 'start').toLocaleDateString([], { month: 'short' })}<strong>${date(e, 'start').getDate()}</strong></div><div><h3>${esc(e.title)}</h3><p>${e.all_day ? 'All day' : esc(date(e, 'start').toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}${JSON.parse(e.recurrence || '{}').frequency && JSON.parse(e.recurrence).frequency !== 'none' ? ' · Repeating series' : ''}${e.location ? ' · ' + esc(e.location) : ''}</p></div></button>`).join('') : '<div class="notice">A clear calendar. Tap a date to make room for something good.</div>'}</section><div class="quiet-note">Local calendar · not provider-synced · Desktop reminders for timed events: 15 minutes before, while Inkwell is open. Sleep or OS notification settings may delay/suppress alerts. All-day events have no timed alert.</div>`;
    $('#month-prev').onclick = () => {
      state.month = new Date(year, month - 1, 1);
      render().catch((e) => toast(e.message));
    };
    $('#month-next').onclick = () => {
      state.month = new Date(year, month + 1, 1);
      render().catch((e) => toast(e.message));
    };
    $('#import-calendar').onclick = importCalendar;
    $('#month-today').onclick = () => {
      state.month = new Date();
      render().catch((e) => toast(e.message));
    };
    document
      .querySelectorAll('[data-event]')
      .forEach(
        (b) =>
          (b.onclick = () =>
            window.inkwellEventForm(events.find((e) => e.id === Number(b.dataset.event)))),
      );
    let rangeMode = false,
      anchor = null,
      drag = null,
      finish = null,
      suppress = false;
    const highlight = (a, b) =>
      document
        .querySelectorAll('[data-date]')
        .forEach((cell) =>
          cell.classList.toggle(
            'range-selected',
            cell.dataset.date >= (a < b ? a : b) && cell.dataset.date <= (a > b ? a : b),
          ),
        );
    const openRange = (a, b) => {
      const first = a < b ? a : b,
        last = a > b ? a : b;
      const end = new Date(last + 'T00:00:00');
      end.setDate(end.getDate() + 1);
      window.inkwellEventForm({
        all_day: true,
        start: first + 'T00:00:00Z',
        end: key(end) + 'T00:00:00Z',
      });
    };
    $('#select-range').onclick = () => {
      rangeMode = !rangeMode;
      anchor = null;
      $('#select-range').setAttribute('aria-pressed', String(rangeMode));
      $('#range-hint').textContent = rangeMode
        ? 'Choose the first day, then the last day (inclusive).'
        : 'Click or drag dates to create an event.';
    };
    document.querySelectorAll('[data-day]').forEach(
      (b) =>
        (b.onclick = () => {
          if (suppress) return;
          if (rangeMode) {
            if (!anchor) {
              anchor = b.dataset.day;
              highlight(anchor, anchor);
            } else {
              openRange(anchor, b.dataset.day);
              rangeMode = false;
              anchor = null;
              $('#select-range').setAttribute('aria-pressed', 'false');
            }
            return;
          }
          const start = new Date(b.dataset.day + 'T09:00:00');
          window.inkwellEventForm({
            start: start.toISOString(),
            end: new Date(+start + 3600000).toISOString(),
          });
        }),
    );
    const grid = $('.calendar-grid');
    grid.onpointerdown = (e) => {
      if (e.button !== 0 || e.target.closest('[data-event]') || rangeMode) return;
      const cell = e.target.closest('[data-date]');
      if (!cell) return;
      drag = finish = cell.dataset.date;
    };
    grid.onpointermove = (e) => {
      if (!drag) return;
      const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-date]');
      if (cell) {
        finish = cell.dataset.date;
        if (finish !== drag) grid.setPointerCapture(e.pointerId);
        highlight(drag, finish);
      }
    };
    grid.onpointerup = () => {
      if (drag && finish !== drag) {
        suppress = true;
        openRange(drag, finish);
        setTimeout(() => (suppress = false), 0);
      }
      drag = null;
    };
    grid.onpointerleave = (e) => {
      if (!grid.hasPointerCapture(e.pointerId)) drag = null;
    };
    grid.onlostpointercapture = () => {
      drag = null;
    };
    grid.onpointercancel = () => {
      drag = null;
      document
        .querySelectorAll('.range-selected')
        .forEach((c) => c.classList.remove('range-selected'));
    };
  }
  function form(event = {}) {
    event = {
      ...event,
      start: event.series_start || event.start,
      end: event.series_end || event.end,
    };
    const zone = event.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const start = event.start || new Date(Date.now() + 3600000).toISOString(),
      end = event.end || new Date(Date.parse(start) + 3600000).toISOString();
    const rec =
      typeof event.recurrence === 'string' ? JSON.parse(event.recurrence) : event.recurrence || {};
    const last = new Date(end.slice(0, 10) + 'T00:00:00');
    last.setDate(last.getDate() - 1);
    modal(
      event.id ? 'Edit event' : 'Make a little time',
      `<form id="event-form">${field('Event title', 'title', event.title || '', 'text', 'required maxlength="200"')}<label class="check-label"><input type="checkbox" name="all_day" ${event.all_day ? 'checked' : ''}> All day</label><div class="field-row">${field('Starts', 'start', event.all_day ? start.slice(0, 10) : wall(start, zone), event.all_day ? 'date' : 'datetime-local', 'required')}${field('Ends', 'end', event.all_day ? key(last) : wall(end, zone), event.all_day ? 'date' : 'datetime-local', 'required')}</div>${field('Event timezone', 'timezone', zone, 'text', 'required maxlength="100"')}<label class="field">Repeat<select name="frequency" aria-label="Repeat">${['none', 'daily', 'weekly', 'monthly', 'yearly'].map((f) => `<option value="${f}" ${f === (rec.frequency || 'none') ? 'selected' : ''}>${f === 'none' ? 'Does not repeat' : f}</option>`).join('')}</select></label><div class="field-row">${field('Repeat every (interval)', 'interval', rec.interval || 1, 'number', 'required min="1" max="365"')}${field('Maximum occurrences', 'count', rec.count || 10, 'number', 'required min="1" max="1000"')}</div>${field('Stop repeating after (optional)', 'until', rec.until || '', 'date')}<fieldset class="repeat-weekdays"><legend>Weekly repeat days (optional)</legend>${['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].map((d) => `<label><input name="weekdays" type="checkbox" value="${d}" ${rec.weekdays?.includes(d) ? 'checked' : ''}>${d}</label>`).join('')}</fieldset>${field('Location or meeting link', 'location', event.location || '', 'text', 'maxlength="500"')}${textarea('Notes', 'notes', event.notes || '', 'maxlength="10000"')}<div class="notice">All-day end dates are inclusive here. Repeats stop at the count or optional date, whichever comes first. Monthly repeats skip months without that date. Editing or deleting changes the entire series. No invitations are sent.</div><div class="form-actions">${event.id ? '<button type="button" class="secondary danger" id="delete-event">Delete event</button>' : ''}<button class="primary" type="submit">Save event</button></div></form>`,
      { calendar: true },
    );
    const form = $('#event-form');
    form.elements.all_day.onchange = () => {
      for (const name of ['start', 'end']) {
        const input = form.elements[name],
          value = input.value;
        input.type = form.elements.all_day.checked ? 'date' : 'datetime-local';
        input.value = form.elements.all_day.checked
          ? value.slice(0, 10)
          : value + 'T' + (name === 'start' ? '09:00' : '10:00');
      }
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const data = new FormData(form),
          all_day = form.elements.all_day.checked;
        let start, end;
        if (all_day) {
          start = data.get('start') + 'T00:00:00Z';
          const last = new Date(data.get('end') + 'T00:00:00');
          last.setDate(last.getDate() + 1);
          end = key(last) + 'T00:00:00Z';
        } else {
          start = instant(data.get('start'), data.get('timezone'));
          end = instant(data.get('end'), data.get('timezone'));
        }
        await api('/events' + (event.id ? '/' + event.id : ''), {
          method: event.id ? 'PUT' : 'POST',
          body: {
            title: data.get('title'),
            start,
            end,
            all_day,
            timezone: data.get('timezone'),
            location: data.get('location'),
            notes: data.get('notes'),
            recurrence: {
              frequency: data.get('frequency'),
              interval: Number(data.get('interval')),
              count: Number(data.get('count')),
              until: data.get('until') || null,
              weekdays: data.getAll('weekdays'),
            },
          },
        });
        $('#modal').close();
        await render();
        toast('Time well reserved.');
      } catch (error) {
        toast(error.message);
      }
    };
    if ($('#delete-event'))
      $('#delete-event').onclick = async () => {
        try {
          await api('/events/' + event.id, { method: 'DELETE' });
          $('#modal').close();
          await render();
        } catch (error) {
          toast(error.message);
        }
      };
  }
  return { render, form };
};
