# Inkwell 0.1.20 — local inline translation

Highlight text, right-click **Translate**, and choose a language. The translation replaces that passage inline, with a small **original** / **translated** toggle.

- Received HTML/text email previews, composed email bodies, Word/rich documents and plain-text/Markdown editors.
- Selectable PDF text translates through a reversible view overlay; original PDF bytes remain untouched. No OCR for scanned PDFs.
- Bundled, checksum-pinned CPU llama.cpp runtime; explicitly confirmed 2.5 GB Qwen3-4B-Instruct-2507 Q4_K_M model download. No external model server, API key, cloud fallback or use of your configured assistant.
- Thirty target languages, including Afrikaans, French, German and Spanish. Translation quality varies: review names, amounts, dates and important wording.
- Bounded 2,000-character selections, one inference process per backend, limited CPU/memory batches and a three-minute inference deadline. CPU speed/load determine latency; busy systems can take a minute or more.
- Draft autosave and document saves include only currently displayed wording, never pill labels/hidden originals. Toggle history lasts for the current editor/view, not across reopening saved documents/drafts.
- Preserves inline original formatting, draft newlines and undo/redo; edited passages and late results never overwrite your changes. Closing setup cancels automatic translation even when the weights download continues.
- HTML mail keeps its opaque-origin sandbox, sender-script stripping and independent remote-content consent. Only the fixed nonce-authenticated translation bridge can execute, with frame/capability/request checks and application acknowledgements. Model markup is literal text.

## Verification

- 355 Python tests passed; 3 existing dependency warnings. Final rerun used a 90-second per-test allowance on a busy host (rather than the standard 30-second test allowance).
- 109 targeted desktop/mobile UI tests passed, 1 skipped: translation, Documents, reader isolation, Settings and footer. Final UI runs used slower-host navigation/action/expectation allowances; assertions were unchanged.
- Real Qwen3 CPU inference checked with French, Afrikaans and Spanish synthetic text; final pruned runtime/low-memory flags also passed a real French API check. These are smoke examples, not an exhaustive language-quality assessment.
- Source desktop smoke and native bridge tests, formatting, syntax and Ruff checks.
- Packaged/installed verification and asset checksums are recorded during release installation.

See [Local translation](TRANSLATION.md) for setup, cache/RAM requirements, paired-browser behavior, limits and saving semantics. Existing mail/calendar write-consent and workspace/PDF protection boundaries remain unchanged.
