# Architecture

## Components

```text
desktop/main.cjs       Sandboxed Electron window, local backend lifecycle/session
inkwell/__main__.py    Loopback server entry point
inkwell/app.py         Typed API routes, validation, origin/session/host security
inkwell/store.py       SQLite transactions, schema, settings, credential encryption
inkwell/mail.py        Verified-TLS IMAP/SMTP transport and safe MIME text extraction
inkwell/microsoft.py   Device authorization, token refresh and delegated Graph mail
inkwell/collections.py Indexed cross-folder sender/domain/subject queries
inkwell/message_keys.py Canonical keys maintained by SQLite triggers
inkwell/ai.py          Provider catalog, HTTP adapters and restricted official Codex CLI bridge
inkwell/preferences.py Validated form-mode and theme persistence
inkwell/static/appearance.js Independent layout/form/theme editors and validated presentation settings
inkwell/static/theme-files.js Restricted YAML mappings and JSON theme serialization
inkwell/static/color-editor.js In-app RGB/hex color controls, no screen capture or native eyedropper
inkwell/static/settings.js Routed Settings hub and feature-specific sub-pages
inkwell/static/       Responsive client, app manifest, offline navigation fallback
tests/test_api.py     Isolated API/security/storage tests and mocked transports
tests/ui/             Desktop/mobile-sized browser workflow tests
tests/desktop-smoke.cjs Actual Electron startup/sandbox smoke test
```

Python 3.11+ / FastAPI uses synchronous handlers for blocking SQLite, IMAP, SMTP and provider HTTP calls, keeping those operations off the async event loop. Connections are scoped per operation; writes commit or roll back in a context manager. Queries are parameterized. Dynamic SQL identifiers come only from fixed server-controlled schema fields. SQLite indexes support folder/date retrieval; inbox summaries omit full message bodies and are paginated in groups of 100.

The browser client is dependency-free, with no bundler, remote application resources or framework hydration. Explicitly approved email images are the only remote renderer resources. CSS owns desktop, tablet and phone layouts. Rendering uses a small escaped-template layer and event handlers rather than arbitrary HTML from messages/providers. Navigation generation checks discard stale async results. Browser-visible API data has no decrypted credentials.

Desktop uses the same UI/API as mobile. Source mode starts `uv run --frozen python -m inkwell`; packaged mode starts the bundled PyInstaller backend directly. Both select a free loopback port and install an authenticated cookie before loading the UI. No renderer-to-OS bridge is exposed. A single fixed Microsoft device-login link can be opened in the external browser by the main process. `desktop/build-linux.mjs` packages Electron and the backend, then produces a checksum-verified per-user self-extracting installer. Signed releases and signed auto-updates remain future work.

Mobile is explicitly a connected PWA, not an Electron or Python mobile port. HTTPS access goes through a separately configured reverse proxy. Cookies are process-lifetime sessions; local drafts live on the backend. Offline navigation displays a clear connection explanation without caching private responses.

## Data and synchronization semantics

Schema 14 adds local flags and durable per-folder Graph delta/next-page state with hashed pagination-cycle detection. Downloads commit before checkpoints and resume without an overall historical-message cap. See [Background sync](BACKGROUND-SYNC.md). Native minimized-window timers continue checking; browser timing remains subject to throttling. Shortcuts are allowlisted preference data, dispatched by context, with narrowly validated trusted-main-frame native forwarding. Date filters compare integer-microsecond timestamps against inclusive local-day bounds before pagination; see [Keyboard and mailbox controls](SHORTCUTS-DATES-FLAGS.md).

An imported email has a remote identity `(account ID, INBOX, UIDVALIDITY, UID)`. Unique remote keys make repeated syncs idempotent for retained local messages. IMAP read-only mode and BODY.PEEK avoid marking remote mail read. Imports are limited to the latest 200 UIDs and 10 MB per message. Schema 4 adds nullable `html_body` (NULL means not yet fetched) and JSON `tags`. HTML is kept alongside text, sanitized by nh3 on preview, and rendered in an opaque-origin iframe with script-free CSP and sandbox. Image origins are enumerated without fetching; explicit per-view HTTPS image opt-in is carried in the preview URL and constrained by both sanitization and CSP. Localhost/private literal addresses and nonstandard ports are rejected; this is not a DNS-aware network firewall. Attachments/CID images are not exposed. Folder, tag, star and unread mutations affect only SQLite. Existing IMAP cache entries lacking HTML are read-only re-fetched once; Graph imports refresh HTML without changing local overrides/tags.

SMTP submission happens before the local Sent insert. The absence of a durable outbox means network ambiguity or a local database failure after submission cannot be resolved automatically. This is documented rather than concealed by automatic retry. A future outbox needs immutable operation IDs, explicit uncertain states and provider reconciliation. Replies currently quote text rather than setting RFC threading headers.

Calendar times require timezone-aware API input and are stored in UTC with an IANA recurrence timezone. `calendar_tools.py` uses bounded python-dateutil recurrence rules; `/api/events/occurrences` expands at most 100 days and 5000 visible instances. All-day dates are stored as UTC-midnight date boundaries, with exclusive ends, and displayed without timezone date shifting. Calendar export escapes/folds ICS fields and includes RRULE/date-only values; IANA TZIDs require support in the receiving client. There is no remote calendar ownership, per-instance exception or invitation state.

Schema 12 adds folder positions. `POST /api/local-folders/move` accepts a local `id`, `target` folder key (empty for root), and `placement` (`inside`, `before`, `after`). Only local folders can be before/after anchors. An immediate transaction revalidates parent existence, cycles, subtree height and sibling-name conflicts, then updates the moved folder's parent and sibling positions. IDs, message membership, provider metadata and rule JSON are unchanged. Missing-parent branches use their visible root grouping for placement. The UI uses a separate folder drag MIME type, rejects outside payloads and offers a menu-based alternative.

Schema 11 adds local folder parent keys (`inbox|archive|sent|drafts|trash|local-N|remote:N`, empty for root). Folder creation validates parents and sibling uniqueness under an immediate transaction. Migration preserves stable IDs and the AUTOINCREMENT high-water mark; deletion rejects parents with children. Missing remote parents are presented as root-level local folders. Folder hierarchy is navigation-only, never provider mutation or outgoing-role inheritance. Descendant searches include attached local branches.

Schema 10 gates TLD condition support so older rule engines cannot open incompatible configurations. Message-context rule seeds expose only cached metadata; explicit single-rule application validates and commits message changes under an immediate transaction, preserving normal automatic-import priority. Saving and application remain separate, retry-safe operations.

Schema 9 adds persistent Not Junk sender decisions. One transaction refiles matching cached incoming copies; import hooks apply the same decision to future copies. Microsoft sync adds a trusted-only Junk scan, using read-only folder-role discovery. See [Not Junk](NOT-JUNK.md).

Schema 8 adds Cc/Bcc storage and indexed local address history. The rule builder adds validated condition/action arrays, plans changes before applying them atomically, and uses stable catalog IDs for tag references. SMTP Bcc is envelope-only; Graph uses recipient arrays. See [Rule Manager and recipients](RULE-MANAGER-COMPOSE.md).

Schema 7 adds a casefold-normalized tag catalog with colors and usage counts. Tag edits update local message labels transactionally; shared allowlisted filters/sorts are applied before paging in mail and collection queries. See [Tags and filters](TAGS-FILTERS.md).

Schema 6 adds stable draft keys/revisions, local tree destinations, and Trash restore metadata. `/api/messages/move` and `/api/messages/restore` validate and file whole selections atomically without provider calls. Editor exits and native desktop close await draft saves; browser page termination is best effort. The reader serves theme colors in its separate sandboxed HTML document. See [Mail polish](MAIL-POLISH.md).

Schema 5 adds `local_folders`, validated `mail_rules`, and calendar `all_day`, `timezone`, `recurrence` fields. Transport insert transactions run ordered rules only on newly inserted incoming copies. Schema 13 adds persistent priority and per-rule Stop behavior; see [Rule execution](RULE-EXECUTION.md). Local overrides prevent repeated imports from undoing filing; explicit scoped manual runs can reprocess managed incoming copies. Folder/rule validation and changes use immediate transactions to avoid orphan destinations. No provider write APIs are added.

Schema migrations use `PRAGMA user_version` in an immediate transaction. Version 1 adds Microsoft account authentication metadata without changing existing account secrets. Version 2 adds indexed canonical sender/domain/subject keys and backfills existing messages; insert/update triggers keep keys correct for every transport, draft, sent copy and demo import. Migration tests verify existing data is preserved. Group collections are read-only views over all local folders/accounts, not copied/moved messages. Subject keys normalize reply/forward prefixes, case and whitespace; organisation keys use the exact IDNA-normalized sender domain.

## AI boundary

The HTTP adapters speak OpenAI-compatible Chat Completions, Anthropic Messages or Gemini generateContent. The fixed provider catalog determines protocol; endpoints/models are user-configured. Config and credentials are read in one SQLite query, and a transactional config change clears a prior key when the provider or endpoint changes. Credentials are decrypted only for the outbound request. Requests include fixed safety instructions, untrusted selected context and the user's prompt, with no function/tool definitions.

The Codex subscription adapter instead invokes the official CLI using its own ChatGPT login, stdin, an ephemeral temporary workspace, read-only sandbox and explicit capability restrictions. It does not implement OAuth itself or copy tokens into Inkwell. It has a separate runtime boundary and is tested using mocked subprocess results; see AI-PROVIDERS.md for restrictions and limitations. Neither adapter executes output as mail/calendar actions.

Form presentation uses the same forms and event handlers in either a modal HTML dialog or an in-flow, non-modal internal page. Opening/closing restores focus. Draft exits await autosave; other unsaved forms discard without confirmation. Inline calendar forms share a container-query layout with the calendar: right-side editor at 1000px available content width, otherwise full-page. Resizing changes CSS layout without replacing form nodes. Presentation preferences are schema-validated JSON in the settings table. Themes map fixed, validated fields to CSS custom properties; imports cannot inject CSS or URLs. Draft theme changes preview locally until explicitly saved. Settings uses client-side `/#/settings/<page>` routes, a category overview and dedicated feature renderers rather than a long anchor-scrolling form. Only the active feature's controls are mounted; mail/AI data is fetched on demand and stale responses are ignored. Direct links, reload and browser history restore the active sub-page. Each editor saves its own feature without resetting unrelated preferences.

## Test scope

API tests exercise authentication, Origin/Host/CSP, credential encryption, CRUD, search, drafts, send success/failure, ICS generation, AI settings and mocked calls. Browser tests exercise end-to-end UI behavior, text-safe rendering and phone overflow. Desktop smoke testing launches the real Electron process and checks renderer isolation. All individual tests are limited to 15 seconds. Microsoft authorization/Graph and AI provider tests use mocks. Real provider credentials and OS-specific mobile behavior still require user validation. The Linux source/packaged desktop smoke test launches the actual sandboxed app with a temporary workspace.

## Next architectural steps

1. Built-in Microsoft application registration, OAuth for other providers and OS credential vaults.
2. Durable local-deletion tombstones and an outbox state machine (Graph sync cursors are implemented).
3. Attachment storage/limits/scanning, CID images and safe outbound email-link handling.
4. CalDAV/CardDAV or Graph adapters, per-occurrence exceptions and invite lifecycle.
5. Split client views into ES modules as features expand; localization and automated accessibility checks.
6. Native mobile shell only alongside on-device storage, offline reconciliation and OS background scheduling.
7. Reproducible signed desktop/mobile packaging, auto-updates, platform CI and independent security review.
