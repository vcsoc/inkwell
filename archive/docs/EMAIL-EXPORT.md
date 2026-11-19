# Saving email files

On the desktop, drag the **file icon at the left of a message row** to a folder in your file manager. It exports an `.eml` copy; it does not remove or move the message in inkwell or Outlook. **Alt-dragging the row** also exports. Ordinary row dragging still files messages inside inkwell. If the dragged message is checked, the checked selection is exported (up to 50 messages, 8 MB per file and 64 MB per batch). Otherwise just that message is exported. Keep inkwell open until the drop completes.

Clicking the file icon downloads one file. In browser/mobile views, or as a keyboard alternative, use the message menu → **More actions → Save email file (.eml)**. Your browser/OS handles the destination and any existing-file conflicts. In table layout the avatar/file icon may be hidden; use Alt-drag or the menu.

## What is preserved

Exports reconstruct RFC email MIME from **cached** From, To, Cc/Bcc, Subject, Date, text and available HTML. Unicode content and multipart alternatives are encoded. Filenames are sanitized and include the local message ID. Header control characters cannot inject additional fields. The original cached record, flags, provider identity and rules are unchanged.

This is **not the original wire message**: original transport/threading/signature headers, attachments and CID resources are unavailable. `X-Inkwell-Export` identifies the reconstruction. Exported HTML is the cached source, not the in-app preview: the receiving mail client controls its scripts, remote content and privacy. Do not assume inkwell's preview protections apply outside inkwell.

## Desktop boundary

`GET /api/messages/{id}/eml` is authenticated, read-only and no-store. It performs no provider operation. The sandboxed, context-isolated renderer has no Node integration. Its preload exposes only preparation by message IDs and drag by an opaque token. The main process rejects subframe/foreign-origin requests, fetches only the fixed authenticated loopback export endpoint, and supplies native file drag paths itself. Renderer-supplied filesystem paths and arbitrary URLs are never accepted.

Preparation stages private files in `.email-export-cache` under the configured workspace (directory 0700, files 0600). Partial failures remove their batch. Generated staging files are cleared on normal quit and the next startup; a forced crash can leave private staging files until the next launch. Actual exported copies at the user's chosen destination remain there. A file-manager copy/move applies only to a staging file, never to the SQLite mail record.
