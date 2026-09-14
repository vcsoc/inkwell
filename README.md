# inkwell

**A little less noise. A little more room to think.**

A desktop/mobile-first email, calendar, contacts and AI workspace. The desktop app runs a private Python backend in a sandboxed Electron window. The mobile experience is an installable, responsive PWA connected to your private backend.

> **Status: working early test build, not a complete or production-audited Outlook replacement.** Native standalone iOS/Android apps, Exchange/EWS, attachments, provider calendar sync and signed installers are not implemented. Microsoft OAuth/Graph mail uses the bundled public application registration. Please read the limitations before connecting important accounts.

## Install on this Linux machine

Build a bundled installer with `npm run build:linux`, then run `sh dist/inkwell-0.1.0-linux-x64.run`. The installed app appears as **inkwell** in your launcher and includes its Python backend—no development tools are required to run it. This is an unsigned Linux x86_64 user installer. See [Installing](docs/INSTALLING.md).

## Start testing from source

Prerequisites: [uv](https://docs.astral.sh/uv/getting-started/installation/) and Node.js 22+ (24+ recommended). Commands work from this repository on Windows, macOS and Linux; only Linux has been exercised here.

### Desktop app

```sh
uv sync --frozen
npm ci
# If npm reports that Electron's install script was blocked:
node node_modules/electron/install.js
npm run desktop
```

Click **Explore demo** to load a sample inbox, event and contact. No account or AI key is needed. The desktop launcher starts/stops the backend automatically, selects a free loopback port, and authenticates its own session.

The commands above use the source-based desktop launcher. The Linux installer bundles its backend instead. `uv` must be on PATH; alternatively set `INKWELL_UV` to its executable path. Never work around Linux sandbox issues by disabling Electron's sandbox.

### Browser / private mobile server

```sh
uv run python -m inkwell
```

Open **http://127.0.0.1:8765**. Keep the terminal running. This is also useful for desktop browser testing without Electron.

For a phone, see [Mobile setup](docs/MOBILE.md). `localhost` on a phone refers to the phone, not your desktop. Use an authenticated HTTPS connection to your private server, then install using **Add to Home Screen** (iOS Safari) or **Install app** (Android Chrome). The backend must remain running. This is not an offline standalone native mobile app.

## What works

| Area | Implemented |
| --- | --- |
| Desktop | Native OS window, isolated renderer, automatic local backend startup, single-instance launcher |
| Mobile | Touch-oriented navigation, responsive mail reader, full-screen forms, safe-area support, install manifest, offline connectivity explanation |
| Email | Multiple IMAP/SMTP accounts, inbox sync, isolated HTML/text previews, opt-in remote images, search, pagination, unread/tag pills, local read/unread, stars, archive/trash, drafts, reply, forward, explicit SMTP sending, draft autosave, local drag-and-drop and Trash restore |
| Calendar | Themed month grid/agenda, all-day and multi-day events, drag/two-endpoint ranges, timezone-aware daily/weekly/monthly/yearly repeats, whole-series editing, `.ics` export |
| Mail rules | Dedicated Rule Manager, context-menu rule creation/application, sender/domain/TLD/subject conditions, multiple local actions, and [Not Junk](docs/NOT-JUNK.md) sender memory with Inbox/rule filing — never server mutations |
| People | Create/edit/delete contacts, compose from contact, recipient suggestions |
| AI | OpenAI, OpenRouter, Anthropic, Gemini and compatible APIs; official Codex CLI subscription bridge; Ollama, LM Studio, llama.cpp and served Unsloth models; explicit context sharing and draft suggestions |
| Appearance | Saved popup/internal forms; responsive calendar side editor; 16px defaults, separate sidebar font/size, adjustable spacing, in-app RGB/hex colors, four palettes, contrast guidance and YAML/JSON theme import/export |
| Privacy | No telemetry or remote fonts, no remote email resources, TLS-only mail transport, encrypted stored credentials, CSP, origin checks, strict HttpOnly sessions, host allowlist |

### Email setup

For Outlook.com/Hotmail without an Inkwell application registration, use **Settings → Mail accounts → Open Outlook.com webmail**. Microsoft 365 has its own webmail link. These open Microsoft's site in your default browser for sign-in, reading and sending; they do **not** populate Inkwell's native inbox or compose form.

For a native inbox connection:

1. **Settings → Mail accounts → Connect email**.
2. Choose a preset or enter your provider's IMAP/SMTP settings.
3. Use an **app-specific password** from your provider. Some providers require enabling two-factor authentication first; some accounts do not allow app passwords.
4. Save, then click **Sync** in the top bar.
5. Compose and click **Send message** to send immediately, without another prompt. Without an account, drafts work but sending is disabled.

**Outlook.com / Hotmail** and **Microsoft 365** use **Sign in with Microsoft**. Use the bundled public application registration, enter inkwell's device code on Microsoft's indicated website and grant delegated mail access. inkwell never collects your Microsoft password. See [Microsoft setup](docs/MICROSOFT.md).

TLS certificate verification is mandatory. IMAP uses implicit TLS (normally port 993). SMTP supports implicit TLS (465) or mandatory STARTTLS (587). Presets are conveniences, not proof that your specific account supports password-based access.

Sync imports the newest **200 inbox messages** per account, skipping messages over **10 MB**. It never changes the server's read flags or folders. HTML and text alternatives are cached separately, each limited to 500,000 characters. HTML previews are sanitized and sandboxed; remote images start blocked. Banner options can allow selected HTTPS image origins for the current view when explicitly selected. The previous text preview remains available in Settings → Forms. See [HTML previews](docs/HTML-PREVIEW.md). The top-centre search defaults to all downloaded folders, including Junk, with optional current-folder/descendant scopes. Search tag names directly or use `tag:Work` / `tag:"Follow up"` for tag-only searches. Microsoft server folders appear beneath Inbox and import their newest 200 messages on opening. A thin activity strip indicates active API work. See [Mail workspace](docs/MAIL-WORKSPACE.md) for scope limits and the expanded message menu. Quick filters (Unread, Starred, Tagged/Untagged, and exact tag) apply before pagination, with matching totals, sorting, and cards/table views. Unread and local tags have visible pills; use Tags… in the reader or Edit tags… in the message menu. Tags are included in search. **Tag Manager**, above Settings in the sidebar, supports colors, counts, search, rename, multi-selection, merge, and deletion. Selected messages also support bulk tag assignment. See [Tags and filters](docs/TAGS-FILTERS.md). Drag the folder/message separators to resize side-by-side panes. Ctrl+/Ctrl− scales the interface; Ctrl+0 resets it.

### Appearance and internal forms

Settings has dedicated **Layout**, **Forms**, **Theme studio**, **Mail accounts**, **AI assistant**, and **Privacy & data** sub-pages—not scrolling anchors. Each has a direct link and supports reload and Back/Forward. In **Settings → Forms**, choose **Internal pages** to replace popup forms with in-app forms, then save. Open **Settings → Theme studio** for live color, typography, sizing and density editing, with a live sample preview panel, readable 16px defaults, separate sidebar font/size and spacing controls, in-app color pickers, YAML/JSON import/export, revert and saved persistence. See [Appearance](docs/APPEARANCE.md). [Rules and calendar](docs/RULES-CALENDAR.md) explains import rules, one-field live search, repeat options and the theme-colored wordmark.

### AI setup

Provider presets now include **OpenRouter, OpenAI, Anthropic Claude, Google Gemini, Mistral, Groq, DeepSeek, xAI, Together AI**, and local servers. Claude and Gemini use their native APIs. For **ChatGPT/Codex subscriptions**, install the official Codex CLI on the backend and run `codex login` with ChatGPT sign-in, then choose the Codex provider and check its login. This is an advanced restricted CLI bridge, not a subscription API-key workaround. See [AI providers, local models and Codex security](docs/AI-PROVIDERS.md).

For a local assistant, install [Ollama](https://ollama.com), then:

```sh
ollama pull llama3.2
# Start ollama serve if your installation is not already running its service.
```

In **Settings**, use `http://127.0.0.1:11434/v1`, model `llama3.2`, and no API key. The URL is resolved by the **backend**, not the phone.

For a cloud provider, enter its HTTPS OpenAI-compatible base URL, exact model name and API key. For example, `https://api.openai.com/v1` with a model enabled for your account.

Open **Ask inkwell**, write your prompt, and optionally check **Include selected email / calendar**. Calendar context includes the occurrences loaded for the last viewed calendar grid. Nothing is shared until you press **Ask assistant**. Responses are suggestions; HTTP providers receive **no tools**. The Codex CLI bridge runs with explicit restrictions and a read-only sandbox, but has a separate runtime/security boundary described in the provider guide. Inkwell never executes assistant output as mail/calendar actions or starts AI work in the background. Requests are single-turn, not persistent agent sessions. Always review output and cloud-provider retention policies.

## Limitations / next milestones

- **Not Outlook feature parity:** Microsoft Graph/OAuth supports delegated inbox reading and sending only. No Exchange/EWS, shared mailboxes or enterprise administration. The distributed build includes a public Inkwell application registration; Microsoft or organizational consent policies still apply.
- No attachments, rich HTML compose, Reply All, conversation threading, provider-side rules, signatures, scheduled sending or remote folder management. Compose supports multiple To/Cc/Bcc recipients and local address autocomplete; see [Rule Manager and recipients](docs/RULE-MANAGER-COMPOSE.md).
- No background IMAP IDLE, periodic polling, SMTP Sent-folder upload or two-way flag sync. Startup and post-Microsoft-connection imports are automatic. SMTP copies are stored locally; providers may separately save their own copies.
- No CalDAV/CardDAV, per-occurrence exceptions, meeting invites, reminders, push notifications, tasks, calendar import or video-meeting creation.
- Local deletion is not server deletion. A permanently deleted imported message may return on the next sync.
- SMTP failures can have ambiguous delivery outcomes. Check the provider's Sent mailbox before retrying. There is no durable outbox/retry queue or send idempotency protocol.
- Credentials are encrypted, but the decryption key lives beside the database. Mail, contacts and calendar content are plaintext at rest. Use full-disk encryption and protect backups.
- Single-user backend. A paired phone has access to the entire workspace. No per-device permissions, per-device revocation or multi-user isolation.
- Mobile requires server connectivity. No native mobile binaries, mobile-local database, offline mail cache, biometrics or mobile background work.
- The Linux user installer bundles Python/Electron but is unsigned. No auto-updater or macOS/Windows installers yet. Actual macOS, Windows, Safari/iOS and Android hardware validation remains to be done.
- No independent security audit, load test or real-provider integration test was performed. Automated transport tests use mocks; verify your own provider with a non-critical account.

## Data and backup

Default data directory: `~/.inkwell` (the current user's home directory on all OSes). Override with `INKWELL_DATA_DIR`.

- `inkwell.db`: SQLite workspace and encrypted secrets.
- `vault.key`: local credential encryption key. Do not delete it unless you intend to lose access to saved credentials.

**Quit all Inkwell processes before copying the entire directory** to an encrypted backup location. Restore both files together. Do not commit these files. On POSIX, newly created directories use mode 700 and the database/key use 600. On Windows, permissions inherit from your profile directory; use BitLocker and appropriate user ACLs.

Sessions expire on backend restart. Remote users must re-enter the access key after restart. A local-only browser launch trusts the local OS user; desktop launch uses a random access key automatically. See [Security](SECURITY.md).

## Development and tests

```sh
uv sync --frozen
npm ci
npx playwright install chromium
uv run pytest -q
uv run ruff check .
npm run check
npm run test:ui
node tests/desktop-smoke.cjs  # requires a graphical desktop
npm audit
```

Every backend, browser and desktop smoke test has a **15-second per-test timeout**; the full suite can take longer. Tests use temporary data directories, not your real workspace. UI tests run at desktop and iPhone-sized Chromium viewports. Screenshots and failure traces are written under `test-results/`.

Right-click an email (or use its **⋯** menu) to **Find all by sender**, **Find all by organisation** (exact sender domain), or **Find all by subject**. Collections span all local folders/accounts, including Trash, with search and pagination. They don't move mail or query unimported server messages. Subject matching ignores case, repeated whitespace and leading Re/Fw/Fwd prefixes.

Settings → **Layout → Default mail layout** offers Focus, screenshot-inspired Classic three-pane, Stacked bottom-reader and List-first layouts. Theme and form preferences remain independent.

Keyboard shortcuts: **C** compose, **/** search, **Shift+F10** email menu, **Escape** close assistant/navigation. All important actions also have visible controls.

See [Architecture](docs/ARCHITECTURE.md) for layout and design decisions.

## License

Free to use under the [inkwell Free Use, No Modification, No Resale License](LICENSE). Code changes, resale, and inclusion in paid products/services require Chris Visser's prior written permission. Supported settings, themes, and normal configuration are allowed. This is **source-available, not open source**. Third-party components retain their own licenses; see [Third-party notices](docs/THIRD-PARTY.md). The custom terms should receive legal review before relying on them for distribution.

See [Drafts, reader and local filing](docs/MAIL-POLISH.md) for autosave, immediate actions, reader colors, selection, drag-and-drop, and Trash restore.
