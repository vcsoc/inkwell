# Not Junk

Use **Not Junk** in a message's context menu or reader toolbar. It acts immediately, without another confirmation:

- Remember the exact normalized sender address across the workspace (not the whole domain or display name).
- Refile all cached incoming copies from that sender, across accounts and folders, including local Trash and previously manually filed copies.
- Start each copy in local Inbox, then apply the first eligible matching enabled rule. Rules may move it to another local destination and apply their read/star/tag actions. Rules targeting recognized Junk/Spam, Trash, Sent or Drafts destinations, including remote descendants, are skipped. Invalid-resource rules and actions exceeding the tag limit are skipped as usual.
- If no eligible rule moves the copy, it stays in Inbox. Read state, stars and tags are retained unless a matching rule changes them. Bodies, credentials and original provider identities are preserved.

The sender decision and all current-copy changes commit in one SQLite transaction. Drafts, known sent copies and their recognized remote folder trees are excluded. Other senders are unaffected. Removing a local copy later or filing it manually is not undone every time the same provider message is downloaded again; the automatic decision runs on newly imported copies.

## Future mail

Every new IMAP/Microsoft import checks remembered senders before normal local filing. On a normal Microsoft sync, inkwell additionally checks the standard Junk folder when remembered senders exist, importing only matching senders from that scan. Microsoft folder roles are resolved through GET-only well-known-folder lookups, so localized Junk/Sent/Drafts names are recognized after discovery.

While inkwell is running with connected accounts and remembered senders, it attempts a background sync about every **two minutes**, avoiding overlapping work. It preserves an open composer or reader. Offline failures are retried at the next interval; use manual Sync for connection-error details. There is no push service or closed-app daemon, and browsers may throttle background timers.

Existing import limits still apply: newest **200** messages per eligible folder per sync. "All existing" means all cached incoming copies, not uncached historical server mail. The extra standard-Junk check currently supports Microsoft accounts; IMAP imports remain Inbox-only. Mail in other provider folders is processed when those folders are imported.

## Local only and reversible sender memory

This does **not** move/delete provider messages, remove a provider junk flag, modify Outlook safe-sender lists, or train Outlook's spam filter. The provider copy may remain in Junk while inkwell shows its local copy in Inbox or the rule destination. No additional Microsoft write permissions are requested. Remote content remains blocked normally.

Sender headers can be spoofed. A remembered address is a filing preference, not proof of identity or an authentication override.

Expand **Rule Manager → Not Junk senders** below the rule list. **Forget sender** stops the special handling for future imports. It does not undo earlier filing, delete messages or disable ordinary user rules.

## Sender display names

Commas in display names are quoted on Microsoft import. Older cached imports with an unquoted display name and one unambiguous trailing `<address>` are recognized too. Startup repairs their empty sender/domain lookup keys without changing message text, filing, or remembered decisions. Multiple-address lists are not treated as one sender. After updating, restart and retry Not Junk; re-importing is unnecessary.

## Storage and APIs

Schema **9** adds `not_junk_senders(sender_key,created_at)`. The list is local plaintext data protected by the workspace's filesystem permissions and existing API session/origin/host checks. Earlier binaries cannot open schema 9; rollback requires a consistent earlier database/vault-key backup.

- `POST /api/messages/{id}/not-junk` returns `{sender,updated_messages}`.
- `GET /api/not-junk-senders` lists remembered decisions.
- `DELETE /api/not-junk-senders?sender=…` forgets an address.

Tests cover all-copy filing, rule priority, junk-destination bypass, future imports, localized Microsoft folders, GET-only provider access, rollback, protected outgoing copies, desktop/mobile controls and background polling without discarding composition.
