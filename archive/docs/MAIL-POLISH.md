# Drafts, reader and local filing

## Immediate actions

There are no confirmation prompts in the application. Send message submits immediately; deleting a draft or permanently deleting a Trash copy cannot be undone locally. Removing a rule/contact/event and applying rules also happen immediately. Closing other unsaved forms discards their changes. Choosing remote images in the reader's options explicitly opts in for that view; the inline warning remains, but there is no second prompt. Images remain blocked initially.

## Automatic local drafts

Compose, reply and forward save after 350 ms of inactivity, on window blur, and before leaving the editor. Close, Escape, clicking outside a desktop popup, clicking elsewhere in an internal editor, and native desktop window close await the save. Reopen a message in Drafts to continue. Save draft and Delete draft remain available. An untouched blank composer does not create an empty draft.

Autosaves update one stable draft ID. A unique creation key prevents duplicate drafts when retrying an initial request, and revision checks reject stale overwrites from another editor. Partial recipient addresses are allowed in drafts; sending still validates the address and account. Sending consumes the matching saved revision; a concurrently modified draft is preserved. Known already-consumed draft IDs cannot be sent again. Provider-side delivery uncertainty still requires checking the provider's Sent folder before retrying.

Save failures keep the editor and its text open with an error rather than silently discarding it. Concurrent-edit conflicts require resolving the other editor/reopening or copying the current text before proceeding. Autosave is not a guarantee against power loss, force-killing the application, or storage failure. Browser/PWA page closure uses a best-effort keepalive request (subject to browser size limits); unlike the desktop close hook, browser termination cannot await it. Pause until the saved status appears before closing a browser tab with a large message.

Disconnecting an account now removes its credentials and folder metadata while retaining local mail and drafts. Previously downloaded copies remain unlinked; reconnecting may import additional copies.

## Reader

HTML and text previews default to the applied theme. Sanitized HTML overrides sender foreground/background colors, including inline `!important` colors, for readable theme colors. The reader toolbar's Light view / Dark view toggle affects this message view only. Opening another message defaults to the theme again. Toggling rebuilds the frame and blocks remote images again. Actual image pixels are not recolored. The delete control uses a bin icon and labels distinguish Trash from permanent local deletion.

## Select, move and restore

Use checkboxes, Select all visible messages, Ctrl/Command-click, or Shift-click ranges. Desktop rows are draggable. Drop onto Inbox, Archive, Trash, a custom local folder, or a Microsoft server-tree folder. On phones or with a keyboard, use the selection toolbar's destination and Move button instead. Selection is limited to the visible page, not every message in the mailbox. Drafts can be batch-moved only to Trash.

**All filing is local.** Moving into a server-tree branch changes where the cached copy appears, not where Outlook stores it. Original provider identity/account/membership are retained separately from the local destination. Import-time refresh does not undo a local move. Server-reported sidebar counts are not changed by local filing; tooltips still identify them as server counts. Account/email explanatory headers have been removed from the visible tree.

Trash remembers the previous folder and local tree destination. Restore is available in the reader, context menu, and selection toolbar. If the previous destination disappeared, or a pre-upgrade Trash copy has no recorded origin, Restore falls back to Inbox. Deleted server-tree destinations return affected local filing to Inbox rather than hiding the cached messages. Permanent deletion remains restricted to local Trash/Drafts and never contacts a provider.

Context menus size to their labels without wrapping. Very long custom names or heavily zoomed/narrow screens can scroll horizontally rather than losing text.

## Storage upgrade

Schema 6 adds draft identity/revision and local destination/restore metadata. Installation preserves the workspace; migration occurs when the new backend starts. Older binaries cannot open schema 6. Rollback requires a consistent pre-upgrade database plus matching vault key, not just an older executable.
