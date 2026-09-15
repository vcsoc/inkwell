# Mail workspace: activity, folders, search and message menus

## Activity strip

A thin, light, indeterminate strip runs across the top of the mail list while this client has API work in progress, including startup import, folder discovery and folder import. Concurrent requests are counted: one finishing does not hide another's activity. Errors also release the indicator. Reduced-motion settings use a static strip rather than animation. It is not a percentage estimate or a monitor of other clients' background jobs.

## Outlook server folder tree

The sidebar keeps Inbox, Starred, Sent, Drafts, Archive, Trash and local folders together without an extra local-mail heading or server-count caption. Classic layout also has Rule Manager and Tag Manager icons above Settings in the far-left Apps rail. Connected Microsoft accounts appear separately below, in collapsible **Outlook** groups. Multiple accounts get numbered groups; hover the group heading for its address without bringing back a visible account banner. Parent branches can also be collapsed; select a folder's button to view it. On phones, use **Open navigation**. Names are rendered as text, including names containing markup characters.

The main **Inbox** is the aggregate local workspace view across accounts, including locally refiled Inbox copies. **Outlook → Inbox** is the account's discovered server folder view. These are different views, not a second Inbox created on the server. The main **Drafts** contains editable, autosaved inkwell drafts; **Outlook → Drafts** contains downloaded server-draft snapshots, not those local editors. The top Inbox count describes cached unread mail; account-tree counts come from the server and can be much larger than the downloaded cache.

Startup and manual Inbox **Sync** discover the visible Graph mail folder hierarchy, including folders nested inside Inbox. The app follows paginated child lists and preserves its previous snapshot if discovery fails. Discovery is limited to 500 requests per account. Counts in the tree are server counts, not downloaded-message counts.

Opening a server folder imports up to its newest **200 messages** and displays them in Inkwell. Opening it again or pressing **Sync** in that folder refreshes its cache. The full mailbox is not downloaded at once. Server drafts and sent folders are viewable as imported mail, not editable server drafts. Generic IMAP folder discovery is not implemented yet; the current tree implementation is for Microsoft Graph.

Schema version 3 adds stable local folder IDs and message membership. Renaming a discovered server folder preserves its local ID. Missing folders are removed from navigation only after complete discovery; cached messages are not deleted. An older executable cannot reopen a version-3 workspace—retain a pre-upgrade backup if downgrading.

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
- **Folder + subfolders:** the selected folder and its local descendants, plus server descendants where applicable. On the aggregate Inbox, includes connected accounts' Inbox descendants and their attached local folders.
- **All folders (default):** downloaded mail across accounts, including Junk, Archive, Sent, local Trash and drafts.

Search matches sender, To/Cc/Bcc addresses, subject, plain-text body and local tag names, with filtering before pagination. Plain tag names work; `tag:Work` searches only tag names (substring), `tag:"Follow up"` matches an exact normalized tag name, and `#Work` matches the tag Work or #Work exactly as well as literal #Work in message text. `tags:` is an alias for `tag:`. These are single tag expressions, not a combined query language; use the exact-tag quick filter alongside a plain text query to combine a tag and message terms. Tag matching is Unicode-normalized and case-insensitive. `%`, `_` and backslashes are literal search characters, not SQL wildcards. Cross-folder results carry folder labels. Search does **not** search older messages still only on the server. Open/sync folders first to populate their caches. Changing folders resets the search selector to All folders; ordinary folder browsing still shows only that folder. From a non-mail page, search uses the aggregate Inbox as its browsing context and searches all cached folders by default. Collection searches remain within their collection, and active quick filters continue to apply; the description makes these restrictions explicit. The duplicate in-list search field has been removed. Local-only folders do not have server descendants.

## Delete selected messages

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

The reader uses consistent SVG icon-only buttons with tooltips and accessible names. Direct actions include Reply, Forward, archive/restore, mark unread, star/unstar, Move, Tags, Save text, add sender to contacts, copy sender address, reader light/dark, Trash/delete and More. Controls stay on one line and retain 44px touch targets on phones. Pane-width container queries move secondary controls out of the visible toolbar when necessary; every such action remains in More's grouped menu, including reader light/dark when a reader is open. Extremely narrow panes have an internal horizontal-scroll fallback instead of page overflow. Save text exports the readable cached message, not original MIME. Actions remain local except explicitly sending from the composer; no unsupported provider operations are shown as working buttons.

## Tags and quick filters

Tag Manager sits above Settings and supports reusable colored tags, usage counts, rename, bulk merge/delete, and exact tagged-mail browsing. The message toolbar adds combined quick filters, sorting, cards/table views and pinned filters. Filtering runs before pagination. See [Tags and filters](TAGS-FILTERS.md).

## Server preservation

There is no POP3 transport. IMAP reads Inbox with read-only selection and BODY.PEEK. Microsoft discovery/import uses GET requests. Context-menu message management changes SQLite copies only: it does not move, expunge or delete server messages. Sync does not restore a locally trashed/archived copy to its former local position. Imported read/star state is initially copied from the server; later local changes are not pushed back. Sending is an explicit click on Send message, without a second prompt, using SMTP or Graph, with Graph retaining Microsoft's Sent Items copy.
