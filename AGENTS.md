# Local Review Workflow

- Connected mailbox edits must synchronize to the provider. Do not reintroduce a device-only/local-only opt-out or report unsupported operations as synchronized. Preserve authorization checks and explicit pending/failed status.

- After each completed application change, build and update the user's installed Inkwell app so they can test/review it. Source-only changes are not the end of the workflow.
- Use the managed per-user installer, preserve `~/.inkwell` and existing releases, and verify the installed artifact contains the changes.
- Do not force-close a running app or risk unsaved work. Tell the user when a relaunch is required to load the update.
- Report installation or verification failures explicitly; do not claim the installed app is current when only the source was changed.
