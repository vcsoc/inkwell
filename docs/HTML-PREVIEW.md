# HTML email previews

HTML is the default preview format. Existing cached Microsoft/IMAP mail gets its HTML on the next eligible read-only folder sync (newest 200 messages). Older uncached messages still require opening/syncing their folders. Until HTML is available, Inkwell shows the text copy. Plain-text-only messages continue to display as text.

**Settings → Forms → Email preview format → Text — previous preview style** restores the previous safe text reader. Save the preference. Compose, replies and forwards remain plain text; this update does not add rich HTML composition or attachments.

## Privacy banner

Above the HTML body, Inkwell displays:

> To protect your privacy, Inkwell has blocked remote content in this message.

Its **Options** dropdown offers:

- Keep remote content blocked (also re-blocks a currently permitted view).
- **Load remote content** (always selectable for HTML, including messages with only CID inline images). HTTPS images from listed origins may contact the sender; available CID images are fetched read-only from the mail provider and re-encoded as inert PNGs.
- Load images from an individual listed origin by selecting it. The inline warning explains IP disclosure and open tracking; there is no second confirmation dialog.
- Use text preview for this view.
- Open preview settings.

Your explicit selection is persisted for **that individual message**, across reopening/reloading; it can be revoked with **Keep remote content blocked**. Permission is never silently granted to a sender or domain: a displayed From address is not reliable evidence of trust. Switching back to blocked cannot undo requests that already occurred.

## Text links

The **Text links** toggle in the reader toolbar is available for HTML and text previews. It starts off, supports keyboard Space and touch, and is labelled **Enable text links** for assistive technology. The tooltip describes its per-view permission and click-tracking risks. Enabling does not load images or navigate anywhere by itself. HTML links and up to 500 literal HTTP/HTTPS URLs in text can then open in your browser. Disabling it, reopening mail or rebuilding the reader revokes permission; there is no global trusted-sender link setting.

Only absolute HTTP/HTTPS URLs with normal ports and eligible DNS names are supported. Script/data/file/mailto URLs, relative links, credentials, literal IP hosts, localhost and common internal hostnames remain blocked. This is not a DNS-aware firewall: aliases and redirects cannot establish trust. Websites may track clicks or display phishing content. Do not treat link text as proof of identity.

Enabled links are visibly underlined, with a blue palette chosen for at least 4.5:1 contrast against the reader surface (black/white fallback for unusual custom colours). Hover strengthens the underline and keyboard focus adds an outline. This applies to HTML and text previews, including independent light/dark reader modes; sender HTML cannot remove the enabled-link underline.

Links use `_blank`, `noopener noreferrer` and no-referrer policy. Web/PWA opens an isolated browser tab; Electron denies new app windows and delegates eligible URLs to the system browser only while the trusted reader-toolbar link toggle is enabled. Microsoft sign-in links retain their separate allowlist. No URL is fetched by the backend and enabling links grants no scripts or app-origin privileges to email HTML.

## Security boundary

The backend uses **nh3** (an HTML5-aware sanitizer) with explicit allowed HTML tags, attributes and CSS properties. Mail is never inserted directly into the app's DOM. The preview is a separate authenticated HTML response in an iframe with an empty `sandbox` attribute by default (no scripts, same-origin privilege, forms, navigation privileges or popups). Enabling text links adds only `allow-popups allow-popups-to-escape-sandbox` to both iframe and response sandbox. Scripts, same-origin access, forms and top navigation remain forbidden. Its response also has a sandbox CSP, `script-src 'none'`, `default-src 'none'`, restricted inline styles, `base-uri 'none'`, `form-action 'none'`, frame-ancestor restrictions and no-referrer policy. The main app's CSP remains unchanged.

Initially image `src` attributes are removed, and the frame's `img-src` is `none`. Explicit opt-in permits only eligible HTTPS images from selected origins in that message; CSP restricts requests to those origins. Browser security tests observe zero initial remote requests and only selected image requests after opt-in, with no referrer. For Outlook CID images, a read-only MIME fetch occurs only after opt-in; allowlisted small raster attachments are re-encoded as static PNG data images. HTML mail cannot supply arbitrary data URLs or SVGs. If the provider is offline, those CID images remain blocked.

Only HTTPS images using the standard port and eligible hostnames/global IP literals are offered. Localhost/private IP literals, local/internal names, relative URLs, credentials in URLs, user-supplied data URLs, unsafe CID attachments and insecure HTTP images are not loaded. This validation is **not a DNS-aware firewall**; after permission the browser resolves/connects to the chosen hostnames. Loading images can disclose your IP, contact a tracking service and tell the sender the message was opened.

Scripts, forms, SVG/MathML documents, embedded frames/objects, CSS image URLs, external stylesheets, fonts, audio/video remain disabled even after image permission. Text links stay disabled unless separately enabled for the current reader view. Inline presentational styles are limited. Layout will not exactly match every newsletter. This is not an antivirus, a guarantee against all browser vulnerabilities, or a guarantee that an email's claims are trustworthy. Up to 50 eligible origins can be offered in one view; other resources remain blocked.

## Local storage and preservation

Schema **18** adds saved per-message image permissions and local meeting decisions (after HTML storage was introduced in schema 4). Raw HTML/text and tags are local plaintext data with the same private file permissions as the rest of the workspace, not encrypted email storage. HTML and text are capped at 500,000 characters each. IMAP uses its supplied text alternative where available; Microsoft Graph's text copy is derived from the HTML response.

IMAP remains read-only with BODY.PEEK, and Graph retrieval remains GET-only with existing Mail.Read permission. Downloading HTML, changing preview format, allowing image loads and editing tags never deletes, moves or marks server mail. Images do contact their hosts only when explicitly permitted. Existing local moves, read flags, stars and tags survive imports.

Older binaries cannot open a schema-18 workspace. Keep a consistent pre-upgrade backup and its vault key if rollback is needed; installing an older executable alone is not a data rollback.
