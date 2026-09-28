# Inkwell 0.1.15

Linux x86_64 Documents creation fix over 0.1.14.

- **＋ File** and **＋ Folder** on the Documents page now open an in-app naming dialog. Previously these buttons relied on browser prompts that were unavailable in the installed Electron app, so they could appear to do nothing.
- The dialog shows unsupported-format and duplicate-name errors without closing. A currently edited document must be saved before creating another file; cancelling never discards edits. Creation never overwrites an existing file or folder.
- A packaged-desktop smoke test now creates a document through the actual installed UI, in addition to browser UI tests.

Schema remains **19**; installation preserves the existing `~/.inkwell` workspace and Documents directory. Save work and quit/relaunch any running older window to use the fix; the installer does not close it. This unsigned Linux x86_64 build may not run on older glibc systems. `SHA256SUMS` verifies integrity, not publisher authenticity.
