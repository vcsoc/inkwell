# Rust port cutover checklist

The archived app is the behavioral reference. A feature is ready for cutover only when it works in the Rust/Tauri build and has a regression check against a synthetic or explicitly authorized test workspace. A compile check alone is not runtime parity. Do not point experimental writers at the live workspace.

| Area | Current evidence or required gate |
| --- | --- |
| SQLite | Rust reads schema 22, WAL data, local and server folders, cached messages, contacts, and events. Prove old-version migrations, backup/restore, version fences, and compatibility with the legacy derived-key SQL functions before enabling writes. |
| Credentials | Rust reads a Python-generated synthetic Fernet token. Still needed: real provider account lifecycle against test accounts, rotation, disconnect, redaction, and concurrency checks. The preview never opens the live vault. |
| Inbound mail | Port IMAP and Microsoft authentication, folder discovery, round-robin Delta state, restart and offline recovery, notifications, and Not Junk. Exercise retries, token expiry, duplicates, stale results, and overlapping manual/background requests. |
| Provider writes | Port the durable provider queue and explicit pending/failed states. Verify ordering, authorization, disconnect, retries, and reconciliation before enabling moves, edits, or deletion for a connected mailbox. Do not silently fall back to local-only edits. |
| Compose and reader | Port safe HTML and remote-content consent, attachments, local drafts and autosave, sending identities, compose and reply/forward, mail export, and keyboard actions. Verify retention across restarts and failed sends. |
| Organization | Port search grammar, tags, flags, filters, folder hierarchy/reordering, collections, rules, and analysis. Compare legacy fixtures with equivalent Rust results. |
| Personal tools | Port calendar and reminders, contacts editing, Documents and PDF tools, translation, and AI providers. Verify file boundaries and platform integrations. |
| Design and desktop | Waypoint colors and local Theme Studio are in alpha. Still needed: legacy layouts/form preferences, app-wide theme coverage as features land, installer/updater/signing, and native smoke tests on Linux, macOS, and Windows. |

Dependencies and legal notices for release builds must cover the actual Rust dependencies. Pairing and browser/mobile behavior are separate from the Tauri desktop shell and need their own migration decision and verification.
