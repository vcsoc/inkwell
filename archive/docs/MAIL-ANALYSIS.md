# Local Mail Analysis (Experimental)

Open **Settings > Mail analysis** after relaunching the updated application.
Analysis is initially off. The **Background analysis** slider at the far right of
**Local mail analysis** applies immediately, as does the checkpoint selector. Existing cached messages are not automatically
backfilled. **Analyze existing mail** explicitly starts a resumable snapshot scan;
Pause stops queued backfill work after the current bounded batch, while newly
incoming mail can still run. Resume continues the saved scan and pending work.

The initial catalog contains Invoice, Receipt, Action required, Meeting, Delivery,
Newsletter, Project, Customer, Cold lead and Hot lead. Descriptions (preferably
short yes/no questions), thresholds, enabled categories and the selected Laya
checkpoint are configurable. **Tag catalog** provides an inline-editable table
with Add/Remove, per-row enabled sliders and **Save analysis settings**. Up to
50 definitions are supported, independently of the 12-tag message limit. Removing
or renaming a definition does not remove or rename tags already on messages.
Enabling the feature adds these catalog entries,
not tags on messages. Rename/descriptions should reflect the user's business:
Project and Customer cannot reliably infer private relationship context that is
not present in the message itself.

## Review, Not Automatic Application

All predictions are suggestions. Model scores are not measured accuracy or a
calibration guarantee. There is deliberately no automatic-application setting.
Suggested tags start unchecked: select only the tags you actually confirm, then
Apply selected tags. Multiple tags can be selected. View message opens the full
email for review; return to Mail analysis to accept or dismiss the suggestion.
Dismissing never changes mail. Every scored, enabled tag is selectable, even below
its threshold; all choices start off. **Below thresholds** results can also be
manually approved. Unknown or unscored tags remain rejected. Existing manual
tagging remains available separately.

The full-width dashboard shows actual cached-mail tag usage bars (case-insensitive
unique-message counts per tag, not prediction counts), snapshot progress and
remaining/unqueued work, plus live queue and failure counts. Tag totals can overlap.
Help is available through keyboard-accessible, viewport-confined tooltips rather
than long explanatory paragraphs. All binary controls use sliders.

Approval atomically unions selected tags with current manual/provider tags. It
uses the existing `provider_sync.enqueue_tags` path, preserving authorization,
category deltas and pending/failed provider status. Unsupported IMAP writes and
missing Microsoft write permission fail without modifying local message tags.
The Applied view distinguishes provider pending/running/failed/done states from
local-only messages and already-present tags; it never claims unsupported writes
were synchronized. Content/catalog changes invalidate old results. The existing
12-tag message limit still applies, without displacing manual tags.

## Runtime And Privacy

Laya runs in a separate managed per-user CPU environment, not in the frozen mail
server. The local environment on this machine is
`~/.local/share/inkwell/laya-runtime`; the interpreter is resolved under
`$XDG_DATA_HOME` when set. Model weights are cached under
`$XDG_CACHE_HOME/inkwell/laya` (normally `~/.cache/inkwell/laya`).

The environment installed for development uses this local Laya checkout's 0.4.13
package, CPU PyTorch and its dependencies. For another machine, an explicit setup
is:

```sh
uv venv --python 3.13 ~/.local/share/inkwell/laya-runtime
uv pip install --python ~/.local/share/inkwell/laya-runtime/bin/python --torch-backend cpu laya==0.4.13
```

The app installer does not silently install this large optional environment.
Settings reports a missing runtime and queue failures explicitly. Model downloads
may contact Hugging Face; inference never sends email to a hosted model service.
The reviewed checkpoint revisions in Laya are used. English is the default;
Multilingual is available experimentally and needs its own accuracy validation.

Startup, status, settings and queue discovery do not import Laya/PyTorch, load
weights or perform model downloads. A separate low-priority subprocess is started
only for a batch of at most four queued messages. It uses two CPU threads and one
checkpoint, scans bounded overlapping token windows, and exits after that batch,
releasing its model memory immediately (more conservative than an idle timer).
Cold starts trade throughput for lower idle memory. No shared model server is
stopped or reconfigured. The runtime/weights currently occupy approximately 2.5 GB
on disk; disk cache is not resident model memory.

The classifier receives subject, sender and cleaned text, not attachments. Common
English reply-history markers and quoted lines are omitted. Bodies over 24,000
characters use a bounded beginning/end excerpt and show a shortened-message warning.
Email is untrusted data. The child has no mailbox tools or mail API credentials in
its environment. Its only accepted output is a bounded map of predefined category
names to finite numeric scores for the claimed message IDs. It cannot execute a
model response, delete/forward/reply to mail, or open links. Model prompt text is
not a security boundary: adversarial email can still influence suggestions, which
is another reason human approval is mandatory.

## Durability

Schema 22 adds cascading `mail_analysis_jobs` and insert/content-change triggers.
Eligible newly downloaded mail is enqueued in its ingestion transaction without
running inference under the mailbox transaction. Drafts, Sent, Trash and demo
messages are excluded. Backfill has durable scan IDs and an incoming/backfill job
origin, so paused old-mail work does not block live mail. Incoming jobs take
priority. Rejected/already-analyzed jobs are not duplicated by another backfill.

The worker claims at most four jobs in a short transaction, releases the database
before inference, then validates message fingerprints and current catalog before
publishing results. Queue failures pause further inference until Retry failed
analysis. Normal shutdown/disable cancels the child and returns interrupted work
to pending. Abruptly interrupted claims have a 15-minute recovery lease. A model
batch has a ten-minute timeout and forced termination fallback. No message text
or model stderr is persisted in application diagnostics.

## Verification And Accuracy Limits

`tests/test_mail_analysis.py` covers queue opt-in, multi-label review, manual-tag
preservation, provider authorization and durable jobs, unsupported-provider
rollback, catalog/content races, no-match results, paused/resumed backfill,
shutdown, output validation, CSRF and isolated subprocess cancellation.
`tests/ui/mail-analysis.spec.cjs` exercises desktop/mobile configuration, escaped
untrusted mail, explicit tag selection, backfill controls and synchronization
status. Routine tests mock inference and provider writes; they never load models
or submit real email.

A separate explicit real-model check uses only the synthetic fixture:

```sh
HF_HUB_OFFLINE=1 .venv/bin/python scripts/benchmark-mail-analysis.py --run-local-model
```

The initial 12-example English check with the default 0.80 thresholds produced
9 correct positive labels, 8 false-positive labels and 5 missed labels. This is
a tiny synthetic smoke corpus, **not** representative mailbox accuracy or
threshold calibration. The multilingual smoke also produced strong false
positives. These results do not justify automatic tagging. Tune descriptions and
validate per-category thresholds on representative, consented examples before
considering automatic application in a future version. No real mailbox content
was used for this evaluation and no provider writes were performed.
