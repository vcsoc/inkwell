# Composer Attachments And Inline Images

Every composer entry point (new messages, replies, forwards and resumed drafts)
uses the same attachment controls. Attach files keeps the originals as regular
attachments; Insert image, dropping raster image files onto Message, or pasting
clipboard image files embeds them at the insertion point. Text on either side of
a drop is preserved. Supported inline formats are PNG, JPEG, GIF and WebP.
Other file types, including SVG, remain ordinary attachments.

Select an inline image to expose its width control, bottom-right drag handle,
Crop image and Remove image. Resizing locks the aspect ratio and stores actual
HTML width/height attributes. Cropping supports dragging a rectangle or entering
pixel coordinates; Apply crop creates new PNG pixels, not a CSS mask. Cropping
an animated image produces a still PNG. Cancel crop preserves the original.
Images and attachments autosave with the draft and return when it is reopened.
The body fills the remaining composer height; narrow inline composers use a
viewport-filling overlay that preserves the bottom navigation for autosave-on-leave.
On short windows the envelope fields can scroll separately.

## Writing Surface

The compact envelope keeps Account and From on one row, To/Cc/Bcc together,
and Subject immediately below. Sender information is expandable; unavailable
senders and failed sender lookups expose the explanation rather than hiding it.
Attach files, Insert image and Format share a small toolbar. Format exposes
working bold, italic and underline controls. A bounded-width writing surface
fills the remaining height, with autosave and delivery actions anchored below.
The layout follows the selected light/dark palette and application zoom.

When the mail workspace has at least 960 logical pixels available, the message
list stays visible beside new messages, replies and forwards. Inline forms use
a two-column workspace; popup forms dock on the right without blurring the list.
The list retains 280-400 pixels and uses compact rows without changing the saved
Cards/Table preference. All four mail layouts are supported. Resizing or changing
application zoom switches back to the normal narrow composer when needed, without
recreating the editor or losing attachments. Clicking another message autosaves
before closing the composer and opening that message.

Replies and forwards share one quote builder across reader and context-menu
entry points. Imported leading/trailing padding, empty quote markers and repeated
blank separators are compacted before quoting. Paragraph separation and meaningful
indentation remain intact; repeated replies do not grow blank spacer lines.
There is one writable line before the history, and reply/forward focus starts
there. Received messages and intentional spacing typed into drafts are unchanged.
Textarea values are restored explicitly to avoid HTML parsing discarding their
first newline.

## Storage And Delivery

Schema 21 adds a cascading `outgoing_files` record for each locally composed
message. Sanitized HTML uses CID references; attachment bytes are not embedded
in stored HTML. Draft revisions protect both text and attachments. Local Sent
copies retain downloadable files, paperclip indicators and safe inline previews.
The existing reader's explicit embedded-image permission still applies.

The combined file limit is 20 MiB and 50 files, subject to the mail provider's
own limits. Inline images additionally have bounded, verified raster dimensions.
HTML cannot load arbitrary images, scripts or event handlers in the composer.
HTML pasted or dragged from elsewhere is inserted as plain text; use an image
file or clipboard image to embed a web image rather than a tracking URL.

SMTP sends a plain-text alternative plus HTML/related CID images and ordinary
MIME attachments. Outlook sends Graph file attachments with HTML and matching
content IDs. Payloads too large for a single Graph send use a provider draft,
small attachment posts and chunked upload sessions, then explicitly send it.
Upload URLs are restricted to HTTPS Microsoft mail hosts, with redirects disabled
and no bearer token sent to preauthorized upload URLs. A failed upload attempts
to remove only its unsent provider draft. An uncertain send is never retried or
deleted automatically. The local draft is removed only after provider acceptance.

Forwarding opens the existing quoted-text composer; these controls add new files.
This change does not automatically copy attachments from the original message.

## Verification

`tests/test_outgoing.py` covers validation, size limits, draft persistence,
revision conflicts, cascading cleanup, safe CID previews, local downloads,
MIME structure, Graph inline payloads, large uploads and failed-upload cleanup.
`tests/ui/composer-media.spec.cjs` covers draft recovery/removal, drop placement,
corner and numeric resizing, actual cropped pixels, full-height desktop/mobile
layouts, compact light/dark envelopes, both reply/forward entry points,
formatting without spacing loss and outgoing send payloads.
`node --test tests/composer-quotes.cjs` covers repeated quoting and whitespace
preservation. Provider submissions are mocked: these tests
do not send real email.
