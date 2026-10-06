# Server changes

## Enable Outlook/Microsoft 365 server changes

Open **Settings → Mail accounts → Enable server changes**. If your existing Microsoft connection is read-only, Inkwell opens **Reauthorize Microsoft** for the same account. Approve Microsoft's consent prompt for delegated `Mail.ReadWrite` and `Calendars.ReadWrite`. Inkwell cannot grant this access itself; organizations may require administrator consent. A different identity is rejected. Reauthorization preserves downloaded mail, drafts and local calendar data. The Enable action switches off an earlier Local changes only choice **only after successful authorization**; ordinary reauthorization preserves that choice.

By default, authorized Microsoft mail changes are queued to the **same server mailbox**, not just the downloaded copy:

- Move to Inbox, Archive, Trash/Deleted Items, or another server folder belonging to that account.
- Restore from Trash and permanently delete mail already in Trash.
- Mark read/unread, star/flag (both map to Outlook's single flag).
- Matching rule move/read/star actions and Not Junk filing back to Inbox.

A connected read-only Outlook message cannot be moved or deleted silently only on the device. Without write permission, these actions report the authorization requirement and leave the message in place, unless you explicitly select **Local changes only**. Automatic imports continue; rules requiring unauthorized moves are skipped. The shared footer provides a Grant access link when needed.

Choose a destination from the account's **server folder tree**. Local-only folders are not server folders; server-backed moves to local-only folders or another account's folder are rejected instead of claiming remote success. Inkwell does not create, rename or delete server folders. Tags, custom local folders, local sent copies, unsent local drafts and remote-content permissions remain on-device. Previously made local-only moves/deletions are **not replayed retroactively** when authorization is granted.

## Confirmation, retries and offline changes

The write queue is durable in the same SQLite transaction as the local change. Four workers preserve per-message ordering and retry temporary failures with exponential backoff and bounded attempts. Moving, then trashing, then restoring the same message cannot overtake earlier operations. Immutable Microsoft IDs let a timed-out move be checked before retry instead of moving it twice. A 404 from the delete action alone is not proof of deletion.

Action confirmations say **queued for server sync**, not that the server has already changed. The shared footer and Mail accounts settings show queued, completed and failed changes; use **Retry failed changes** after correcting access or connectivity. Offline or revoked access cannot produce a false completed status. Disconnecting an account cancels its unconfirmed jobs while retaining local mail and drafts; it does not disable writes for other authorized mail accounts.

**Local changes only** is an explicit opt-out for future changes. Jobs already queued before checking it still finish. It cannot be unchecked without at least one authorized Microsoft mailbox. Mail writes work independently of calendar selection and support multiple authorized Microsoft accounts.

## Calendar and other providers

Calendar writes additionally need `Calendars.ReadWrite` and a selected calendar account; mail writes need `Mail.ReadWrite` independently. Create/update/delete of connected events supports bounded daily, weekly, monthly and yearly recurrence. Calendar creates carry stable transaction IDs for duplicate-free retries. Historical unlinked local events are not uploaded automatically; editing one with calendar writes enabled adopts it. Accepting a suggested or imported meeting creates an event, **not** an Outlook invitation RSVP.

**IMAP/SMTP:** provider writes and calendar connections are not implemented for these accounts; their changes remain local. IMAP move/write and a CalDAV connection require separate implementations. The Microsoft setting does not grant those capabilities.

No server operation requires force-closing an open app or discarding an unsaved draft. Live mailbox behavior requires user authorization and must be verified against Outlook; automated coverage uses controlled provider mocks.
