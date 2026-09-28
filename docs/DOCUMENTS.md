# Documents editor (development)

**Documents is included in the 0.1.9 Linux x86_64 release.** Search, moves, export, printing and the compact toolbar are included. Open **Documents** from the desktop icon rail or mobile tab. On mobile, use the ☰ menu to open the folder tree; tap the pages icon to open the thumbnail drawer.

## Supported files

| Format | Available actions | Caveats |
| --- | --- | --- |
| PDF | Page thumbnails, area selection, permanent redaction, image/text placement, drawn or imported signature image, PKCS#12 digital signature, file-size reduction, download | PDF edits and signatures always save separately named copies, never overwrite the source. PDF text is not a word processor. Compression only produces an output if smaller. |
| DOCX | Rich editing, headings, bold/italic/underline/strikethrough, fonts and color, lists, alignment, indents, tables, embedded images, download | Saving rewrites the document. Pasting/dropping into the rich editor inserts plain text to avoid loading untrusted external resources. Complex Word layout, precise pagination, tracked changes, fields, and floating-image placement are **not** faithfully round-tripped. Section thumbnails are text excerpts, not rendered pages. |
| DOC, ODT, RTF | Rich editing through LibreOffice conversion | Requires an installed `libreoffice` or `soffice` executable. Its availability in bundled installations is not yet verified. Round trips can change formatting. |
| HTML/HTM | Sanitized rich editing with inline images and text wrapping | Scripts, embedded frames, unsafe URLs and remote images are stripped. Only HTTPS and mailto links are supported. |
| TXT, MD/MDX, CSV/TSV, JSON, YAML, XML, TOML, INI, LOG, PY, JS, CSS | UTF-8 text editing, optional line numbers, line wrap, line indent/outdent | Markdown has a sanitized read-only preview; CSV remains editable text (not a spreadsheet). Binary and non-UTF-8 inputs cannot be edited. |

Use **＋ File**, **＋ Folder**, or **Import** in the Documents folder tree. Recent files appear above it. Search looks through folders and filenames; **Order by** sorts folders first, then files by name or modification time. The sticky path shows the folder currently in view (hover for the complete path). On desktop, drag a file or folder onto another folder, a file in the destination folder, or the Documents root; the insertion marker shows where it will move. A move cannot overwrite another file or move a folder into itself. The selected file remains open after a move.

Select another file or navigate away from unsaved edits to receive a discard confirmation. **Ctrl/Cmd+S** saves text/rich edits; an externally modified file triggers a conflict instead of being overwritten. **Ctrl/Cmd++**, **Ctrl/Cmd+-**, and **Ctrl/Cmd+0** zoom only the document; toolbar +/− buttons do the same. The file tree exposes only supported files under your system's Documents folder (including an XDG-configured Documents folder). It rejects hidden files, symlinks and `..` paths. Local API requests retain Inkwell's usual authenticated session, origin and host checks.

**Export to PDF** saves a separately named `.export.pdf` alongside the source and leaves the original untouched; exporting an already-PDF file simply reports that it is PDF. **Print** opens a printer selector, first-page preview, page-range, copies, paper size, orientation, color, duplex, scaling and margin options. Printing requires a configured CUPS printer and the system `lp`/`lpstat` tools. DOC/DOCX/ODT/RTF export and printing require LibreOffice; precise layout, print margins and printer-specific options depend on installed fonts, converters, drivers and device capabilities. PDF export for HTML is sanitized before rendering, and text/Markdown export is plain-text PDF (not a typeset Markdown preview). No print job is sent until **Print** is confirmed. A protected PDF prompts for its password; an incorrect password can be selected and retried. Passwords stay in backend memory for up to 30 minutes per unchanged file, not in settings or the Documents folder.

### PDF tools

1. Open a PDF and select a page thumbnail.
2. For **Redact area**, **Place image**, or **Add text**, drag a rectangle over the page. Redaction removes PDF content under that rectangle and paints it black in a *new copy*; check the output before sharing. To sign with an image, draw a signature on the touch/pen/mouse canvas or import a PNG, JPEG, WebP or GIF, then select the placement rectangle. These visual signatures are **not** cryptographic digital signatures.
3. For an actual digital signature, choose **Signature → Digital certificate**, provide your own PKCS#12 (`.p12` / `.pfx`) certificate and password, optionally select a rectangle and sign. The certificate is parsed in memory, never written to Inkwell's settings or the Documents folder. A self-signed certificate can sign a document but does not establish trust with recipients; use a trusted certificate where required and verify the result in a PDF viewer.
4. **Compress PDF** attempts image downsampling, font subsetting and stream compression. If that does not shrink the file, no new copy is made.

No tool undoes a saved PDF edit: return to the preserved original or a prior copy. Image signatures, added text and compression can invalidate signatures already on a source PDF; do not modify previously signed documents if preserving signature validity is important. There is no guarantee that every PDF viewer will display identical appearances, and PDF/A, form-field and accessibility preservation have not been audited.

## Limits and tests

Files are limited to 40 MB, embedded images to 5 MB, and rich HTML to 8 MB. PDF previews rasterize individual pages. Run `uv run pytest tests/test_documents.py` and `npx playwright test tests/ui/documents.spec.cjs` to exercise document operations and desktop/mobile navigation. The Playwright server uses an isolated test Documents directory; do not point it at personal files.
