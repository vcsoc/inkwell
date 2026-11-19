# Inkwell 0.1.17

This release completes the annotated PDF editing workflow:

- Add and replace PDF text **directly on the page**. Click or draw an area, type in the live inline text editor, and change font size beside it. Replacing an area preloads selectable existing text for editing. No text-entry modal or browser prompt interrupts the document.
- PDF tool buttons, export, print, download and zoom share one horizontally scrollable toolbar line. PDF status and instructions now use the shared application footer instead of consuming toolbar space.
- The staged text, image, signature and redaction previews each have adjacent **green Apply** and **red Cancel** controls. Images/signatures can still be repositioned and resized before application. Leaving a staged edit asks for confirmation.
- Inserting images/signatures into PDF copies preserves their source aspect ratio even when the selected area has a different shape; PyMuPDF's image-proportion flag alone was insufficient on the reproduced PDF.

All PDF changes still produce **separately named copies** and preserve the originals. Existing Documents storage, account data and drafts remain untouched. No database migration is required. Digital certificates and signing remain separate from these visual placements.

Verification: 326 Python tests passed; 29 focused desktop/mobile Documents and footer UI tests passed (1 skipped); source desktop smoke and 18 other desktop tests passed.

Linux x86_64 release assets: `inkwell-0.1.17-linux-x64.run`, `inkwell-0.1.17-linux-x64.tar.gz`, and `SHA256SUMS`. See [installation and compatibility](INSTALLING.md). Quit an open old version before launching the installed update; the installer does not close your window.
