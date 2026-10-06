# Inkwell 0.1.19 — Outlook server changes

- Authorized Outlook moves, Trash, restore and permanent deletion apply to the same server mailbox through the durable ordered Graph queue. Mail writes no longer depend on selecting one calendar account, and support multiple authorized mailboxes.
- Read-only Outlook moves/deletion now ask for write access rather than silently changing only the cached copy. Settings → Mail accounts → Enable server changes opens same-account Microsoft consent; ordinary reauthorization preserves an explicit local-only choice.
- Rules and Not Junk now queue authorized server filing/read/star changes transactionally. Missing-consent import paths continue safely without partial rule actions.
- Action notices distinguish queued server changes from local changes; the shared footer exposes missing access, pending, completed and failed writes, with retry support.
- Local changes only remains an explicit opt-out. Local-only destinations, tags, drafts and IMAP changes are not server writes. Earlier local-only moves/deletions are not uploaded retroactively. No server folders are created or renamed.
- Documents, PDF originals and unsaved drafts are preserved. Install without force-closing an open app; relaunch when your work is saved.

Verification: 334 Python tests; targeted desktop/mobile provider, reader, settings, rule and mail-action regressions; source desktop smoke and desktop bridge tests; formatting and Ruff checks. Server operations are tested with controlled Graph responses. Live mailbox writes still require the user's Microsoft consent and are not claimed verified.

This unsigned Linux x86_64 early test build is not a production-audited mail replacement. See [Server changes](PROVIDER-SYNC.md) and [Installing](INSTALLING.md).
