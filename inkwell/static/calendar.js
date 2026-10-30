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
  const clock = (event, part = 'start') =>
    new Intl.DateTimeFormat([], {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(date(event, part));
  const eventTime = (event) =>
    event.all_day
      ? '<span class="calendar-event-time">All day</span>'
      : `<time class="calendar-event-time" datetime="${esc(event.start)}">${esc(clock(event))}</time>`;
  let previewTimer, previewHideTimer, previewAnchor, previewPendingAnchor;
  const hidePreview = () => {
    clearTimeout(previewTimer);
    clearTimeout(previewHideTimer);
    previewPendingAnchor = null;
    previewAnchor?.removeAttribute('aria-describedby');
    previewAnchor = null;
    $('#calendar-event-preview')?.remove();
  };
  const laterHidePreview = () => {
    clearTimeout(previewHideTimer);
    previewHideTimer = setTimeout(() => {
      const owner = previewAnchor || previewPendingAnchor;
      if (owner === document.activeElement || owner?.matches(':hover')) return;
      hidePreview();
    }, 120);
  };
  function bindPreview(button, event) {
    const show = () => {
      hidePreview();
      previewPendingAnchor = button;
      previewTimer = setTimeout(() => {
        if (!button.isConnected) return;
        previewAnchor = button;
        const first = date(event, 'start'),
          last = date(event, 'end');
        if (event.all_day) last.setDate(last.getDate() - 1);
        const day = (value) =>
          value.toLocaleDateString([], {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });
        const timing = event.all_day
          ? `${day(first)}${day(first) !== day(last) ? ' – ' + day(last) : ''} · All day`
          : `${day(first)} · ${clock(event)} – ${day(first) !== day(last) ? day(last) + ' ' : ''}${clock(event, 'end')}`;
        const card = document.createElement('aside');
        card.id = 'calendar-event-preview';
        card.setAttribute('role', 'tooltip');
        card.innerHTML = `<small class="calendar-preview-source">${esc(event.calendar_name || 'Workspace calendar')}${event.calendar_can_edit === 0 ? ' · Read-only' : ''}</small><h3>${esc(event.title)}</h3><p>${esc(timing)}</p><small class="calendar-preview-zone">${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}</small>${event.location ? `<p class="calendar-preview-location">${esc(event.location)}</p>` : ''}${event.notes ? `<p class="calendar-preview-notes">${esc(event.notes.slice(0, 600))}</p>` : ''}`;
        document.body.append(card);
        button.setAttribute('aria-describedby', card.id);
        const anchor = button.getBoundingClientRect(),
          bounds = card.getBoundingClientRect();
        const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        card.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - bounds.width - 8)) / zoom}px`;
        card.style.top = `${Math.max(8, Math.min(anchor.bottom + 8 + bounds.height <= innerHeight - 8 ? anchor.bottom + 8 : anchor.top - bounds.height - 8, innerHeight - bounds.height - 8)) / zoom}px`;
        card.onmouseenter = () => clearTimeout(previewHideTimer);
        card.onmouseleave = laterHidePreview;
      }, 180);
    };
    button.addEventListener('mouseenter', show);
    button.addEventListener('mouseleave', laterHidePreview);
    button.addEventListener('focus', show);
    button.addEventListener('blur', laterHidePreview);
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hidePreview();
  });
  document.addEventListener('pointerdown', hidePreview, true);
  document.addEventListener(
    'scroll',
    () => {
      if ($('#calendar-event-preview')) hidePreview();
    },
    true,
  );
  window.addEventListener('hashchange', hidePreview);
  window.addEventListener('resize', hidePreview);
  let calendarPoll;
  let requestedRange = '';
  async function render(refresh = true) {
    clearTimeout(calendarPoll);
    const focusedEvent = document.activeElement?.matches('[data-event]')
      ? document.activeElement
      : null;
    hidePreview();
    const generation = state.generation,
      year = state.month.getFullYear(),
      month = state.month.getMonth();
    const start = new Date(year, month, 1);
    start.setDate(1 - start.getDay());
    const end = new Date(start);
    end.setDate(end.getDate() + 42);
    const range = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
    const [events, pending, provider, inventory] = await Promise.all([
      api('/events/occurrences?' + range),
      api('/calendar/pending?' + range),
      api('/provider-sync'),
      api('/calendars'),
    ]);
    if (generation !== state.generation) return;
    state.events = events;
    state.outlookCalendars = inventory.calendars;
    const sources = `<div class="calendar-source-pills" role="group" aria-label="Outlook calendars">${inventory.calendars.map((c) => `<button type="button" class="calendar-source-pill" data-calendar-source="${c.id}" aria-pressed="${!!c.selected}" title="${esc(c.account_email)}${c.can_edit ? '' : ' · Read-only'}"><span class="calendar-source-dot" aria-hidden="true"></span>${esc(c.name)}</button>`).join('')}</div>`;
    const syncStatus = `<details class="calendar-sync-status"><summary>${inventory.sync.active ? 'Syncing…' : inventory.sync.errors.length ? 'Needs attention' : 'Calendar status'}</summary><div class="outlook-calendar-body"><p role="status">${inventory.sync.active ? 'Synchronizing Outlook calendars…' : inventory.calendars.length ? `${inventory.calendars.length} Outlook calendars connected. Highlighted calendars appear below.` : inventory.accounts.length ? 'Discovering your Outlook calendars. Use Sync calendars to retry.' : 'No Outlook account connected. Connect Microsoft under Settings → Mail accounts.'}</p>${inventory.calendars
      .filter((c) => !c.can_edit)
      .map((c) => `<p>${esc(c.name)} · Read-only</p>`)
      .join(
        '',
      )}${inventory.sync.errors.map((e) => `<p class="notice" role="alert">${esc(e.error)}</p>`).join('')}</div></details>`;
    let days = '';
    for (let i = 0; i < 42; i++) {
      const day = new Date(start);
      day.setDate(day.getDate() + i);
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      const items = [
        ...events
          .filter((e) => date(e, 'start') < next && date(e, 'end') > day)
          .map((e) => ({ event: e })),
        ...pending
          .filter((p) => date(p.event, 'start') < next && date(p.event, 'end') > day)
          .map((p) => ({ pending: p })),
      ].sort(
        (a, b) =>
          date(a.event || a.pending.event, 'start') - date(b.event || b.pending.event, 'start'),
      );
      days += `<div class="calendar-day ${day.getMonth() !== month ? 'outside' : ''} ${key(day) === key(new Date()) ? 'is-today' : ''}" data-date="${key(day)}"><button class="day-number" data-day="${key(day)}" aria-label="Add event on ${esc(day.toDateString())}">${day.getDate()}</button>${items
        .slice(0, 3)
        .map(({ event: e, pending: p }) =>
          p
            ? `<button class="calendar-event calendar-pending ${p.status === 'rejected' ? 'rejected' : ''}" data-pending="${esc(p.uid)}" aria-label="${esc(p.event.title)} · ${esc(p.status)}">◌ ${eventTime(p.event)} ${esc(p.event.title)}</button>`
            : `<button class="calendar-event" data-event="${e.id}" data-event-start="${esc(e.start)}" aria-label="${e.all_day ? 'All day' : esc(clock(e))} ${esc(e.title)} · ${esc(e.calendar_name || 'Workspace calendar')}">${eventTime(e)} <span class="calendar-event-title">${esc(e.title)}</span></button>`,
        )
        .join('')}${items.length > 3 ? `<small>+${items.length - 3} more</small>` : ''}</div>`;
    }
    const visible = events.filter(
      (e) =>
        date(e, 'start') < new Date(year, month + 1, 1) &&
        date(e, 'end') > new Date(year, month, 1),
    );
    const pendingVisible = pending.filter(
      (p) =>
        date(p.event, 'start') < new Date(year, month + 1, 1) &&
        date(p.event, 'end') > new Date(year, month, 1),
    );
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);
    const isToday = (item) => date(item, 'start') < todayEnd && date(item, 'end') > todayStart;
    const plannedToday =
      visible.filter(isToday).length + pendingVisible.filter((p) => isToday(p.event)).length;
    $('#calendar-footer-status').textContent =
      `Calendar · ${plannedToday ? `${plannedToday} item${plannedToday === 1 ? '' : 's'} planned today` : 'No items planned today'}`;
    const agendaRows =
      visible.length || pendingVisible.length
        ? visible
            .map(
              (e) =>
                `<button class="agenda-row ${isToday(e) ? 'is-today' : ''}" data-event="${e.id}" data-event-start="${esc(e.start)}"><div class="agenda-date">${date(e, 'start').toLocaleDateString([], { month: 'short' })}<strong>${date(e, 'start').getDate()}</strong></div><div><h3>${esc(e.title)}</h3><p>${e.all_day ? 'All day' : esc(date(e, 'start').toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}${JSON.parse(e.recurrence || '{}').frequency && JSON.parse(e.recurrence).frequency !== 'none' ? ' · Repeating series' : ''}${e.location ? ' · ' + esc(e.location) : ''}</p></div></button>`,
            )
            .join('') +
          pendingVisible
            .map(
              (p) =>
                `<button class="agenda-row calendar-pending ${p.status === 'rejected' ? 'rejected' : ''} ${isToday(p.event) ? 'is-today' : ''}" data-pending="${esc(p.uid)}"><div class="agenda-date">${date(p.event, 'start').toLocaleDateString([], { month: 'short' })}<strong>${date(p.event, 'start').getDate()}</strong></div><div><h3>${esc(p.event.title)}</h3><p>${esc(p.status === 'rejected' ? 'Rejected locally' : 'Pending · Review invitation')} · ${esc(date(p.event, 'start').toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</p></div></button>`,
            )
            .join('')
        : '<div class="notice">A clear calendar. Tap a date to make room for something good.</div>';
    const agendaOpen = !!state.calendarAgendaOpen;
    const restoreEventFocus = focusedEvent && document.activeElement === focusedEvent;
    $('#workspace').innerHTML =
      `<div id="calendar-layout" class="calendar-layout"><div class="calendar-main"><div class="calendar-header calendar-month-header"><div class="calendar-month-navigation"><h2>${state.month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</h2><div class="calendar-month-buttons" role="group" aria-label="Month navigation"><button class="icon-button" id="month-prev" aria-label="Previous month">‹</button><button class="secondary" id="month-today">Today</button><button class="icon-button" id="month-next" aria-label="Next month">›</button></div></div>${sources}<div class="calendar-controls">${syncStatus}<button type="button" class="secondary" id="sync-outlook-calendars">Sync calendars</button><button class="secondary" id="import-calendar">Import .ics</button><button class="secondary" id="select-range" aria-pressed="false" title="Choose the first and last day of an event">Select date range</button></div></div><p id="range-hint" class="sr-only" role="status">Click a date, drag across days, or use Select date range to choose two endpoints.</p><div class="calendar-grid" aria-describedby="range-hint">${['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((d) => `<div class="day-label">${d}</div>`).join('')}${days}</div></div><aside class="calendar-agenda-panel ${agendaOpen ? 'open' : ''}" aria-label="Monthly agenda"><button type="button" id="agenda-toggle" class="calendar-agenda-toggle" aria-expanded="${agendaOpen}" aria-controls="calendar-agenda" aria-label="${agendaOpen ? 'Collapse' : 'Expand'} monthly agenda" title="${agendaOpen ? 'Collapse' : 'Expand'} monthly agenda"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M7 2v4M17 2v4M3 9h18M7 13h2M12 13h5M7 17h2M12 17h5"/></svg><strong>Agenda</strong><small>${visible.length + pendingVisible.length}</small></button><section class="agenda" id="calendar-agenda" ${agendaOpen ? '' : 'hidden'}><div class="calendar-header"><h2>This month’s agenda</h2><a class="secondary" href="/api/calendar.ics" download>Export .ics ↗</a></div>${agendaRows}<div class="calendar-important-note" role="note"><strong>Important</strong><p>Outlook calendars are listed above. Changes to connected events queue to their source calendar. Historical unlinked entries are preserved and are not uploaded automatically. Accepting an email suggestion is not an Outlook RSVP. ${provider.failed ? `${provider.failed} provider change${provider.failed === 1 ? '' : 's'} failed; review Mail accounts settings.` : ''} Desktop reminders are about 15 minutes before timed events while Inkwell is open; sleep and OS settings can delay or suppress alerts. All-day events have no timed alert.</p></div></section></aside></div>`;
    const scrollToToday = () => {
      const panel = $('#calendar-agenda');
      const row = panel?.querySelector('.agenda-row.is-today');
      if (panel && row && !panel.hidden) {
        const delta = row.getBoundingClientRect().top - panel.getBoundingClientRect().top;
        panel.scrollTop += delta - Math.min(85, panel.clientHeight / 4);
      }
    };
    if (agendaOpen) requestAnimationFrame(scrollToToday);
    $('#agenda-toggle').onclick = () => {
      state.calendarAgendaOpen = !state.calendarAgendaOpen;
      const panel = $('#calendar-layout .calendar-agenda-panel');
      const toggle = $('#agenda-toggle');
      panel.classList.toggle('open', state.calendarAgendaOpen);
      $('#calendar-agenda').hidden = !state.calendarAgendaOpen;
      if (state.calendarAgendaOpen) requestAnimationFrame(scrollToToday);
      toggle.setAttribute('aria-expanded', String(state.calendarAgendaOpen));
      toggle.setAttribute(
        'aria-label',
        `${state.calendarAgendaOpen ? 'Collapse' : 'Expand'} monthly agenda`,
      );
      toggle.title = toggle.getAttribute('aria-label');
    };
    $('#month-prev').onclick = () => {
      state.month = new Date(year, month - 1, 1);
      render().catch((e) => toast(e.message));
    };
    $('#month-next').onclick = () => {
      state.month = new Date(year, month + 1, 1);
      render().catch((e) => toast(e.message));
    };
    $('#sync-outlook-calendars').onclick = async () => {
      try {
        await api('/calendars/sync', {
          method: 'POST',
          body: { start: start.toISOString(), end: end.toISOString() },
        });
        await render(false);
      } catch (error) {
        toast(error.message);
      }
    };
    document.querySelectorAll('[data-calendar-source]').forEach((button) => {
      button.onclick = async () => {
        const selected = button.getAttribute('aria-pressed') !== 'true';
        button.disabled = true;
        button.setAttribute('aria-pressed', String(selected));
        try {
          await api('/calendars/' + button.dataset.calendarSource, {
            method: 'PATCH',
            body: { selected },
          });
          if (generation !== state.generation || state.view !== 'calendar') return;
          await render(false);
          document
            .querySelector(`[data-calendar-source="${button.dataset.calendarSource}"]`)
            ?.focus({ preventScroll: true });
        } catch (error) {
          button.setAttribute('aria-pressed', String(!selected));
          toast(error.message);
        } finally {
          button.disabled = false;
        }
      };
    });
    if (refresh && requestedRange !== range.toString()) {
      requestedRange = range.toString();
      api('/calendars/sync', {
        method: 'POST',
        body: { start: start.toISOString(), end: end.toISOString() },
      }).catch((error) => toast(error.message));
    }
    const signature = JSON.stringify(inventory);
    const pollCalendars = async () => {
      if (generation !== state.generation || state.view !== 'calendar') return;
      try {
        const latest = await api('/calendars');
        if (JSON.stringify(latest) !== signature) {
          await render(false);
          return;
        }
      } catch {}
      calendarPoll = setTimeout(pollCalendars, 3000);
    };
    calendarPoll = setTimeout(pollCalendars, 1000);
    $('#import-calendar').onclick = importCalendar;
    $('#month-today').onclick = () => {
      state.month = new Date();
      render().catch((e) => toast(e.message));
    };
    document.querySelectorAll('[data-event]').forEach((button) => {
      const event = events.find(
        (e) => e.id === Number(button.dataset.event) && e.start === button.dataset.eventStart,
      );
      if (!event) return;
      bindPreview(button, event);
      button.onclick = () => {
        hidePreview();
        window.inkwellEventForm(event);
      };
    });
    if (restoreEventFocus) {
      const selector = focusedEvent.classList.contains('agenda-row')
        ? '.agenda-row[data-event]'
        : '.calendar-event[data-event]';
      Array.from(document.querySelectorAll(selector))
        .find(
          (button) =>
            button.dataset.event === focusedEvent.dataset.event &&
            button.dataset.eventStart === focusedEvent.dataset.eventStart,
        )
        ?.focus({ preventScroll: true });
    }
    document.querySelectorAll('[data-pending]').forEach((button) => {
      const preview = pending.find((p) => p.uid === button.dataset.pending);
      if (preview) bindPreview(button, preview.event);
      button.onclick = () => {
        hidePreview();
        const item = pending.find((p) => p.uid === button.dataset.pending);
        if (!item) return;
        modal(
          'Review meeting from email',
          `<section id="calendar-pending-review"><h3>${esc(item.event.title)}</h3><p>${esc(new Date(item.event.start).toLocaleString())} – ${esc(new Date(item.event.end).toLocaleTimeString())}</p><p class="notice">Suggested from an unverified email. Check the original message and timezone before accepting. These decisions are local to Inkwell; no Outlook RSVP or provider calendar changes are sent. Pending and rejected meetings do not trigger reminders.</p><div class="form-actions"><button type="button" class="primary" data-meeting-decision="accept">Accept locally</button><button type="button" class="secondary" data-meeting-decision="reject">Reject locally</button><button type="button" class="secondary" data-meeting-decision="ignore">Ignore</button></div></section>`,
        );
        document.querySelectorAll('[data-meeting-decision]').forEach((action) => {
          action.onclick = async () => {
            action.disabled = true;
            try {
              await api(`/calendar/pending/${item.message_id}`, {
                method: 'POST',
                body: { uid: item.uid, action: action.dataset.meetingDecision },
              });
              $('#modal').close();
              await render();
              toast('Meeting decision saved locally; no provider RSVP was sent.');
            } catch (error) {
              action.disabled = false;
              toast(error.message);
            }
          };
        });
      };
    });
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
      if (e.button !== 0 || e.target.closest('[data-event], [data-pending]') || rangeMode) return;
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
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (event.provider_calendar_id && event.calendar_can_edit === 0) {
      const first = date(event, 'start');
      const last = date(event, 'end');
      if (event.all_day) last.setDate(last.getDate() - 1);
      modal(
        'Read-only Outlook event',
        `<h3>${esc(event.title)}</h3><p>${esc(event.calendar_name || '')}</p><p>${esc(event.all_day ? first.toLocaleDateString() : first.toLocaleString())} – ${esc(event.all_day ? last.toLocaleDateString() : last.toLocaleString())}</p><p>${esc(event.location || '')}</p><pre>${esc(event.notes || '')}</pre><p class="notice">Times shown in ${esc(zone)}. This calendar is read-only in Outlook. No edit or delete is offered.</p>`,
        { calendar: true },
      );
      return;
    }
    const calendars = state.outlookCalendars || [];
    const destination =
      event.provider_calendar_id ||
      calendars.find((c) => c.can_edit && c.is_default)?.id ||
      calendars.find((c) => c.can_edit)?.id;
    const picker = `<label class="field">Calendar<select name="calendar_id" ${event.provider_calendar_id ? 'disabled' : ''}>${
      calendars
        .filter((c) => c.can_edit || c.id === event.provider_calendar_id)
        .map(
          (c) =>
            `<option value="${c.id}" ${c.id === destination ? 'selected' : ''}>${esc(c.name)} — ${esc(c.account_email)}</option>`,
        )
        .join('') || '<option value="">Default calendar (connect Outlook to synchronize)</option>'
    }</select></label>`;
    const start = event.start || new Date(Date.now() + 3600000).toISOString(),
      end = event.end || new Date(Date.parse(start) + 3600000).toISOString();
    const initialTimes = { start, end };
    const rec =
      typeof event.recurrence === 'string' ? JSON.parse(event.recurrence) : event.recurrence || {};
    const last = new Date(end.slice(0, 10) + 'T00:00:00');
    last.setDate(last.getDate() - 1);
    modal(
      event.id ? 'Edit event' : 'Make a little time',
      `<form id="event-form">${picker}${field('Event title', 'title', event.title || '', 'text', 'required maxlength="200"')}<label class="check-label"><input type="checkbox" name="all_day" ${event.all_day ? 'checked' : ''}> All day</label><div class="field-row">${field('Starts', 'start', event.all_day ? start.slice(0, 10) : wall(start, zone), event.all_day ? 'date' : 'datetime-local', 'required')}${field('Ends', 'end', event.all_day ? key(last) : wall(end, zone), event.all_day ? 'date' : 'datetime-local', 'required')}</div>${field('Event timezone', 'timezone', zone, 'text', 'required maxlength="100"')}<label class="field">Repeat<select name="frequency" aria-label="Repeat">${['none', 'daily', 'weekly', 'monthly', 'yearly'].map((f) => `<option value="${f}" ${f === (rec.frequency || 'none') ? 'selected' : ''}>${f === 'none' ? 'Does not repeat' : f}</option>`).join('')}</select></label><div class="field-row">${field('Repeat every (interval)', 'interval', rec.interval || 1, 'number', 'required min="1" max="365"')}${field('Maximum occurrences', 'count', rec.count || 10, 'number', 'required min="1" max="1000"')}</div>${field('Stop repeating after (optional)', 'until', rec.until || '', 'date')}<fieldset class="repeat-weekdays"><legend>Weekly repeat days (optional)</legend>${['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].map((d) => `<label><input name="weekdays" type="checkbox" value="${d}" ${rec.weekdays?.includes(d) ? 'checked' : ''}>${d}</label>`).join('')}</fieldset>${field('Location or meeting link', 'location', event.location || '', 'text', 'maxlength="500"')}${textarea('Notes', 'notes', event.notes || '', 'maxlength="10000"')}<div class="notice">All-day end dates are inclusive here. Repeats stop at the count or optional date, whichever comes first. Monthly repeats skip months without that date. ${event.provider_event_id ? 'This downloaded Outlook entry is an occurrence; edits and deletion apply to this occurrence. Updating a meeting can notify its attendees in Outlook.' : 'Editing or deleting a repeating entry changes its series. No attendees are added by Inkwell.'}</div><div class="form-actions">${event.id ? '<button type="button" class="secondary danger" id="delete-event">Delete event</button>' : ''}<button class="primary" type="submit">Save event</button></div></form>`,
      { calendar: true },
    );
    const form = $('#event-form');
    if (event.provider_event_id) form.elements.frequency.disabled = true;
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
          const convert = (part) => {
            const value = data.get(part),
              targetZone = data.get('timezone');
            // An unchanged repeated fall-back hour must keep its original UTC offset.
            if (!event.all_day && targetZone === zone && value === wall(initialTimes[part], zone))
              return new Date(initialTimes[part]).toISOString();
            return instant(value, targetZone);
          };
          start = convert('start');
          end = convert('end');
        }
        await api('/events' + (event.id ? '/' + event.id : ''), {
          method: event.id ? 'PUT' : 'POST',
          body: {
            calendar_id: event.provider_calendar_id || Number(data.get('calendar_id')) || null,
            title: data.get('title'),
            start,
            end,
            all_day,
            timezone: data.get('timezone'),
            location: data.get('location'),
            notes: data.get('notes'),
            recurrence: {
              frequency: data.get('frequency') || 'none',
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
  window.addEventListener('InkwellBackendReady', () => {
    requestedRange = '';
    if (state.view === 'calendar') render().catch((error) => toast(error.message));
  });
  return { render, form };
};
