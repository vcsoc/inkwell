# Sending addresses and aliases

Open **Settings → Mail accounts → Sending addresses** for the relevant account. Choose its default From address, add other aliases you own (one per line), and save. This changes only local Inkwell settings, not your Microsoft primary alias or server configuration.

The composer separates **Account** (connection/authentication) from **From address** (requested outgoing identity). New messages preselect the account's saved default. Drafts retain the selected address even if the default changes later. An unavailable saved choice stays visible as unavailable and sending is rejected; it is not silently replaced. Replies use the sending account's default unless you select another configured address.

**Refresh Microsoft addresses** performs a read-only Graph `/me?$select=mail,proxyAddresses` query. Only SMTP addresses are listed; contact addresses, recipients, display names and past messages are not treated as send-as authorization. Microsoft personal accounts may return no `proxyAddresses` list. In that case, manually enter aliases shown in your own Microsoft account. Provider-listed/configured addresses are not a guarantee of send-as permission.

Graph submissions now include an explicit `message.from.emailAddress.address`, even for the account's normal address. OAuth still authenticates the original connected account. SMTP likewise uses the selected From identity without replacing the login username or credentials. Neither transport automatically retries using another sender. Unconfigured/removed choices fail before submission.

Provider policy can reject or rewrite alias identities. A Graph 202 response confirms submission, not final delivery or the recipient-visible From header. Verify the actual From in the first ordinary message sent using an alias; Inkwell does not send unattended test messages. Local Sent copies record the **requested** From address and are not delivery receipts. Configuring an alias cannot grant Microsoft Send As/Send on Behalf permissions.

## API and storage

- `GET /api/accounts/{id}/senders`: cached/configured choices and default.
- `PUT /api/accounts/{id}/senders`: `{default_from, additional_addresses}`.
- `POST /api/accounts/{id}/senders/refresh`: read-only provider discovery, preserving manual choices.
- Draft/send payloads include optional `from_address`; new clients always supply the selected address when sending.

Settings are bound to account ID, provider and connected email to prevent cross-account reuse. Drafts use their existing `sender` field for the selection; legacy `Me` drafts resolve the default when opened. No schema change or credential migration is required. Discovery failures preserve previous choices. Alias settings never expose decrypted credentials.
