# Mail workspace: activity, folders, search and message menus

## Quiet logo activity

A faint, slow shimmer passes across the Inkwell logo during API work or active background mail syncing, instead of a progress bar across the mail pane. Concurrent requests are counted: one finishing does not hide another's activity. Errors also release the request indicator; active sync keeps the logo indication running between polls. The logo stays still while idle. Reduced-motion settings use a subtle static tint instead of movement. The accessible activity indicator and detailed sync status remain available. This is an activity cue, not a percentage estimate or a promise of immediate delivery.

## Outlook server folder tree

The sidebar keeps Inbox, Starred, Sent, Drafts, Archive, Trash and local folders together without an extra local-mail heading or server-count caption. Classic layout also has Rule Manager and Tag Manager icons above Settings in the far-left Apps rail. Connected Microsoft accounts appear separately below, in collapsible **Outlook** groups. Multiple accounts get numbered groups; hover the group heading for its address without bringing back a visible account banner. Parent branches can also be collapsed; select a folder's button to view it. On phones, use **Open navigation**. Names are rendered as text, including names containing markup characters.

The main **Inbox** is the aggregate local workspace view across accounts, including locally refiled Inbox copies. **Outlook → Inbox** is the account's discovered server folder view. These are different views, not a second Inbox created on the server. The main **Drafts** contains editable, autosaved inkwell drafts; **Outlook → Drafts** contains downloaded server-draft snapshots, not those local editors. All visible unread badges describe cached mail. Hover a server folder for separate server totals/unread counts. The upper **Archive** and **Sent** aggregate local copies and the corresponding provider folders across accounts, using provider-resolved identities rather than English folder names. Local Trash and editable Drafts intentionally stay separate from server Deleted Items and Drafts. The logo remains outside the scrolling navigation; horizontal scrolling appears only for genuinely overflowing navigation content.

Startup and manual Inbox **Sync** discover the visible Graph mail folder hierarchy, including folders nested inside Inbox. The app follows paginated child lists and preserves its previous snapshot if discovery fails. Discovery is limited to 500 requests per account. Server counts are retained in folder tooltips; visible badges use the same local membership and read flags as message lists.

An initial quick pull imports up to **200 messages**. A shared worker then visits every discovered Outlook folder/subfolder round-robin, persisting Graph next-page/delta checkpoints. Historical downloads have no total message cap and resume across jobs and restarts. Automatic checks run about every **15 seconds** while open, with quick new-mail checks during unfinished backfills. F9 requests a fresh pull and rescan without restarting unfinished history. Polling, bandwidth, throttling and large backfills mean delivery cannot be guaranteed instant. Server folder totals can include non-mail items and are not proof of missing messages. Server Drafts/Sent remain imported snapshots; attachments are not downloaded. Generic IMAP remains Inbox-only. See [background sync](BACKGROUND-SYNC.md) for exact timing, preservation, retries and shutdown behavior.

For inclusive From/To dates, local flags, double-click folder expansion and configurable keyboard navigation, see [Keyboard and mailbox controls](SHORTCUTS-DATES-FLAGS.md).

Schema version 3 adds stable local folder IDs and message membership. Renaming a discovered server folder preserves its local ID. Missing folders are removed from navigation only after complete discovery; cached messages are not deleted. An older executable cannot reopen a version-3 workspace—retain a pre-upgrade backup if downgrading.

## New-mail sound

Open **Settings → Notifications** to enable new-mail audio, choose **all new mail**, **pinned folders only**, or **selected senders only**, and select a custom WAV/MP3 (under 2 MB), preview it, or restore Inkwell's included short chime. The chime is an original audio file in `inkwell/static/new-mail.wav` and can be regenerated using `python scripts/generate-new-mail-sound.py`. Audio is **off by default**. The bell in the Classic app rail (or top bar in other layouts) is a quick toggle; right-click, use Shift+F10, or long-press for the same scope and sound options. In the sender mode, turn on a sender's small bell beside their name in the message list; the exact email address is remembered across this workspace. Files are saved only on this backend machine, not sent to a mail provider. The active tab plays once per completed sync collection with matching newly imported incoming mail (not once per message); existing cached messages, drafts/sent copies and old historical backfills do not ring. Browser audio autoplay policies may require you to interact with the app first. This is not a system notification, and nothing sounds while the app is closed.

## Pinned folders

Right-click a built-in, local or server folder (or use Shift+F10 / touch-and-hold), then choose **Pin folder**. A **Pinned** group above Inbox shows a shortcut with the folder's name, full path and cached message count. Choose **Unpin folder** from the shortcut or original folder to remove it. Pins are saved in this workspace and never move messages or change the provider. Selecting a folder displays an open-folder icon; other folders use a closed-folder icon. Hierarchical indentation reflects actual parent folders; local branches use the same level spacing as their siblings.

## Create local subfolders

Right-click Inbox, Archive, Sent, Drafts, Trash, a local folder or a displayed server folder and choose **New subfolder…**. Enter a name and click **Create subfolder**. Keyboard users can use Shift+F10/Context Menu; on touch screens, hold a folder. Escape dismisses the menu and restores focus. The name form can be closed without creating anything.

Subfolders are **local to inkwell**, even beneath an Outlook folder. No provider folders or messages are created, moved or deleted. The parent is a navigation relationship, not an inherited Sent/Drafts role. New folders appear beneath their parent with collapsible branches and work as local Move/rule destinations. Paths distinguish equal names under different parents; duplicate names within the same parent are rejected. Nesting is limited to 32 local levels. A folder with children cannot be deleted. If a server parent disappears or its account is disconnected, retained local children appear at the root instead of being deleted.

Schema **11** preserves existing folder IDs, names, messages, rules and the folder ID high-water mark while adding parent relationships. Downgrading requires a compatible database/vault-key backup. Creating folders neither files existing mail nor applies rules.

## Move and reorder local folders

Drag a **local folder** by its name. Hover near the top or bottom of another local folder for **Place before / Place after**; hover over its middle to **Move inside**. A themed placement marker and inside-target outline preview the result before releasing. Dropping into a folder appends the moved branch after its existing local children. Hovering over a collapsed destination opens it after a short delay. Drop on the outlined top-level drop zone (shown only during folder dragging) to move a branch back to the root.

Nothing is committed until a valid drop. Escape or dropping outside a valid destination cancels. A folder cannot go inside itself or its descendants, exceed 32 local levels, or collide with a sibling name. The backend revalidates under a transaction; failures leave the hierarchy unchanged.

For keyboard/touch use, right-click or hold a local folder and choose **Move folder…**. Choose Inside, Before or After and a target; the form shows a placement preview. **Move folder** applies immediately without confirmation.

The entire local branch moves, preserving folder IDs, mail contents, message membership, rule references and child order. Ordering persists across restarts; new folders append to their siblings. Missing-parent branches shown at the root can be reordered with other root folders. Built-in folders and the discovered Outlook hierarchy remain fixed; they accept local children but cannot themselves be dragged or reordered. This is not provider folder management and does not move server mail. Mail-message dragging continues to file messages, separately from folder dragging.

Schema **12** adds persistent folder positions and preserves the former alphabetical order on upgrade. Rollback requires a compatible pre-upgrade database and vault key.

## Top-centre search

Use the top search field: after at least two trimmed characters, results update 280 ms after typing stops. Enter or the search button also works. Search defaults to **All folders**, including cached Junk and tagged messages outside Inbox. Clearing restores the folder being browsed and resets pagination/quick filters. The scope selector controls searches, not ordinary empty-query folder browsing. Choose a scope:

- **Current folder:** the folder being viewed.
- **Folder + subfolders:** the selected folder and its local descendants, plus server descendants where applicable. On aggregate Inbox/Archive/Sent, includes the corresponding provider-folder descendants across accounts and their attached local folders.
- **All folders (default):** downloaded mail across accounts, including Junk, Archive, Sent, local Trash and drafts.

Search matches sender, To/Cc/Bcc addresses, subject, plain-text body and local tag names, with filtering before pagination. Plain tag names work; `tag:Work` searches only tag names (substring), `tag:"Follow up"` matches an exact normalized tag name, and `#Work` matches the tag Work or #Work exactly as well as literal #Work in message text. `tags:` is an alias for `tag:`. These are single tag expressions, not a combined query language; use the exact-tag quick filter alongside a plain text query to combine a tag and message terms. Tag matching is Unicode-normalized and case-insensitive. `%`, `_` and backslashes are literal search characters, not SQL wildcards. Cross-folder results carry folder labels. Search does **not** search older messages still only on the server. Background backfill populates those caches; search coverage grows as the download progresses. Search words are visibly highlighted in result rows, reader headers, and HTML/text previews. Highlighting only changes displayed text (up to 20 literal terms and 2,000 matches per preview), never attributes, link targets, cached mail, or the sandbox. Changing folders resets the search selector to All folders; ordinary folder browsing still shows only that folder. From a non-mail page, search uses the aggregate Inbox as its browsing context and searches all cached folders by default. Collection searches remain within their collection, and active quick filters continue to apply; the description makes these restrictions explicit. The duplicate in-list search field has been removed. Local-only folders do not have server descendants.

## Manual sync and reader continuity

Press **F9** (or click **Sync email**) to request a fresh server pull immediately. An open server folder syncs that folder; other views use the connected accounts' normal inbox sync, including existing discovery/trusted-Junk handling. It then requests the all-folder background backfill/rescan described above. Existing safety limits and read-only provider protections still apply; it never bypasses an active sync lock. Held-key repeats are ignored; F9 is the configurable default in Settings → Shortcuts. Overlapping manual requests are suppressed and failures leave the shortcut available for retry.

F9 also works while typing and, in the packaged desktop, while the sandboxed HTML reader has focus. It does not send, close or replace drafts/forms. Refreshing the list keeps the open reader intact. Switching **All mail / Unread** likewise retains the open message, its reader position and per-view permissions, even when that message is absent from the filtered list. Returning to All mail highlights it again. Bulk checks remain limited to the current visible scope.

## Delete selected messages

A normal click establishes the initial message. The first **Ctrl-click** (or **Command-click**) on another row checks both that initial message and the added message; further modifier-clicks toggle individual checks. Shift-click can extend from the initial row. Explicitly unchecked messages are not silently added back to an existing batch.

Press **Delete** with message-list or reader focus. Checked messages take priority; otherwise it acts on the highlighted/open message. The selection toolbar also provides **Trash** or **Delete permanently**.

- Outside local Trash, selected copies move to **Trash** and keep their restore origins, including local drafts.
- If every selected copy is already in local Trash, Delete permanently removes those local message records.
- A mixed selection containing Trash and non-Trash copies only moves copies to Trash; it does not permanently delete part of the selection.

No confirmation is shown. Held-key repeats and modified Delete shortcuts are ignored. Delete does not act on mail while typing in an input, search, editable region or open form, or while folder navigation has focus. The packaged desktop also handles Delete from the sandboxed HTML reader without granting that frame script or same-origin privileges.

`POST /api/messages/trash-selection` accepts `{ids, permanent}`. The whole selection is validated under an immediate transaction; missing messages or a changed non-Trash location abort permanent deletion without deleting other selected copies. Later responses cannot replace a different page's editor.

All operations are **local only**. Outlook's Deleted Items folder is not inkwell's local Trash. Permanent removal is not secure disk erasure and does not remove mail still on the server; a later provider import can download that server copy again.

## Expanded message context menu

Right-click a message, press Shift+F10/Context Menu, or use its **⋯** button. The reader has the same menu. The compact first level exposes common actions and **File**, **Mark**, **Find related** and **More actions** submenus. Desktop submenus fly out and flip near screen edges; touch screens use a drill-down panel with Back. Up/Down/Home/End navigate, Right opens a submenu, Left returns, and Escape closes a submenu before closing the whole menu and restoring focus. Long panels scroll within viewport bounds; labels do not wrap.

Available actions:

- **Apply rule…** opens saved rules for selection and execution; **Create from this message** starts a prefilled sender, subject, domain or TLD rule. Save for future imports or explicitly save and apply just to this selected cached copy; see [context rules](RULE-MANAGER-COMPOSE.md#rules-from-a-message).
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

**Rule Manager** in the sidebar (also under Settings → Mail rules) lists existing inkwell rules and provides an AND/OR condition builder with multiple local move/read/star/tag actions. Compose/Reply support optional Cc/Bcc and shared local address autocomplete. See [Rule Manager and recipients](RULE-MANAGER-COMPOSE.md).

These are working actions, **not full Outlook menu parity**. Reply all, provider categories, reminders, provider junk/block controls, original-source viewing, printing, attachment handling, and server folder creation/rename/move/delete remain unimplemented.

## Not Junk

**Not Junk** in the message menu and toolbar refiles all cached incoming mail from the exact sender using applicable non-junk rules or Inbox, and remembers future imports. Rule Manager lists these senders with a Forget action. Microsoft sync also checks Junk for remembered senders; an open app polls about every two minutes. Provider mail remains unchanged. See [Not Junk](NOT-JUNK.md) for scope, limits and safeguards.

## Reader toolbar

The reader uses consistent SVG icon-only buttons with tooltips and accessible names, docked on the **Select messages** row rather than occupying email-content space. This row stays visible while scrolling the reader. Bulk actions expand below it; narrow screens put secondary reader actions in More. Direct actions include Reply, Forward, archive/restore, mark unread, star/unstar, Move, Tags, Save text, add sender to contacts, copy sender address, reader light/dark, Trash/delete and More. Controls stay on one line and retain 44px touch targets on phones. Pane-width container queries move secondary controls out of the visible toolbar when necessary; every such action remains in More's grouped menu, including reader light/dark when a reader is open. Extremely narrow panes have an internal horizontal-scroll fallback instead of page overflow. Save text exports the readable cached message, not original MIME. Actions remain local except explicitly sending from the composer; no unsupported provider operations are shown as working buttons.

## Tags and quick filters

Tag Manager sits above Settings and supports reusable colored tags, usage counts, rename, bulk merge/delete, and exact tagged-mail browsing. The message toolbar adds combined quick filters, sorting, cards/table views and pinned filters. Filtering runs before pagination. See [Tags and filters](TAGS-FILTERS.md).

## Server preservation

There is no POP3 transport. IMAP reads Inbox with read-only selection and BODY.PEEK. Microsoft discovery/import uses GET requests. Context-menu message management changes SQLite copies only: it does not move, expunge or delete server messages. Sync does not restore a locally trashed/archived copy to its former local position. Imported read/star state is initially copied from the server; later local changes are not pushed back. Sending is an explicit click on Send message, without a second prompt, using SMTP or Graph, with Graph retaining Microsoft's Sent Items copy.
