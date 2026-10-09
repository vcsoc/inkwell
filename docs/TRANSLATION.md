# Local inline translation

Select/highlight text, right-click **Translate**, then choose a language. The selected passage is replaced inline; surrounding text is left alone. The small **original** pill after it switches to the original, and **translated** switches back. The menu supports arrow keys, Enter and Escape, and a scrollable language submenu on narrow screens.

Supported surfaces:

- **Received email:** HTML and text previews. Translation changes this view only, not the cached original, provider message or sender's HTML. Image/link permissions do not change.
- **A message you are writing:** plain-text draft bodies. After the first translation the editor supports a real inline pill while remaining plain-text for autosave and sending. Only the currently shown wording is saved/sent; pill labels and hidden originals are excluded. Translation does not send mail. Editable translation insertion supports Undo/Redo.
- **Documents:** Word/rich documents and plain-text/Markdown files. Translations mark the editor dirty; Save keeps the currently shown wording and excludes translation controls. Original inline formatting is retained for the toggle. Late results never overwrite edits made while inference runs.
- **PDFs with selectable text:** a selectable text layer and reversible translation overlay, without modifying PDF bytes. Original restores the underlying page view. Scanned image-only PDFs need OCR first; OCR is not provided. Text staged with the PDF text tool can also be translated; Apply still creates a separate PDF copy.

Original/translated toggle history belongs to the current view/editor session. It is not embedded into sent messages or saved documents and is reset when that view is reopened. If you edit the translated passage, its toggle will not overwrite those edits. Keep a separate original document when you want a lasting bilingual copy.

## Built-in, on-device model

The Linux x86_64 installer includes a checksum-pinned **llama.cpp CPU runtime**; no Ollama server, GPU or API key is required. On first use, a setup dialog explicitly offers a **2.5 GB** download of **Qwen3-4B-Instruct-2507 Q4_K_M** (Apache 2.0 weights, Unsloth quantization). You can also open **Settings → AI assistant → Local translation → Set up local translation**. Downloads show progress, are bounded and SHA-256 checked before installation, and never contain selected text.

After download, inference is offline, with no cloud fallback, HTTP model service, tools or shell execution. Only the selection and target language are passed to the local process, in a private temporary directory which is removed afterward. Inference does not inherit API keys or Inkwell secrets and uses four CPU threads at most. Your separate Ask Inkwell/cloud-provider settings are not used or changed.

The model runs on the **Inkwell backend computer**. A paired browser/phone sends the selected text to that private backend, not to a model running on the phone. Internet is needed for the first weights download, not for later desktop translations.

The model is cached under `$XDG_CACHE_HOME/inkwell/models` (normally `~/.cache/inkwell/models`), outside the mail workspace and application release directory. Updates reuse it. `INKWELL_MODEL_DIR` can override this location for testing/administration. About 2.7 GB free disk space and several GB available RAM are recommended; CPU speed determines latency. A second request while inference is running is rejected rather than loading another model in the same backend.

Translate passages of up to **2,000 characters** at a time. The request times out after three minutes, and incomplete/malformed output is not installed. The footer shows when translation is running. Missing models, failures and changed selections leave the original text intact.

The submenu currently offers English, Afrikaans, Arabic, simplified/traditional Chinese, Czech, Danish, Dutch, Finnish, French, German, Greek, Hebrew, Hindi, Hungarian, Indonesian, Italian, Japanese, Korean, Norwegian, Polish, Portuguese, Romanian, Russian, Spanish, Swedish, Thai, Turkish, Ukrainian and Vietnamese. Quality varies by language and passage. Review translations before sending or saving, particularly names, amounts, dates and legal/medical content. Model output is not authoritative.

## HTML email isolation

Sender code remains removed by nh3. The normal HTML API response stays script-free. The reader requests an optional trusted translation bridge with a random per-frame capability. That response permits only the fixed first-party bridge through a fresh CSP nonce. The frame remains opaque-origin: **no allow-same-origin**, Node/preload access, forms, top navigation, fetch or external scripts. Parent/child messages check the exact frame, capability and request ID; text is inserted as literal DOM text, never model-generated HTML. The parent waits for an application acknowledgement before reporting an inline replacement. Existing explicit image/link permissions remain independent.

## Source builds and verification

On Linux x86_64, run `npm run prepare:translation` to prepare the same pinned CPU runtime under `build/local-llm`; the normal Linux packaging command does this automatically. The runtime archive's hash is pinned in `desktop/local-llm.mjs`; model revision, size and hash are pinned in `inkwell/translation.py`. Build outputs/model caches are excluded from source control and installers never contain user workspace data.

`npm run test:translation` checks real inference in an isolated workspace when the local runtime/model is present; otherwise it explicitly skips without downloading anything. Set `INKWELL_TEST_SERVER` to a frozen backend executable to exercise the packaged runtime. Python tests cover boundaries, download/hash failures, concurrency, redaction and trusted-frame CSP. Desktop/mobile UI tests cover received text/HTML, draft autosave, Word/text/PDF surfaces, Undo/Redo, setup consent, literal markup and late-result protection.
