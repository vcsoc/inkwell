# Inkwell 0.1.13

Linux x86_64 email reader fix over 0.1.12.

- Links in locally sent mail and Microsoft Sent Items display and work automatically. This decision is based on the Sent folder, **not** the spoofable From address. Clicking still opens the system browser, never an executable mail frame.
- Some Microsoft/Outlook Bcc copies replace short web addresses with very long Safe Links wrappers, including in the visible link text. Inkwell now shows the validated original address as the label while retaining Microsoft's protected Safe Links URL as the destination. Stored message content is unchanged. Unsafe, ambiguous, or nonmatching links are not rewritten.
- On received HTML mail, choosing **Load remote content** enables safe links as well as the existing image permission for that message. Nothing is opened until you click. The Text links switch can still turn links off in the current view without re-blocking permitted images. No scripts, forms, navigation within the app, remote styles or fonts are enabled. Loading images or clicking links can reveal your IP and/or report activity to a sender.

Schema remains **19**; no new database migration or user-data deletion. The installer preserves the workspace and older managed releases. Save work and relaunch an already-running older window to use the new reader; the installer will not close it. This unsigned Linux x86_64 build may not run on older glibc systems. `SHA256SUMS` verifies integrity, not publisher authenticity.
