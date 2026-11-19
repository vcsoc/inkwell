# Testing Inkwell on your phone

## What the mobile app is today

A responsive, installable PWA. It shares your desktop/server workspace over authenticated HTTPS. It does **not** run Python or connect to IMAP directly on the phone. Your private server must remain online. No mail or credentials are deliberately cached by the service worker; when offline, it displays a reconnection screen.

Browser storage behavior is not a guarantee of forensic erasure. Protect the device with its OS passcode.

## Recommended: private HTTPS connection

Use a trusted private VPN / HTTPS reverse proxy. Do not expose an unauthenticated local-only process. Run the backend directly (not `npm run desktop`, which creates a separate random port and session).

1. Generate a strong access key:

   ```sh
   uv run python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

2. Set environment variables before starting. On Linux/macOS:

   ```sh
   export INKWELL_ACCESS_KEY='paste-your-generated-key-here'
   export INKWELL_HOSTS='inkwell.your-private-domain.example'
   uv run python -m inkwell
   ```

   Windows PowerShell:

   ```powershell
   $env:INKWELL_ACCESS_KEY = 'paste-your-generated-key-here'
   $env:INKWELL_HOSTS = 'inkwell.your-private-domain.example'
   uv run python -m inkwell
   ```

   `INKWELL_HOSTS` is an exact comma-separated host allowlist, without scheme or port. Extra hosts require a key of at least 32 characters. Never use a predictable example key.

3. Configure your HTTPS proxy on the same machine to forward to `127.0.0.1:8765`, preserving Host and sending `X-Forwarded-Proto: https`. The backend trusts forwarding headers **only from 127.0.0.1**. For example, with Caddy and a domain/certificate you control:

   ```caddyfile
   inkwell.your-private-domain.example {
       request_body {
           max_size 2MB
       }
       reverse_proxy 127.0.0.1:8765
   }
   ```

   This is an example, not automatic DNS/certificate setup. Ensure the phone trusts the certificate. Prefer VPN-only reachability; internet exposure has not been audited. Configure proxy timeouts of at least 90 seconds for AI requests, and longer for mail imports. Do not log request bodies, cookies, authorization headers or keys.

4. Visit `https://inkwell.your-private-domain.example` on the phone and enter the access key. Never send this key to anyone else. The app sets an HttpOnly, SameSite=Strict session cookie (Secure on HTTPS). Keys are not put in URLs.
5. Install:
   - **iPhone/iPad:** Safari → Share → Add to Home Screen.
   - **Android:** Chrome → menu → Install app / Add to Home screen.
6. Connect mail or explore the demo. Rotate the key and restart the backend to revoke **all** remote sessions. Individual device revocation is not yet implemented.

For single-device desktop/browser testing, leave both remote variables unset and use the loopback URL. Do not bind Uvicorn to `0.0.0.0` to bypass this setup.

## Android USB development option

If you already use Android developer tools, you can avoid network exposure entirely:

```sh
uv run python -m inkwell
# In a second terminal with an authorized USB-connected phone:
adb reverse tcp:8765 tcp:8765
```

Open `http://127.0.0.1:8765` in Chrome on that phone. Localhost is a secure browser context, so installability can be tested. This is a development workflow, not persistent production hosting. Remove the forwarding when finished:

```sh
adb reverse --remove tcp:8765
```

## Standalone native mobile roadmap

A real standalone mobile implementation needs an on-device database and credential vault (Keychain/Keystore), OAuth browser flows with PKCE, platform mail transport or a scoped sync service, durable offline/outbox reconciliation, notification infrastructure, and native background-task scheduling. Wrapping the current UI alone would not implement these capabilities. None are claimed as complete here.
