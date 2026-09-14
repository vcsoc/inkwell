# Security model

Inkwell is an early single-user local application, not an audited enterprise mail client.

## Boundaries

- The server binds to loopback. Host validation mitigates DNS rebinding. Adding remote hosts requires an explicit high-entropy access key and should be done only behind trusted HTTPS on a private network.
- Local-only browser bootstrap trusts the OS user. It does not protect against malware or other processes running as that user. The Electron shell supplies its own random access key and authenticates before loading the UI.
- API sessions use cryptographically random, process-lifetime tokens in HttpOnly, SameSite=Strict cookies. Remote HTTPS cookies also use Secure. Mutations require a matching Origin and custom request header. Cross-site fetch requests are rejected. Unlock attempts are rate-limited globally to 10 per minute; this is not distributed abuse protection.
- The desktop renderer has sandboxing, context isolation, no Node integration, no preload bridge, blocked new windows/external navigation, and denied permission requests.
- Email HTML is sanitized with nh3 using restricted tags, attributes and inline CSS properties, then served in a sandboxed, opaque-origin iframe with its own restrictive CSP. Scripts, forms, navigation links, embedded documents, remote CSS/fonts, media, data/CID images and CSS image URLs are removed or blocked. Remote HTTPS images are blocked by default and loaded only after explicit per-view/per-origin selection in the banner options (without a second confirmation prompt). There are no permanent sender exceptions. Allowing images reveals network information and may confirm a message was opened. No backend image proxy/fetch is used. UI interpolation (including tags) escapes user-controlled values; AI output uses textContent. See [HTML previews](docs/HTML-PREVIEW.md).
- CSP restricts scripts, styles and browser connections to the app origin. No analytics, CDNs, remote fonts or tracking scripts.
- IMAP requires implicit TLS; SMTP requires implicit TLS or STARTTLS. Certificate and hostname validation are enabled. There is no insecure fallback.
- Mail passwords and AI API keys use Fernet authenticated encryption. The key is stored in a local file, **not** an OS credential vault. This protects against accidental database-only exposure, not compromise of the data directory or running process. Other workspace data is plaintext SQLite. Use full-disk encryption.
- AI providers receive only prompts and explicitly selected context upon a user request. Local Ollama is supported. Remote endpoints must use HTTPS and redirects are not followed. No provider calls happen in the background. HTTP providers receive no tools. The optional official Codex CLI bridge is a separate advanced runtime: ephemeral temporary workspace, read-only sandbox, no approvals, ignored user config/rules, disabled shell/browser/apps/plugins/hooks and other capabilities. It still owns its authentication and operational files and is not an audited privacy sandbox. See [Codex boundaries](docs/AI-PROVIDERS.md). Prompt-injection instructions are treated as untrusted, but model output still needs human review.
- API error responses suppress provider exceptions that might contain secrets. HTTP access logging is disabled. Keep proxy logs private.

## Known risks

The authenticated user can configure mail servers and an AI endpoint reachable by the backend. This is intentional, and means a compromised paired device can access the entire single-user workspace and cause backend network requests. There is no multi-tenant or granular authorization boundary. Selecting Codex also lets a paired user invoke the backend OS user's existing Codex ChatGPT login and consume its subscription quota. Do not pair untrusted users. Provider/endpoint changes clear prior saved API keys, and adapter config/key reads are captured together to avoid cross-provider credential leakage.

Theme imports accept only validated colors, bounded sizes, names and enumerated options, never arbitrary CSS, scripts or remote resources. Presentation preferences are shared single-user workspace state.

Microsoft OAuth tokens are encrypted alongside other credentials; native inbox consent uses the official device flow with a publisher-configured public client ID or an advanced user-supplied registration. Inkwell never collects Microsoft passwords. Device tokens stay server-side, refresh tokens are rotated when provided, and Graph pagination cannot forward bearer tokens to another origin. The desktop permits only three fixed URLs to open in the system browser: `https://www.microsoft.com/link`, the legacy Microsoft device-login variants, `https://outlook.live.com/mail/`, and `https://outlook.office.com/mail/`. Query-string variations and other URLs are not allowed. The webmail links are external launchers, not native inbox connections; their sessions stay in the user's browser, with no cookies, passwords or tokens read by Inkwell. No other arbitrary external navigation is allowed.

No built-in registered Microsoft client, OS vault integration, message encryption at rest, device-specific sessions, automatic lock screen, independent audit, hardened internet-facing deployment, durable SMTP outbox, or guaranteed remote deletion exists yet. Request validation is not a substitute for proxy body-size/time limits. Email imports and AI responses can consume resources; use trusted providers and do not deploy as an open service.

Secrets must not appear in screenshots, bug reports, version control, URLs, or unencrypted backups. Remote access keys should be randomly generated, at least 32 characters, and never reused. Restarting the backend revokes session cookies; change the configured key too when revoking access.

## Reporting

Do not post credentials, private mail or exploit payloads containing personal data in public issues. Report privately to the maintainer of the repository through their available private security contact. This scaffold does not invent a monitored security inbox or promise a response SLA.
