# Inkwell 0.1.21 — sync status and workspace recovery

- A static underline beneath the inkwell wordmark appears during active mailbox sync. It clears at completion, including with reduced motion enabled. The footer still reports queued work, provider errors, and retry delays.
- Sync status requests run one at a time and keep polling even if a mailbox refresh stalls. If status is temporarily unavailable, the footer says so and retries automatically.
- A stalled folder load now times out with a Retry button instead of leaving the workspace on its loading screen. A background sync refresh cannot supersede a folder you are opening.
- The worker publishes idle status only after releasing the shared sync lock.

No workspace migration or change to provider write authorization is required.
