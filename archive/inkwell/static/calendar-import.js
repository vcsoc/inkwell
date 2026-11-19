'use strict';
window.InkwellCalendarImport = ({ api, modal, esc, toast, refresh }) => {
  const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  let importing = false;
  const open = (messageId = null, nativeFile = null) => {
    modal(
      'Import meeting / calendar',
      `<section id="calendar-import"><p class="notice">Adds local events only: no RSVP or Outlook calendar changes. Existing invitation UIDs are skipped, not overwritten. Repeating imports are limited to 1,000 occurrences; exceptions and cancellations need manual handling. A timed event without an end time uses one hour; review the dates below.</p>${nativeFile ? '<p>File: <strong>' + esc(nativeFile.filename) + '</strong></p>' : messageId ? '' : '<label class="field">Calendar file (.ics)<input id="calendar-file" type="file" accept=".ics,text/calendar"></label>'}<p>Times without a timezone use ${esc(zone())}.</p><div id="calendar-import-preview"></div><p id="calendar-import-status" role="status"></p><button type="button" class="primary" id="calendar-import-save" disabled>Add to local calendar</button><p class="fine-print">Desktop reminders for timed events run about 15 minutes before the meeting. Keep Inkwell open (minimized is fine). Sleep, a closed app, or OS notification settings can delay or suppress alerts. All-day events have no timed alert.</p></section>`,
    );
    const root = document.querySelector('#calendar-import'),
      status = root.querySelector('#calendar-import-status'),
      button = root.querySelector('#calendar-import-save');
    let entries = [],
      generation = 0;
    const current = () => root.isConnected && document.querySelector('#modal').open;
    const load = async (work) => {
      const revision = ++generation;
      entries = [];
      button.disabled = true;
      status.textContent = 'Reading invitation…';
      root.querySelector('#calendar-import-preview').replaceChildren();
      try {
        const result = await work();
        if (!current() || revision !== generation) return;
        entries = result.entries;
        root.querySelector('#calendar-import-preview').innerHTML =
          `<ul>${entries.map(({ event: e }) => `<li><strong>${esc(e.title)}</strong> · ${esc(e.all_day ? e.start.slice(0, 10) + ' – ' + e.end.slice(0, 10) + ' (all day; end exclusive)' : new Date(e.start).toLocaleString() + ' – ' + new Date(e.end).toLocaleString())}${e.location ? ' · ' + esc(e.location) : ''}${e.recurrence.frequency !== 'none' ? ' · Repeating' : ''}</li>`).join('')}</ul>`;
        status.textContent = `${entries.length} event(s) ready to import.`;
        button.disabled = !entries.length;
      } catch (error) {
        if (current() && revision === generation) status.textContent = error.message;
      }
    };
    if (nativeFile)
      void load(() =>
        api('/calendar/import/preview', {
          method: 'POST',
          body: { content: nativeFile.content, timezone: zone() },
        }),
      );
    else if (messageId)
      void load(() =>
        api(`/messages/${messageId}/calendar-invites?timezone=${encodeURIComponent(zone())}`),
      );
    else
      root.querySelector('#calendar-file').onchange = (event) => {
        const file = event.target.files[0];
        void load(async () => {
          if (!file) throw Error('Choose an .ics file.');
          if (file.size > 2000000) throw Error('Choose an .ics file under 2 MB.');
          return api('/calendar/import/preview', {
            method: 'POST',
            body: { content: await file.text(), timezone: zone() },
          });
        });
      };
    button.onclick = async () => {
      button.disabled = true;
      root.inert = true;
      importing = true;
      try {
        const result = await api('/calendar/import', { method: 'POST', body: { entries } });
        if (!current()) return;
        document.querySelector('#modal').close();
        toast(`${result.added} calendar event(s) added; ${result.skipped} already imported.`);
        await refresh(entries[0]?.event, { openCalendar: !!nativeFile });
      } catch (error) {
        if (current()) {
          status.textContent = error.message;
          button.disabled = false;
        }
      } finally {
        root.inert = false;
        importing = false;
      }
    };
  };
  return {
    file: () => open(),
    message: open,
    native: (file) => open(null, file),
    get busy() {
      return importing;
    },
  };
};
