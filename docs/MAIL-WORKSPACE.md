# Mail workspace: activity, folders, search and message menus

## Activity strip

A thin, light, indeterminate strip runs across the top of the mail list while this client has API work in progress, including startup import, folder discovery and folder import. Concurrent requests are counted: one finishing does not hide another's activity. Errors also release the indicator. Reduced-motion settings use a static strip rather than animation. It is not a percentage estimate or a monitor of other clients' background jobs.

## Outlook server folder tree

Connected Microsoft accounts appear underneath the main Inbox navigation button, with their server folder hierarchy nested under each account. Parent branches can be collapsed; select a folder's button to view it. On phones, use **Open navigation** to access the tree. Names are rendered as text, including names containing markup characters.

Startup and manual Inbox **Sync** discover the visible Graph mail folder hierarchy, including folders nested inside Inbox. The app follows paginated child lists and preserves its previous snapshot if discovery fails. Discovery is limited to 500 requests per account. Counts in the tree are server counts, not downloaded-message counts.

Opening a server folder imports up to its newest **200 messages** and displays them in Inkwell. Opening it again or pressing **Sync** in that folder refreshes its cache. The full mailbox is not downloaded at once. Server drafts and sent folders are viewable as imported mail, not editable server drafts. Generic IMAP folder discovery is not implemented yet; the current tree implementation is for Microsoft Graph.

Schema version 3 adds stable local folder IDs and message membership. Renaming a discovered server folder preserves its local ID. Missing folders are removed from navigation only after complete discovery; cached messages are not deleted. An older executable cannot reopen a version-3 workspace—retain a pre-upgrade backup if downgrading.

## Top-centre search

Use the top search field: after at least two trimmed characters, results update 280 ms after typing stops. Enter or the search button also works. Clearing restores messages in the selected scope and resets pagination/unread filtering. Choose a scope:

- **Current folder:** the folder being viewed.
- **Folder + subfolders:** that server folder and its descendants. On the aggregate Inbox, includes connected accounts' Inbox descendants.
- **All folders:** downloaded mail across accounts, including local Trash and drafts.

Search matches sender, subject, plain-text body and local tags, with pagination. Cross-folder results carry folder labels. Search does **not** search older messages still only on the server. Open/sync folders first to populate their caches. Changing folders resets the search scope to Current folder. From a non-mail page, search starts from the aggregate Inbox. The duplicate in-list search field has been removed. Local-only folders do not have server descendants.

## Expanded message context menu

Right-click a message, press Shift+F10/Context Menu, or use its **⋯** button. The reader has the same menu. Keyboard arrows/Home/End navigate it; Escape returns focus. Long menus scroll on small screens.

Available actions:

- Find all by sender, organisation or subject.
- Open message / edit local draft.
- Reply, Forward, or New message to sender (opens a compose form; never sends automatically).
- Mark read/unread and Star/Remove star, locally.
- Move local copy to Inbox, Archive or Trash; Archive local copy; Trash local copy.
- Permanently delete a local copy from Trash or local Drafts immediately, without a confirmation prompt.
- Restore from Trash to the remembered previous local folder (Inbox fallback for older copies or missing destinations).
- Select multiple messages and drag to a local/server-tree folder, or use the selection toolbar's Move control. Filing changes local views only, never the provider's folders.
- Add sender to People (opens an editable contact form).
- Copy sender address (selectable text dialog, usable without clipboard permissions).
- Save message as plain text (not original MIME/EML and not attachments).
- Edit local tags (also available as Tags… in the reader). Up to 12 tags, 32 characters each; duplicates are merged case-insensitively. Type comma-separated names, choose a known name or click an existing tag button. Clear the field to remove all. Tags appear as pills in the list and reader header; unread items have a separate Unread pill. Tags are local, not provider categories, and survive re-imports/local moves.

HTML preview is now the default, with a privacy banner and explicit per-view image choices. See [HTML preview security and limits](HTML-PREVIEW.md). Pane widths are adjustable in side-by-side layouts; see [Appearance](APPEARANCE.md).

**Settings → Mail rules** adds automatic local filing by sender/domain, optional unread and age exclusions, and custom local folders. See [Rules and calendar](RULES-CALENDAR.md).

These are working actions, **not full Outlook menu parity**. Reply all/CC/BCC, categories, reminders, junk/block rules, original-source viewing, printing, attachment handling, and server folder creation/rename/move/delete remain unimplemented.

## Tags and quick filters

Tag Manager sits above Settings and supports reusable colored tags, usage counts, rename, bulk merge/delete, and exact tagged-mail browsing. The message toolbar adds combined quick filters, sorting, cards/table views and pinned filters. Filtering runs before pagination. See [Tags and filters](TAGS-FILTERS.md).

## Server preservation

There is no POP3 transport. IMAP reads Inbox with read-only selection and BODY.PEEK. Microsoft discovery/import uses GET requests. Context-menu message management changes SQLite copies only: it does not move, expunge or delete server messages. Sync does not restore a locally trashed/archived copy to its former local position. Imported read/star state is initially copied from the server; later local changes are not pushed back. Sending is an explicit click on Send message, without a second prompt, using SMTP or Graph, with Graph retaining Microsoft's Sent Items copy.
