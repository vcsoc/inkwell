# Background mailbox downloads

`POST /api/sync/jobs` starts or joins the shared job; `GET /api/sync/jobs` returns its ID, active state, current folder, completed/total visits, newly imported messages, pending work, revision and bounded errors. Both retain the normal session/origin protections. Checkpoint URLs are private database state, not API status fields.

## Timing and completeness

The quick Inbox/current-folder pull remains available. After startup/manual quick sync, Outlook downloads run in the background. While an app is open, automatic checks are requested about every **15 seconds**. Native desktop timers remain active when minimized; browsers, sleep, connectivity, provider latency and throttling can delay checks. This is polling, **not push or a delivery-time guarantee**. Folder discovery normally refreshes about once a minute; manual Sync requests discovery sooner.

The default **F9** shortcut requests a quick pull and a full background scan. When idle, full scanning resets completed checkpoints but retains unfinished history. During an active job it requests a fresh-mail check without restarting the download. Shortcuts are customizable in Settings. Progress and errors appear in the application's single fixed footer along the bottom of the main pane, never beneath the folder sidebar (on phones, above the bottom tabs). In mail views the same footer also shows conversation counts and pagination. Outside mail views it appears only while syncing or when pending work/errors remain. Updates preserve the reader DOM, position, permissions and open editors.

## Resumable Graph synchronization

One daemon worker holds the existing transport lock and visits folders round-robin, one delta page per visit. It covers discovered Microsoft folders and subfolders, not only Inbox. A shared HTTP connection pool avoids a new TLS connection for each folder page.

Schema **14** adds `mail_sync_state` with per-folder next-page/delta links and `mail_sync_pages` with page-link hashes for cycle detection. Message copies commit before their checkpoint, so interruption can repeat a page but cannot checkpoint unimported messages. Immutable IDs deduplicate repeated copies. A job yields after 128 page visits; unfinished cursors resume on later passes, including after restart. **There is no total mailbox-message or historical-page cap.** Every returned page item is processed, even if a provider returns more than the requested page size.

While historical scans are unfinished, bounded quick recent-mail checks run between rounds (and at the next job's start); these do not replace or truncate the historical delta scan. Completed folders use their delta checkpoints instead of a newest-200-only refresh. Large backfills and unusually high arrival volumes can still delay some messages.

Nullable Drafts fields and malformed sender headers do not abort an otherwise readable message import. Partial delta entries are fetched by ID before updating cached content and headers. Server Drafts/Sent remain snapshots, not editable local drafts or incoming-rule candidates.

Repeated or untrusted Graph links report errors without discarding cached mail. Expired checkpoints and detected pagination cycles schedule a fresh scan. Failed pages retain their previous cursor. Automatic jobs honor provider retry delays for 429/503 responses. Failed discovery retains the cached tree. Disconnected/replaced account identities are checked before importing; refresh-token writes remain conditional on unchanged credentials.

## Preservation and limits

Graph retrieval is GET-only. OAuth token refresh is a separate authorization operation. No server messages, read flags or folders are modified. Local filing, read/star/flag choices and tags are retained. Provider removal events **do not erase cached copies**. There are no durable local-deletion tombstones: a full rescan or later server change may download a locally deleted copy again.

Outlook folder totals count **items**, which may include non-mail objects. They need not equal the message endpoint's count or the cached message count. Navigation badges count cached unread messages; tooltips distinguish server item totals. A count difference alone is not proof of missing email.

Quitting signals cancellation between pages; an in-flight request may finish before shutdown. No service remains after the backend exits. Backfill consumes bandwidth and disk space. Cached HTML/text limits still apply; attachments/original MIME are not fetched. Generic IMAP remains Inbox-only. Provider calendar/contact synchronization and server-folder management are not added.
