# Tag Manager and quick filters

## Tag Manager

Open **Tag Manager** immediately above Settings in the sidebar, or visit `/#/tags`. On phones, open the sidebar first. The manager provides:

- Full-width alphabetical sections with compact multi-column entries, subtle dividers, color dots and adjacent usage counts. Columns adapt to the available space. Tag search, used/unused filtering, and alphabetical/most-used sorting remain available.
- **Create tag** opens the editor below the directory. Saving returns focus to the saved entry. Editing controls appear on hover or keyboard focus, and remain visible with larger touch targets on phones. Bulk merge/delete controls appear when tags are selected.
- Creating reusable tags before assigning them to mail.
- Editing names and colors, with an in-app palette, saturation/brightness area, hue and hex picker plus a live pill preview (no RGB channel sliders or native color picker). Open **Choose color…** to reveal the picker.
- Checkbox selection, Shift-click ranges, Ctrl/Command-click selection, and select-visible controls.
- Bulk replacement/merge into a new or existing tag, removing duplicate labels on each message. An existing destination keeps its spelling and color; a new destination inherits the first selected source's color.
- Single/bulk deletion, and Delete-key removal when a selected row has keyboard focus. Deletion removes labels, never messages.
- Opening a tag's messages across all cached folders, including local Drafts and Trash. This is exact tag matching, not subject/body substring searching.

Names are case-insensitive, trimmed, and limited to 32 characters without commas or control characters. Messages have at most 12 tags. Case-only renames update their spelling everywhere. Renaming to a different existing tag is rejected with instructions to use merge. Counts count each message once per tag and include every local folder. Unused catalog entries remain available until explicitly deleted.

Rule references follow tag renames and merges; deleting a referenced tag disables the affected rules. See [Rule Manager and recipients](RULE-MANAGER-COMPOSE.md).

Changes are local, atomic SQLite transactions: no provider categories or server messages are changed. Global rename/merge/delete includes Drafts and Trash. Selecting multiple messages also exposes Add tag / Remove tag controls; a missing message or exceeded tag limit rejects the whole batch. Existing message tags are migrated into the catalog with deterministic default colors. Pills use contrasting black or white text; the strict application CSP is retained by applying validated colors through trusted JavaScript style properties.

Pigeon's manager was reviewed for functional reference (grouping, counts, selection, rename, deletion, replacement, and opening tagged items). This is an independent mail-specific implementation, not a copy of its asset-management code.

## Searching tag names

The top mail search defaults to **All folders**, including cached Junk, Sent and Trash. A plain tag name participates in text search; `tag:Work` searches only tag names, `tag:"Follow up"` matches an exact normalized name, and `#Work` matches tags Work or #Work exactly, plus literal #Work in message text. Tag matching supports Unicode case folding and equivalent Unicode spellings. Unused catalog tags do not produce mail results. Folder scopes, active quick filters and collection boundaries still apply. Clearing search returns to the folder being browsed. See [mail search](MAIL-WORKSPACE.md#top-centre-search) for cache limits and syntax.

## Quick-filter toolbar

The message view includes All mail/Unread, Starred, Tagged/Untagged, and an exact tag selector. These combine with the existing top search and folder/subfolder/all-cached scopes. Collection views use the same filters within their collection. Filters and sorting run **before** 100-message pagination; the footer shows the matching total.

Sort by Date, From, Recipient, Subject, Unread, Starred, Tags, or local Import order, ascending or descending. Date ordering respects stored timestamp offsets. Import order means local insertion order, not provider arrival order. Cards and table-style lists are available; table columns can also select the sort field. Narrow table lists scroll inside their pane rather than overflowing the app.

The filter icon directly beside **Unread** uses the same tab styling and collapses/expands quick-filter controls without removing active filters; active filters remain summarized. Clear filters resets quick predicates while retaining the top text query. Clearing the top search resets the predicates as well. Ctrl/Command+Shift+K reveals the bar and focuses the existing mail search instead of adding a duplicate text-search box.

Pin retains the current predicates when switching folders during this session. View, sort, direction, bar visibility, and pin preference persist in workspace settings; active predicates themselves reset on client reload. Without Pin, switching folders clears predicates. Selecting a message under Unread removes its read copy from the filtered results while keeping the reader open.

Attachment, priority, spam, conversation threading, received-time, and original-message-size controls are not presented as working features: the required data/features are not yet available. Search and counts cover downloaded copies, not the complete server mailbox.

## API and migration

Schema **7** adds `tag_catalog` (stable ID, canonical name/key, color), migrating existing labels without changing bodies, credentials, remote identities, folders, read state, or stars. Older binaries cannot open this schema; keep a consistent pre-upgrade database/vault-key backup.

- `GET /api/tags`: catalog entries with `id`, `name`, `key`, `color`, `count`.
- `POST /api/tags`; `PUT /api/tags/{id}`: create or edit name/color.
- `POST /api/tags/delete` with `ids`; `/merge` with `ids` and `name`.
- `POST /api/tags/assign` with message `ids`, `tag_id`, and `add` boolean.
- `/api/messages` accepts `unread_only`, `starred_only`, `tag_state`, `tag_id`, `sort_by`, `sort_order`. `summary=true` returns `{messages,total}`; the default retains the previous array response. Collection queries accept the same filters/sorts.

No confirmation prompts are added. Other clients see catalog edits when they reload their message view/manager; this is not a live multi-client push system.
