# Server Synchronization

Server synchronization is always enabled for connected Outlook mailboxes. There is no device-only opt-out. Existing opt-out preferences are retired at startup; this does not replay historical edits automatically. Re-run a saved rule or explicitly move older filed messages to synchronize them.

## Mailbox Changes

- Moves, Archive, Trash, restore, permanent deletion, read/unread flags, and stars/flags queue Microsoft Graph operations using immutable message IDs.
- Tags assigned to Outlook messages synchronize as Outlook categories. Rename, merge and removal update affected messages. Category updates preserve unrelated categories already on the server. Interface tag colors remain presentation settings.
- Workspace folders are backed by matching folder hierarchies in each relevant Outlook mailbox. Creating a folder queues server creation. Moving a message to an existing workspace folder provisions missing server folders automatically. Existing folders with matching names under the same parent are reused. Cross-account destinations are rejected.
- Folder hierarchy changes queue server moves. Reordering sibling shortcuts is an interface preference, not an Outlook folder-order operation. Folder deletion refuses a server folder with messages or child folders rather than silently deleting uncached contents.
- Connected calendar events use the selected Microsoft calendar account and the durable provider queue. Historical unlinked events are adopted when edited with a calendar account selected.

Microsoft Mail.ReadWrite and Calendars.ReadWrite consent is still required. The application cannot bypass tenant policy, a revoked grant, network failure, or a provider error. Unsupported or unauthorized mailbox mutations fail instead of succeeding only on this device. Open **Settings > Mail accounts > Grant server access** to authorize the account when prompted.

IMAP write transport is not implemented. Mutations of downloaded IMAP messages are blocked, not represented as synchronized. Sample mail, disconnected cached copies, local document files and application preferences are not connected server mailbox items. Draft composition and contacts are not covered by the mailbox operation queue.

## Queue and Recovery

The cached change and its provider jobs commit in the same SQLite transaction. The footer and Mail account settings show queued, completed and failed operations; queued does not mean server-confirmed. Network, rate-limit and temporary server failures retry with bounded exponential backoff. Use **Retry failed changes** after correcting authorization or provider failures.

Jobs execute in order within each account. Separate accounts can progress in parallel. Folder mappings persist across restarts and folder resolution searches before creation. Message move retries check the current server parent before repeating a move, making lost-response retries safe. Server deletion is confirmed before a job is marked complete.

Disconnecting an account cancels unfinished jobs and removes its folder mappings without deleting downloaded mail. An already in-flight provider request may finish remotely; cancellation cannot recall a request already accepted by Microsoft.

## Verification

Provider tests use mocked Microsoft transport and temporary databases. They cover atomic job creation, consent boundaries, folder hierarchy provisioning and reuse, tag/category preservation, lost-response retries, account scoping, and queue recovery. Installed desktop smoke tests use a temporary workspace; they never operate on the user's mailbox.
