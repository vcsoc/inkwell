# Changelog

## 0.2.0-alpha.7

- Added alphabetized People index cards and a vertical jump index.
- Added saved theme thumbnails and icon controls for applying and deleting themes.
- Expanded Calendar to month, week, day and agenda views with event titles and a Create event from email action.
- Added contact and sent-address suggestions to To, Cc and Bcc, faster autosave with save-on-close, draft deletion, and a text-editing context menu. On Linux, selection translation can use the legacy app's installed offline model and runtime.
- Provider calendar sync, invitations, sending and rich image composition are not part of this preview.

## 0.2.0-alpha.6

- Renamed the Rust desktop preview to inkwell with a circled R in its window title, wordmark, and launcher icon.
- Added a managed per-user Linux launcher and `inkwellr` command alongside the existing Electron installation.

## 0.2.0-alpha.5

- Added a month calendar with day agendas and create, edit, and delete for unlinked non-recurring events. Outlook calendar selection is respected; connected events are not edited by the preview.
- Added People search and the ability to start a draft addressed to a contact.
- Added reply and forward as plain-text drafts in the message reader. The preview still does not send mail.

## 0.2.0-alpha.4

- Added a plain-text local composer with autosave and support for reopening compatible drafts from the existing workspace.
- Draft saves use shared revisions and reject stale edits. Drafts with formatted content, attachments, or a provider identity are left for the legacy editor.
- Sending and provider sync remain unavailable in the preview.

## 0.2.0-alpha.3

- Added scoped mail search with Unicode-normalized tag queries, quoted tag names, hashtags, and Cc/Bcc matching.
- Added local contact creation, editing, and deletion in the existing workspace, with address history updates and stale-edit protection.
- Mail, provider sync state, and credentials remain read-only in the preview.

## 0.2.0-alpha.2

- Replaced the preview palette with the exact Waypoint light and dark dashboard tokens. Waypoint Light is the default; Dark and Follow System are also available.
- Added Theme Studio: live previews, color/contrast, typography and spacing controls, a persistent local theme library, and YAML/JSON file import/export.
- Added a Rust codec for the existing Fernet vault format, verified with synthetic legacy credentials. The preview does not open the vault or enable account operations.

## 0.2.0-alpha.1

- Archived the Electron/Python project without changing its stored workspace or user configuration.
- Added the first standalone Rust/Tauri desktop preview: read-only access to the existing SQLite schema, a local mail reader with folders and search, and calendar/contact views.
- No provider network calls, writes, vault access, or migrations in this preview.
