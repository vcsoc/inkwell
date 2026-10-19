# Rule execution and priority

**Mail rules** opens directly from the bottom of the application rail, outside Settings. Direct visits default to all cached folders; the message context-menu entry defaults to the clicked message. The Rule Manager provides a shared **Run on** scope: the current message (when opened from mail), the current/chosen folder, or all cached folders. Folder scope means that exact local view, including all matching cached records regardless of the mail search or quick filters; it excludes subfolders. Inbox is the aggregate local Inbox view. Virtual collections are not folders: choose a concrete folder or all cached folders instead.

- **Save rule** only saves the configuration for future imports.
- **Save and run** saves, then runs only that rule against the chosen scope. For message scope the button reads **Save and apply to this message**.
- **Run saved rule** executes its persisted configuration, without saving or discarding current editor changes.
- **Run all enabled rules** executes the saved enabled rules in displayed priority order against the chosen scope. It can be used at any time; no timer or arrival is required.

Save and execution are separate transactions. A failed run does not lose the saved rule; retry updates that same rule rather than duplicating it. An explicit individual manual run can execute a disabled saved rule without changing its Enabled setting; automatic imports and Run all enabled rules still skip disabled rules. Manual runs include already locally filed incoming copies, including local Trash. Drafts, known sent copies, and trashed outgoing copies remain protected. Explicit single-rule runs override remembered Not Junk filing without forgetting the sender. Automatic imports and Run all enabled rules retain Not Junk protection. Manual-run action failures (including missing provider consent or tag overflow) are reported and roll back the entire run; the saved rule remains available. Results show matched messages, eligible messages and protected copies skipped, not a count of individual actions.

## Context menu and destinations

**Apply rule…** on a message opens a new, unsaved form seeded from that message, even when saved rules exist. It never implicitly selects the first saved rule. Nothing is created or executed merely by opening the page. To use an existing rule, explicitly select it from the list and click **Run saved rule**; message scope retains the clicked message. **Create from this message** returns to the message-seeded form. For a new rule, Run saved rule remains disabled until it is saved. A run still checks conditions, exclusions and protected-copy rules; it does not force unmatched actions.

Move destinations use a search/autocomplete input, not a dropdown. Type a folder name/path, select a suggestion, or use arrows and Enter. Exact unique matches and a single remaining match on blur autoselect; ambiguous names require selection and unmatched text cannot be saved. The stored value remains the stable folder ID. Tag actions keep their catalog selector.

## Stop and ordering

Rules execute from top to bottom. Each rule has **Stop processing further rules after this rule matches**. Turn it off to continue with later matching rules. Later conditions see earlier rules' tag/read/star/move results. Each rule executes at most once per copy in a pass; a later move can replace an earlier destination. Disabled, nonmatching and unsafe Not Junk rules are skipped and do not stop the chain. Automatic imports also skip invalid-resource and overflowing-tag rules; explicit manual runs report those failures instead. Actions of an individual rule are planned before writing, so it cannot partially apply.

Existing rules and new rules default to Stop enabled, preserving previous first-match behavior until deliberately changed. Drag a rule's name before/after another row: an insertion line previews the priority change, and only dropping commits it. Move up/down buttons on the selected row offer keyboard/touch alternatives. Search filters only the list, not execution priority. Reordering keeps editor changes, IDs and configurations intact and does not itself run rules. New and duplicated rules append to the order.

Scope candidates and priority are snapshotted in one immediate SQLite transaction. Moving messages during a folder run cannot cause repeated processing or pull new messages into that run. Outlook moves, read/star changes and tag/category updates always queue to the provider. Workspace folder destinations are created in the same mailbox automatically. Unsupported IMAP mutations are blocked; they do not silently diverge from the server. Server rules and credentials are not changed, and uncached history cannot be processed. There is no scheduled age-based execution or automatic sending/deletion.

## API and compatibility

Schema **13** adds `mail_rules.position` and preserves existing ID order. `stop_processing` is stored in rule JSON, defaulting to true for legacy configurations. Older builds must not open this schema; restore a compatible backup and matching vault key to downgrade.

- `POST /api/rules/reorder`: `{id, target_id, placement: "before" | "after"}`. Revalidates both IDs under the transaction; moves one rule without overwriting concurrent configuration changes.
- `POST /api/rules/run`: `{rule_id?: number, scope: "message" | "folder" | "all", message_id?: number, folder?: string}`. Omitting `rule_id` runs all enabled rules. Returns `{matched, scanned, eligible, skipped}`.
- Folder keys are `inbox`, `archive`, `trash`, `sent`, `drafts`, `local-N`, or `remote:N`.
- Legacy `/api/rules/apply` retains its conservative unmanaged-import-only selection for API compatibility, but now honors priority and Stop. The UI uses `/api/rules/run` for explicit scoped reruns. `/api/rules/{id}/apply-message` remains supported.
