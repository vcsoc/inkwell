# inkwell&reg; Desktop Preview

A new Rust and Tauri 2 desktop application for Linux, macOS, and Windows. The previous Electron/Python project, tests, docs and release workflow are preserved in [`archive/`](archive/README.md). The preview is not a replacement for the installed Electron app yet.

## Install on Linux

```sh
cargo build --locked --release --manifest-path src-tauri/Cargo.toml
scripts/install-linux.sh src-tauri/target/release/inkwell-tauri
```

Open **inkwell&reg;** in the app launcher, or run `~/.local/bin/inkwellr`. It installs alongside Electron Inkwell and preserves the existing workspace and older installed releases.

## Open an existing workspace

The preview opens `~/.inkwell/inkwell.db`. Provider mail and accounts are read-only at the provider. The manual **Sync Outlook Inbox** action can add missing messages to the local cache but does not change Outlook. The preview can edit contacts and address history, save account-free plain-text drafts, and edit non-recurring calendar events in workspaces without a connected calendar write target. It uses schema 22 from Inkwell 0.1.21 directly. If your workspace is elsewhere, set `INKWELL_DATA_DIR` to the folder containing `inkwell.db` before starting. There is no import, migration, change to `vault.key`, or new workspace creation. If you transfer a workspace to another computer, first quit the legacy app or take a consistent SQLite backup; do not copy a live database without its WAL.

With Rust stable and the [Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/) installed:

```sh
cargo run --locked --manifest-path src-tauri/Cargo.toml
```

The preview reads local and server folders, messages as inert plain text, and calendar events. It can create, edit, and delete local contacts. Mail pages show up to 50 messages. The calendar fetches the visible month; recurrence expansion and reminders are not yet ported. Refresh re-reads the database. **Sync Outlook Inbox** runs separately in the background and follows all Inbox pages. It reuses or refreshes the existing Outlook grant from legacy Inkwell, without asking for additional scopes. If it stops early due to a provider error, revoked grant, or concurrent write, committed pages remain cached; a retry skips messages already cached. Other folders, account setup, and provider reconciliation are not yet ported. Mail search supports folder scopes, literal text, and tags (`tag:work`, `tag:"Exact name"`, or `#work`). Advanced filters are not yet ported. Client data never enters a local HTTP server. CI checks this build on Linux, macOS, and Windows; macOS and Windows runtime and installer behavior still need platform testing.

## Theme Studio

The default uses the exact Waypoint Light dashboard colors. Open **Theme Studio** to start from Light, Dark, Follow System, or High Contrast, then customize colors, typography, spacing, and density. The sample preview uses no workspace data. Save stores the active theme and its library on this device; leaving the studio discards unsaved changes. YAML and JSON files contain appearance settings only. Export uses the desktop save dialog and does not overwrite an existing file.

## Cutover requirements

- Account setup and legacy Fernet credential compatibility; no re-encryption or destructive migrations without round-trip tests.
- IMAP and Microsoft Graph download sync, provider write queue, OAuth, transport tests, and restart/race tests. Connected mail edits must not become local-only.
- Composer, autosaved drafts, sending, attachments, safe HTML mail/remote-image consent, tags/rules, calendar editing/reminders, and remaining workspace tools.
- Installer and upgrade/rollback tests on all supported desktop platforms. Keep the legacy installation available and never let two clients independently run provider writes against the same workspace during migration.

See [`CHANGELOG.md`](CHANGELOG.md) for preview changes.
