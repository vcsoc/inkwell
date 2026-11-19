# Inkwell 0.1.10

Linux x86_64 Documents usability update over 0.1.9.

- Ctrl+= (the plus key without Shift), Ctrl+- and Ctrl+0 zoom only the open document; Ctrl+mouse wheel and the editor's +/− buttons also visibly resize the document. Ctrl+Shift+=, Ctrl+Shift+- and Ctrl+Shift+0 now zoom/reset the entire application. On keyboards where typing `+` requires Shift, use Ctrl+= for the document and Ctrl+Shift+= for the application.
- The Documents breadcrumb includes the currently open filename, including across background navigation refreshes.
- Ctrl-click toggles multiple selected files/folders; Shift-click selects a visible range. Right-click the selection to Copy; right-click a destination folder or Documents root to Paste. Copies receive collision-safe names; originals remain intact. Symlinks cannot be copied or accessed from the Documents tree.

The installer preserves the workspace and previous installed releases. [Documents guide](DOCUMENTS.md) · [Installation and platform limitations](INSTALLING.md). This unsigned Linux x86_64 installer is not guaranteed to run on older Linux/glibc environments; checksums verify integrity, not independent publisher authenticity.
