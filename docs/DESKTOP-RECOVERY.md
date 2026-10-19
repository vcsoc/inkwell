# Desktop service and display recovery

The desktop window no longer quits merely because the bundled mail service exits.
The supervisor starts the replacement service on the same loopback port, unlocks it
with the existing launch key, and updates the HTTP-only session cookie. It does not
reload a healthy display: the open editor, unsaved text, selection and navigation
remain in memory. Draft autosave retries after reconnection. Native email exports
and attachment opens also use the renewed session.

A compact status message appears while reconnecting. Recovery allows five attempts
within five minutes, with exponential backoff, to prevent a tight crash loop. If
that budget is exhausted the window stays open with **Retry connection**. Explicit
retry resets the budget. Quitting cancels recovery and terminates the service.
Interrupted server operations retain their existing durable queue/retry semantics.

If the renderer itself crashes, the desktop reloads the display. Saved mail and
saved drafts remain in the workspace; text not yet autosaved before a renderer
failure cannot be guaranteed. After three automatic reloads within five minutes,
a native dialog offers Reload or Close rather than repeatedly crashing unnoticed.
The sandbox and web-security protections remain enabled.

## Local diagnostics

`~/.config/inkwell/logs/desktop.log` records desktop start/exit, backend process IDs,
exit codes and signals, reconnection states, exception types and traceback frame
locations, and renderer/GPU exit reasons. The log uses private permissions, rotates
at 1 MiB and retains one previous file. It does not upload reports or persist mail
bodies, authentication keys, session cookies, request URLs or exception messages.
Log-write failures must not interrupt the application.

The original reported disappearance on 2026-10-19 had no Inkwell core dump or OOM
entry and no retained application log. Its precise trigger remains unconfirmed.
These changes correct the confirmed unconditional-quit failure path and add
recovery/diagnostics; they do not prove a particular native crash mechanism.

## Regression evidence

`npm run test:desktop` includes `tests/desktop-recovery.cjs`, which runs in a fresh
temporary workspace/profile, never the user's mailbox. It kills the real backend
six times, including exhausting the automatic retry budget and clicking Retry,
checks that cookies change while the document and open draft remain, verifies
autosave and native email export after recovery, then force-crashes the
renderer and verifies reload plus saved-draft survival. The same test runs against
the installed executable with `INKWELL_TEST_EXECUTABLE`.

`tests/backend-supervisor.cjs` covers spawn failures, startup timeout, authentication
failures, unexpected clean exits, bounded repeated crashes, explicit retry,
quit-during-recovery and diagnostic privacy. `tests/diagnostics.cjs` checks private
file permissions, rotation and filesystem-error tolerance. The browser autosave
test also verifies retry on the desktop reconnection event.
