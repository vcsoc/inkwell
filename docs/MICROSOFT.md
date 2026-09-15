# Outlook.com, Hotmail and Microsoft 365

## Read and send through Outlook webmail — no Inkwell application ID

Open **Settings → Mail accounts → Open Outlook.com webmail** for a personal Outlook.com/Hotmail account, or **Open Microsoft 365 webmail** for work/school mail. These open Microsoft's official webmail in your default browser (a new tab in browser/mobile clients). Sign in directly with Microsoft, then read, reply, compose and send there.

The same options are available in **Connect email → Quick setup → Microsoft webmail**. No Inkwell application ID, password, or saved local account is required. If your browser is already signed in to a different Microsoft account, switch accounts on Microsoft's site.

**This is a webmail launcher, not native mailbox integration.** Nothing is imported into Inkwell; its message list, collections, AI context and compose form cannot access this webmail session. Browser cookies stay in the browser, and Inkwell does not inspect passwords or tokens. Use Microsoft's sign-out controls to end the web session. Authentication and availability are controlled by Microsoft and your organization's policies; live sign-in has not been tested here.

Only the fixed URLs `https://outlook.live.com/mail/` and `https://outlook.office.com/mail/` are permitted by the desktop's external-link handler. Remote webmail is never loaded into the privileged local application window.

## Native Inkwell inbox integration

Native Microsoft connections use **Sign in with Microsoft**, not a password entered into Inkwell. The app now supports Microsoft's public-client device authorization flow and Microsoft Graph mail APIs. It reads your inbox and sends mail using delegated permissions; local calendar/contact features are not Microsoft-synced.

## Publisher-managed sign-in

Inkwell supports a bundled Microsoft application ID. When configured, users select Outlook.com or Microsoft 365 and click **Sign in with Microsoft**, without entering an application ID or password into Inkwell. Microsoft authentication still uses a device code and Graph; this does not yet reproduce Thunderbird's browser-redirect IMAP OAuth flow.

The distributed build is configured with Inkwell's public Microsoft application ID. Users are not asked for it. Unconfigured development builds explicitly report **Publisher setup incomplete**, with manual registration retained for advanced deployments. No Thunderbird ID or tokens are reused.

The publisher must sign into [Microsoft Entra](https://entra.microsoft.com/) and perform the registration below once for Inkwell. Supported account types must include organizational and personal Microsoft accounts. This requires an authenticated account with permission to register applications; it cannot be completed by an unauthenticated local build.

After registration, build with the public Application (client) ID:

```sh
INKWELL_MICROSOFT_CLIENT_ID='<Inkwell Application (client) ID>' npm run build:linux
```

The build validates and bundles this public identifier as `inkwell/oauth.json` in the frozen backend. Installed users do not need an environment variable. Source/server deployments can set the same variable at runtime; it overrides the bundled ID. Alternatively the publisher can put its public ID in `inkwell/oauth.json` before building. Never put a client secret, password, access token or refresh token there. A bundled registration takes precedence over user-supplied IDs for new connections; existing accounts retain the ID used to authorize them.

`GET /api/microsoft/config` reports readiness. With a publisher registration, `POST /api/microsoft/begin` accepts `{}` and resolves the ID server-side. Without one it fails clearly rather than pretending sign-in is functional. Test coverage uses mocks; a live publisher registration and end-to-end Microsoft sign-in remain unverified.

## One-time publisher prerequisite: a registered application

This early build does not ship an Inkwell-owned Microsoft application registration. You must supply an **Application (client) ID** from an app you or your administrator control. This is a public identifier, not a client secret, email address or password. App registration may require access to a Microsoft Entra tenant; a personal mailbox by itself does not necessarily let you register applications.

In Microsoft Entra → App registrations:

> If Microsoft says **“You can't sign in here with a personal account”**, the registration's account audience is wrong. Open the Inkwell registration, select **Authentication** (or **Manifest**), and change **Supported account types** to **Accounts in any organizational directory and personal Microsoft accounts**. In the manifest this is `"signInAudience": "AzureADandPersonalMicrosoftAccount"`. Save it, wait briefly for propagation, cancel the old Inkwell sign-in, and start a fresh one. Changing Inkwell's endpoint cannot override an organizational-only registration.

1. Register an app with supported account types **Accounts in any organizational directory and personal Microsoft accounts** if you need both Microsoft 365 and Outlook.com/Hotmail. Your tenant may restrict who can register apps.
2. Under **Authentication → Advanced settings**, enable **Allow public client flows**. Device authorization does not require a redirect URI or client secret.
3. Under API permissions, add **Microsoft Graph → Delegated permissions**: `User.Read`, `Mail.Read`, `Mail.Send`. The sign-in request also asks for `offline_access` so a saved connection can refresh tokens.
4. Grant/obtain administrator consent if your organization requires it. Conditional Access policies may block device-code flows; Inkwell cannot bypass organizational policy.
5. Copy the **Application (client) ID** from Overview.

Never create or paste a client secret into Inkwell. Documentation references: [Microsoft device authorization flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code), [Graph mail APIs](https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview).

## Connect

1. Settings → Mail accounts → Connect email → **Outlook.com / Hotmail** or **Microsoft 365**.
2. Click **Sign in with Microsoft**. The distributed build does not request an application ID. Unconfigured development builds show an explicit setup-incomplete notice and require an advanced manual registration.
3. Open the Microsoft link shown by Inkwell (currently `https://www.microsoft.com/link` for personal accounts; Inkwell uses Microsoft's exact allowlisted response rather than substituting the older device-login URL) and enter the displayed code. Only enter codes you generated yourself; never authorize a code sent by an unsolicited message.
4. Authenticate directly with Microsoft and review the requested permissions. Inkwell never sees your password or MFA answers.
5. Leave the Inkwell form open while it waits for approval. When authorization completes, Inkwell immediately imports the latest inbox messages and opens the Inbox. Inkwell also performs a background inbox refresh when a connected client starts; use **Sync** to refresh manually at any time.

Inkwell sends Outlook.com/Hotmail through Microsoft's `consumers` authorization endpoint and Microsoft 365 work/school through `organizations`, preventing the wrong account class from being selected. The registration itself must still allow the selected class.

The account identity comes from Microsoft's `/me` profile, not from a typed email field. Closing the form cancels further polling; an authorization already completed at Microsoft cannot be undone just by closing the form. Restarting Inkwell cancels pending sign-in flows, so start again if needed.

## Storage and transport

Access and refresh tokens are stored in the local encrypted credential field. Tokens refresh before expiration. OAuth tokens/device secrets are never returned to the browser. Device codes stay in process memory only; polling respects Microsoft's interval and slow-down responses.

The Microsoft connection uses Graph rather than IMAP; this is intentionally invisible in the normal Inkwell workflow. Quick sync imports up to 200 inbox/current-folder messages. Resumable background delta synchronization downloads the discovered folder hierarchy and checks for changes about every 15 seconds while open; this is not push delivery. See [Background sync](BACKGROUND-SYNC.md) and [Mail workspace](MAIL-WORKSPACE.md). Import uses immutable IDs, retains HTML alongside a text alternative, sanitizes previews and deduplicates retained local copies. Nullable and malformed sender headers are tolerated. Attachments are not downloaded. Read flags, stars and folders are still local-only after import. Next-page URLs must remain on the Graph origin; tokens are not forwarded to arbitrary URLs.

Send uses `/me/sendMail`; accepted messages are saved in Microsoft's Sent Items and also in Inkwell's local Sent folder. A network failure can still leave submission uncertain, so check the provider before retrying. Shared mailboxes, server folder management, calendar/contacts sync and attachment management are not implemented.

Disconnecting removes local credentials and that account's local messages. Revoke the application grant through Microsoft's account/privacy or organization application settings if you also want to revoke consent. If tokens are revoked or policy changes, reconnect the account.

Existing IMAP/SMTP accounts are preserved by the additive schema-version-1 migration. Back up the entire `~/.inkwell` directory with Inkwell closed before major upgrades.

## Verification

Device authorization, pending/slow-down/expiry/cancel behavior, encrypted storage, refresh rotation, Graph inbox import, sending and pagination token isolation are tested with mocked Microsoft responses. The user's connected account successfully imported 200 Inbox messages. Live read-only folder discovery also verified 33 folders, including 23 nested folders, without changing the original workspace. Live sending has not been exercised.
