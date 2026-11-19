# Inkwell 0.1.18

This release implements the annotated Documents file-management improvements:

- **Rename files and folders** from their right-click menus. The currently open filename is also shown directly after **documents.** in the top bar; click it to rename in place. Existing unsaved editor content stays open, and nested paths, recent files, page previews and download links follow the new name. Collisions and file-extension changes are blocked rather than overwriting an item.
- **Move a file or entire folder to the operating system’s recoverable Trash** from its right-click menu. Confirmation is required, including a warning about unsaved edits in an open item. Inkwell does not silently or permanently delete Documents files; failed OS Trash moves leave the source in place. This is separate from email Trash.
- Nested folders are visibly indented. Right-clicked folders use a distinct highlight, and the context menu closes when another folder is selected. The open filename now has more room in the top bar, including on mobile.

All operations remain confined to the user's Documents directory, reject hidden paths and symlinks, and leave `~/.inkwell` accounts, drafts and existing PDFs intact. No database migration is required.

Verification: 327 Python tests passed; 31 focused Documents/footer desktop and mobile UI tests passed (1 skipped); source desktop smoke and 18 other desktop tests passed.

Linux x86_64 release assets: `inkwell-0.1.18-linux-x64.run`, `inkwell-0.1.18-linux-x64.tar.gz`, and `SHA256SUMS`. See [installation and compatibility](INSTALLING.md). Installation does not close an already-open Inkwell window; relaunch when ready to use the new version.
