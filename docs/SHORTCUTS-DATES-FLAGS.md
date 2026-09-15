# Keyboard and mailbox controls

## Shortcuts

Open **Settings → Shortcuts**. Focus a binding field and press the desired combination, then **Save shortcuts**. Clear a binding with × to disable it, or **Reset defaults** to restore and save the defaults. Duplicate, unsupported and reserved editing/browser shortcuts are rejected. Settings contain only validated key names, never executable macros.

| Default | Action |
| --- | --- |
| F9 | Check server mail |
| C | Compose a message |
| / | Focus search |
| Delete | Delete the selected **local** copies |
| Ctrl+Shift+K | Open quick filter |
| ↑ / ↓ | Navigate up/down; previous/next message in the mail list |
| ← / → | Navigate panes or collapse/expand a folder branch |
| Ctrl+= / Ctrl+- / Ctrl+0 | Zoom in/out/reset |

Ctrl also accepts Command on macOS. Typing, date pickers, menus and editors retain normal key behavior. Plain arrows in the sandboxed HTML reader scroll its content. Function/modifier shortcuts for sync and zoom also work while typing. Delete does not act on typed text or server mail. Native shortcut forwarding remains restricted to trusted application code; the reader gains no scripts or preload privileges. Operating-system/browser bindings may take precedence.

Sidebar arrows move focus; **Enter** opens a focused folder. Left/right collapse/expand branches, and Right enters an expanded branch. In the mail list, up/down open adjacent messages; Left focuses navigation and Right focuses the reader. Tab remains available throughout the interface. Double-click a folder name with children to toggle its branch. Disclosure controls and keyboard alternatives remain available for touch/accessibility. Routine count refreshes no longer rebuild unchanged navigation nodes.

The redundant **+ New Message** button under the logo is removed. The top-right **Compose** button and configurable compose shortcut remain.

## Date search

Optional **From** and **To** fields sit beside search. Either bound can be used alone; each has its own × clear button. Bounds are inclusive calendar days in the browser's local IANA time zone, including daylight-saving transitions. Filtering compares timestamps at microsecond precision. Invalid/reversed ranges leave the previous applied filter unchanged.

Text/tag search, folder scopes and collections combine with date bounds before pagination. Date-only searches work without a two-character text query. Clearing dates retains text search and the chosen date-search scope. List/search changes retain the open reader, its position and per-view permissions, even if it is no longer in the result list. Existing reader highlights remain part of that retained view; reopening a message uses the current query.

## Local flags

Use the row's flag button, or **More → Mark → Flag message / Unflag message**. Flags persist locally and tint the entire card/table row soft red, with a stronger selected tint and an explicit flag indicator. The reader also shows a Flagged label.

Flags are independent of stars, tags and read state. They are not Outlook follow-up flags, do not create reminders, and never modify the server. Schema 14 adds a default-off `flagged` column without altering existing stars or provider identities.
