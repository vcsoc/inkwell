# Inkwell 0.1.9

Linux x86_64 release. The installer updates managed app files without deleting mail, Documents, preferences, or older installed releases. Quit an open older Inkwell window before starting this release; do not force-quit a draft.

## New and improved

- Documents: file-type/folder icons, themed scrollbar, sticky path, search and sorting, drop-preview folder moves that preserve unsaved edits, one-row icon tools and document-only zoom.
- PDF: password retry dialog with short-lived in-memory unlock, non-overwriting export, selectable print options and first-page preview. PDF edits and exports produce separate copies. Printing needs configured CUPS tools; legacy Office conversion needs LibreOffice. See [Documents](DOCUMENTS.md).
- Inbox: year/month/day/weekday message dates; compact quick-filter icons and popovers free the second toolbar row; folder menus close when another folder is selected, with persistent per-folder colors.
- Attachments: after explicit download, choose a script-free Inkwell preview or a regenerated safe copy in the OS default app. Opening the original requires separate script-risk acknowledgement and a native confirmation; executable formats are blocked. Inkwell cannot prevent scripts in arbitrary third-party apps when opening an original. See [Attachments](ATTACHMENTS.md).

The installer is **unsigned** and built on Linux x86_64; compatibility with older Linux/glibc environments is not guaranteed. The published `SHA256SUMS` covers both the `.run` installer and `.tar.gz` archive; these checksums verify download integrity, not independent publisher authenticity.
