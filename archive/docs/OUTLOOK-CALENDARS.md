# Outlook calendars

Inkwell now discovers calendars instead of only sending writes to the default
Outlook calendar. It enumerates `/me/calendars` plus every calendar group's
`calendars` collection, follows validated Microsoft Graph pagination and deduplicates
by account and immutable provider ID. Read-only calendars remain visible and are
labelled rather than being omitted.

All available calendars appear as **pill toggle buttons beside the month heading**.
Highlighted pills are included in the grid and agenda; muted pills are excluded.
Each toggle saves its visibility preference, supports keyboard activation and exposes
its state with `aria-pressed`. Account and read-only information is available in
tooltips. On mobile the pill row scrolls horizontally without widening the page.
Visibility does not delete or unsubscribe a calendar. Failed preference saves restore
the prior pill state. **Sync calendars** retries the current range; **Calendar status**
shows connection details, read-only sources and any synchronization errors.

## Incoming synchronization

A separate cancellable worker starts with the backend and checks every five
minutes. The initial range covers approximately the next year plus the preceding
month. Opening or navigating Calendar requests the displayed six-week range, which
then becomes the periodic refresh range. Other dates download when visited.
CalendarView supplies expanded recurring occurrences and exceptions. All-day dates
use their original IANA/Windows timezone; padded Graph requests cover boundary dates
in distant timezones. Event IDs use the same immutable-ID preference as writes.

Schema 20 adds calendar metadata and event source links. Cached provider updates
and deletions apply transactionally with write triggers suppressed, so a download
cannot echo duplicate creates, edits or deletes back to Outlook. Only fully fetched,
valid calendar snapshots can prune linked records in the requested range. Failed
pages retain cached events. Pending/failed local edits and deletions are protected
from stale downloads. Account identity and calendar identity are rechecked before
committing an in-flight response; disconnect cancels future work and preserves
cached copies as unlinked entries.

The six unlinked entries observed on the user's machine were not adopted or
uploaded by discovery. Older local entries remain intact. Editing one and selecting
an Outlook destination is an explicit create on that calendar.

## Outgoing changes

New events choose an editable Outlook calendar. Edits and deletions of downloaded
events retain the source calendar and use the durable provider queue. Cross-calendar
moves are rejected instead of being silently redirected. Read-only sources and
missing write consent are rejected before a cached mutation. Unchanged notes are
not included in update requests, preserving Outlook's existing body formatting.
Meeting updates may cause Outlook to notify attendees.

Downloaded repeating entries are editable occurrences, not a reconstructed series
editor. Locally created series retain their pending representation until their
writes complete, then are represented by Graph's expanded occurrences without
double-displaying the master. Import UID markers remain intact. Historical local
recurrence editing continues to use the existing recurrence engine.

## Event Details And Local Times

Timed month-grid entries show their local start time before the title (for example,
`11:30 Meeting`); date-only entries show All day instead of a fabricated midnight.
Hovering or keyboard-focusing an event opens a custom, escaped details card with
its source calendar, dates, local time range, timezone, location and notes. The card
stays within the viewport at application zoom levels, supports Escape and remains
hoverable without opening the editor.

Editors default to the computer/browser's local IANA timezone even when Outlook
stores the event in UTC. Saving unchanged fields preserves their original instants,
including the repeated hour at the fall DST transition. All-day dates remain dates,
not timezone-shifted midnights.

In inline mode the calendar and page remain viewport-constrained while only the
right details panel scrolls. Wide views use two columns; narrower views overlay the
right panel without hiding or replacing the calendar. The calendar retains all six
weeks without its own scrolling in this mode, and resizing preserves unsaved edits.
Read-only events use the same bounded panel with local-time details.

## Verification

Python regression coverage includes five calendars across three groups, pagination,
deduplication, zero download echo jobs, visibility, read-only boundaries, correct
write destinations, pending edits/deletes, offline/malformed responses, timezone
boundaries, schema idempotence, cancellation, account identity reuse and series
master reconciliation. Browser tests cover the chooser and event forms on desktop
and mobile; existing calendar/import/layout and desktop recovery suites also run.

A read-only live check on 2026-10-19 confirmed five calendars (two editable, three
read-only), with successful CalendarView responses for all five. An isolated,
private temporary cache downloaded their events with zero outgoing jobs and no
sync errors; it was deleted afterward. No Outlook events were created, edited or
deleted during those checks.
