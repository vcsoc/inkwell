# Reader attachments and conversation scope

The reader shows **Attachments** between the sender/date header and message body. Filenames, sizes, download controls and source-message details appear here. Files from other conversation messages are grouped separately; inline attachments are in labelled expandable groups rather than automatically rendered. The attachment list has its own bounded scroll area, so a long thread does not expand the reader indefinitely.

## Outlook conversations

On opening a connected Outlook message, Inkwell reads its Graph `conversationId`, lists that exact account's conversation across folders, and follows message and attachment pagination. Subject similarity is never used to guess a thread. Source messages need not already be downloaded into Inkwell's message list. Discovery runs one provider page per request and caches its checkpoint; switching messages stops starting new requests for the old reader. Very large conversations pause after 100 steps with **Continue attachment check**; this is a resumable UI batch, not a total historical-message limit.

**Refresh attachments** starts a new scan. Previously discovered metadata remains labelled as cached until revalidated, including known members no longer returned by the server. Cached metadata from other inspected members of the same account/conversation can be reused. Server-deleted or never-accessible attachments cannot be reconstructed. A failed, throttled or incomplete lookup is not presented as “no attachments.” A vanished member is labelled unavailable while remaining members can still be checked. Provider throttling honors bounded Retry-After delays.

## Other accounts and file types

- IMAP currently inspects **this message only**, in the connected account's read-only Inbox, with UIDVALIDITY checking and BODY.PEEK. It includes attached messages and their nested files. Original messages over 10 MB or overly complex nested MIME cannot be inspected; this matches the existing Inbox-only import limitation.
- Outlook ordinary file attachments can be downloaded, including inline files. Cloud-reference attachments and attached Outlook items are listed but must currently be opened/downloaded through the provider.
- Local composed copies and disconnected copies have no live provider reference. Previously discovered metadata remains available, but missing metadata is not invented.

## Downloads and privacy

Nothing is downloaded as file content merely to display Outlook metadata, and no file is opened or executed automatically. IMAP must read the bounded original MIME to discover its parts. Explicit file downloads are capped at **50 MB** (and the 10 MB source-message limit for IMAP). At most two browser attachment downloads are started concurrently.

Downloads are bound to the selected cached message view, its account identity and its discovered opaque file identifier. Provider retrieval uses GET or read-only IMAP, never server mutation. Files are served as `application/octet-stream` with attachment disposition, sanitized filenames, no-sniff and sandbox CSP. Temporary download data is private and not retained as a permanent attachment cache. The normal browser/OS download destination holds any files you save; those copies are not removed when local mail is deleted. Treat downloaded files as untrusted.

Schema 15 adds only `attachment_views`, keyed to local messages with deletion cascading. No existing message columns, credentials or provider identities change. Disconnecting an account preserves previously discovered metadata; permanently deleting its local anchor removes that view. Reconstructed `.eml` export still does **not** include original attachments.

## Calendar files

Download an `.ics` attachment and import it using **Calendar → Import .ics**, or choose **Open with → Inkwell** in the Linux file manager after installing this update. The existing **Add meeting invitation…** mail action reads the selected Outlook message's invitation, not a different message's attachment from the conversation.
