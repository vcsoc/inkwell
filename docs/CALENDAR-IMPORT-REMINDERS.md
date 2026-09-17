# Meeting invitations, ICS import and native reminders

## Add events

- **Calendar → Import .ics**: choose a file, review its titles/times, then **Add to local calendar**. The calendar displays the first imported event's month.
- On an Outlook message, choose **More actions → Add meeting invitation…** in its context/reader menu. Inkwell reads the original message's MIME using Microsoft Graph **GET**, extracts `text/calendar` / `.ics` parts, and opens the same review form. Forwarded invitations with calendar MIME parts also work.
- Save an ICS file using the reader's [attachment panel](ATTACHMENTS.md) or your provider, then import it from Calendar or the file manager.
- **Linux file manager → Open with → Inkwell**: the installer registers calendar MIME support and passes selected `.ics` files to the native import review, both on startup and in an already-running app. Review and explicitly add the events; a successful file-manager import opens Calendar at the imported month. Up to 10 files queue for separate review. Existing open forms/drafts are not replaced: finish or close the form first. No existing default application is changed automatically. Fully quit/reopen Inkwell after upgrading, and reopen the file manager's Open with dialog if its list was already open.

The native file capability accepts only explicitly supplied local ICS paths or local file URLs, reads regular files with a 2 MB bound, and never executes them or follows remote calendar URLs. Only the trusted main app document can retrieve queued contents; renderer code cannot request arbitrary filesystem paths. The command-line equivalent is `inkwell --open-calendar /path/to/meeting.ics`.

Imports are local only: no RSVP, acceptance, decline, meeting response, provider calendar synchronization or provider mail mutation occurs. Original messages and files remain unchanged. Opening the review does not create events. Import commits the entire selected batch atomically.

Files are limited to 2 MB and 100 events; Outlook MIME retrieval is capped at 8 MB. UID deduplication skips previously imported invitations instead of overwriting locally edited events. Updates and cancellations must be reviewed/applied manually. Deleting the local event clears its import marker so an explicit later reimport is possible.

UTC, installed IANA zones and recognized Windows zone names are supported. Floating times use the browser's local IANA timezone, shown in the review. All-day end dates are exclusive. Timed events without DTEND or DURATION default to one hour; review the displayed start/end before importing. Standard daily, weekly (including weekday selections), monthly and yearly repeats use the existing bounded recurrence model, capped at 1,000 occurrences. Recurrence exceptions, custom recurrence patterns and unknown custom timezones fail explicitly rather than silently importing incorrect events. Embedded VTIMEZONE programs are not evaluated; known zones use the installed timezone database.

Embedded alarms, URLs, attachments and organizer/attendee commands are not executed. Import does not follow calendar URLs or grant an external sender any notification privileges until you explicitly add the event.

## OS reminders

The **native desktop application** checks local timed events every 15 seconds, regardless of which page is open. Reminders become eligible 15 minutes 30 seconds before the start, providing a small early margin around the requested 15-minute lead time. Notifications show the event title, time and location. Clicking one brings Inkwell forward without navigating away from an open draft.

Each occurrence is acknowledged in the local database only after Electron emits its native notification `show` event. Successful acknowledgements survive restarts. Failed OS submissions can retry; temporary acknowledgement failures retry without showing the same toast again in that app session. Editing an event's start produces a different occurrence; changing only its title does not repeat a delivered reminder. Deleting an event clears its reminder markers.

**Keep Inkwell open; minimized works.** There is no autostart, background service after quitting, wake-from-sleep mechanism, web/PWA reminder implementation or mobile push delivery. OS notification permissions/Do Not Disturb may suppress alerts. A late start or resume can produce a late reminder for a still-upcoming event, but past meetings are not replayed. An exact 15-minute advance alert cannot be guaranteed during sleep, shutdown, connectivity/backend failures or OS suppression. All-day events currently have no timed reminder. Imported VALARM schedules are ignored; Inkwell uses its own 15-minute rule.

Notifications can expose event titles/locations on the desktop or lock screen, subject to OS settings. The scheduler runs in Electron's main process, reads only fixed authenticated local API endpoints, and adds no renderer IPC or email-frame privileges. Notification text is not executable code.

## Validation

Tests cover import review/commit, duplicate prevention and deletion/reimport, atomic rejection, all-day dates, Windows/IANA zones and DST, read-only Outlook MIME retrieval, unsupported patterns, reminder eligibility and acknowledgement, native authenticated polling, notification failure/retry and browser/mobile layouts. Native integration tests substitute the OS display call; a separate explicitly labelled notification probe verified an OS `show` event on the development machine without creating an event or sending mail.
