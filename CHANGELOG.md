# Changelog

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
