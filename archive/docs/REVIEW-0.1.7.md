# Inkwell 0.1.7 local review build

This is an **unsigned Linux x86_64 test build**, not a published GitHub stable release. It adds the Documents workspace to the Calendar/mail UI changes since 0.1.6. See [Documents](DOCUMENTS.md) for format support and known limitations.

## Install and try

1. Quit Inkwell. Back up your important documents before testing rich-document round trips; PDFs create new copies, but saving a DOCX, HTML or text file overwrites that file after an external-change check.
2. From the repository, verify `sha256sum -c dist/SHA256SUMS`, then run `sh dist/inkwell-0.1.7-linux-x64.run` as your normal user (not root). Installing switches the active managed version; it does **not** delete prior installed releases or your settings.
3. Open Inkwell → **Settings → About** to confirm version **0.1.7**, then open **Documents** from the left icon rail or mobile tab. Use ☰ to reveal the tree on narrow windows.
4. In a **test subfolder under Documents**, create a Markdown note, edit it, save with Ctrl/Cmd+S, reopen, and try its Markdown preview. Create a DOCX with headings, bold text, a table and an image; save, reopen and inspect its layout.
5. Open a **copy of a non-sensitive PDF**. Preview pages, draw a redaction rectangle, apply it, and verify the redacted content is absent in the new `.redacted.pdf` while the original remains unchanged. Try drawing/importing a signature image and running compression on a copy. Use a disposable certificate to try PKCS#12 digital signing; check the signed output in an independent PDF viewer.

The installer is self-extracting and checksum-verified, but not cryptographically signed. PDF redaction is irreversible in its output copy. Digital signature trust depends on the certificate issuer. Legacy DOC/ODT/RTF editing requires LibreOffice installed separately; packaged availability has not been verified. No release was automatically published or installed as part of packaging.
