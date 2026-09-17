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

## Optional Omarchy Super+I launch shortcut

In the installed native app, open **Settings → Shortcuts → Omarchy launch shortcut → Enable Super+I**. This opt-in setting launches Inkwell when closed or focuses an existing Inkwell window through Omarchy. It is **off by default** and applies only to this computer, not other clients of the workspace. It does not set the default email application or enable autostart.

An active Omarchy/Hyprland Lua session, the installed launcher, and a regular UTF-8 `~/.config/hypr/bindings.lua` are required. The app checks live bindings and refuses conflicts, backs up that file beside the original, then adds a marked fixed binding block. It uses `hl.unbind` before its own binding, reloads Hyprland and checks configuration errors. A failed change restores the previous contents when the file has not been concurrently edited; otherwise it keeps external changes and reports the backup location. Package-owned Omarchy files are never modified. Edited managed blocks require manual review rather than forced replacement.

**Disable Super+I** removes only Inkwell's unchanged marked block and reloads the existing configuration. Disable it before uninstalling; personal Hyprland configuration is not removed with the application. Resetting in-app shortcut defaults does not change this OS setting. The renderer has only fixed status/enable/disable capabilities, restricted to the trusted main app document—not arbitrary command or file-write access.

## Date grouping

In the mailbox's **Quick filter** controls, turn on **Group by date**. This is a persistent workspace display preference, independent of filter pinning. It stays enabled across built-in, server and local folders, search results, collections, and reloads; cards and table views both support it.

Groups are disjoint, using the viewer's local calendar:

- **Today:** the current calendar day.
- **This Week:** earlier days of the current Monday-start week, including days in the previous month if the week crosses a month boundary.
- **This Month:** remaining days in the current month, excluding Today and This Week.
- **Older:** dates before those periods.

Empty sections are omitted. Future-dated and malformed/missing dates use separate **Future** and **Unknown date** labels rather than misleadingly appearing under Today or Older. Naive cached timestamps are interpreted as UTC, matching backend sorting.

Grouped results use date sorting across pagination; the ascending/descending control still works. Your previous non-date sort choice is retained and restored when grouping is disabled. Headers cover the current result page, not unloaded mail or aggregate folder counts. Day/timezone changes refresh the headings without replacing the reader; suspended clients refresh on return. Toggling grouping preserves the open reader and its per-view permissions. No message records or server state change.

## Date search

Optional **From** and **To** fields sit beside search. Either bound can be used alone; each has its own × clear button. Bounds are inclusive calendar days in the browser's local IANA time zone, including daylight-saving transitions. Filtering compares timestamps at microsecond precision. Invalid/reversed ranges leave the previous applied filter unchanged.

Text/tag search, folder scopes and collections combine with date bounds before pagination. Date-only searches work without a two-character text query. Clearing dates retains text search and the chosen date-search scope. List/search changes retain the open reader, its position and per-view permissions, even if it is no longer in the result list. Existing reader highlights remain part of that retained view; reopening a message uses the current query.

## Local flags

Use the row's flag button, or **More → Mark → Flag message / Unflag message**. Flags persist locally and tint the entire card/table row soft red, with a stronger selected tint and an explicit flag indicator. The reader also shows a Flagged label.

Flags are independent of stars, tags and read state. They are not Outlook follow-up flags, do not create reminders, and never modify the server. Schema 14 adds a default-off `flagged` column without altering existing stars or provider identities.
