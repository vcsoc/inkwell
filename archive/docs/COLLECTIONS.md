# Find related emails

Right-click an email in any message list, or use its visible **⋯** button. The open-message toolbar also has **⋯**. Choose:

- **Find all by sender:** the same parsed email address, regardless of display name or casing.
- **Find all by organisation:** the exact sender domain, case-insensitive and IDNA-normalized. `person@example.com` and `team@example.com` match; `person@sub.example.com` is a different domain. This is domain grouping, not company ownership or a public-suffix lookup.
- **Find all by subject:** case-insensitive subject with normalized whitespace and leading `Re:`, `Fw:`, `Fwd:` (including repeated prefixes / `Re[2]:`) removed. Distinct conversations with the same subject may be grouped together; this is not Message-ID threading.

The resulting collection includes matching messages from **all locally stored folders and accounts, including Trash**. Each row shows its folder, the banner shows totals by folder, and search narrows the collection. Results are paginated in pages of 100. Sent messages and drafts participate according to their actual stored sender/subject. Finding by an incoming sender does not automatically include your outgoing replies unless their own sender matches; find by subject to include those replies.

Collections do not move or copy messages and do not search unimported server mail. They are temporary dynamic views, not saved folders; reload returns to Inbox. The key remains usable even if the source message is subsequently deleted. SQLite indexes avoid rescanning full message bodies for sender/domain/subject grouping.

Keyboard: focus a message and press **Shift+F10** or the context-menu key, then use **Up/Down**, **Home/End** and **Enter**. **Escape** dismisses the menu and restores focus. Touch users can tap **⋯** instead of requiring a long press.
