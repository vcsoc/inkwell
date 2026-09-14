# AI providers and subscriptions

In **Settings → AI assistant**, select a provider. Presets fill the base URL and a starting model ID; both are editable (the URL is unused/read-only for Codex). Model availability, pricing and account eligibility can change. Choose an identifier your account/server actually supports.

Save configuration, open **Ask Inkwell**, enter a prompt and explicitly choose whether to include the selected email or local calendar. Click **Ask assistant**. Merely saving settings does not send a prompt or test billing. The optional Codex status check checks the backend's CLI login only.

Changing a provider or URL clears its saved key unless you enter a replacement. Changing just the model retains the key. Secrets are never included in the provider catalog, theme files or config responses.

## Supported adapters

| Provider | Protocol / default base URL | Authentication |
| --- | --- | --- |
| OpenAI | Chat Completions · `https://api.openai.com/v1` | OpenAI API key / API billing |
| ChatGPT / Codex | Official **local Codex CLI**, not a private ChatGPT API | CLI ChatGPT login; eligible subscription |
| OpenRouter | Chat Completions · `https://openrouter.ai/api/v1` | OpenRouter key |
| Anthropic | Native Messages · `https://api.anthropic.com/v1` | Anthropic API key |
| Google Gemini | Native generateContent · `https://generativelanguage.googleapis.com/v1beta` | AI Studio API key |
| Mistral | Chat Completions · `https://api.mistral.ai/v1` | Mistral key |
| Groq | Chat Completions · `https://api.groq.com/openai/v1` | Groq key |
| DeepSeek | Chat Completions · `https://api.deepseek.com/v1` | DeepSeek key |
| xAI | Chat Completions · `https://api.x.ai/v1` | xAI key |
| Together AI | Chat Completions · `https://api.together.xyz/v1` | Together key |
| Ollama | Compatible API · `http://127.0.0.1:11434/v1` | Usually no key |
| LM Studio | Compatible API · `http://127.0.0.1:1234/v1` | Server-configured key, if any |
| llama.cpp | Compatible API · `http://127.0.0.1:8080/v1` | Server-configured key, if any |
| Unsloth exported/served models | An OpenAI-compatible inference server you run | Depends on that server |
| Custom | Any OpenAI-compatible Chat Completions base URL | Depends on that server |

All remote HTTP providers require HTTPS. Plain HTTP is allowed only for literal loopback hosts. The URL is resolved by the **backend**, never by the phone. Streaming, tools, multimodal inputs and provider model discovery are not implemented. Responses are single-turn text suggestions.

## ChatGPT / Codex subscription

A ChatGPT subscription is **not** an OpenAI API key and does not include arbitrary API billing. Inkwell uses the supported official Codex CLI login instead of scraping cookies, importing browser tokens or calling undocumented subscription endpoints.

On the backend machine, install/update the official CLI following [OpenAI's Codex instructions](https://developers.openai.com/codex/cli/), then:

```sh
codex login
codex login status
```

Choose **ChatGPT sign-in**, not an API key. CLI status must report a ChatGPT login. Inkwell's adapter requires a recent CLI supporting `exec --ignore-user-config --ignore-rules --ephemeral` and the feature flags in `inkwell/ai.py` (developed against CLI 0.152.0). Unsupported flags fail the request rather than falling back to an unrestricted invocation.

1. Select **ChatGPT / Codex subscription (local CLI)** in Inkwell.
2. Enter a Codex model available to your subscription. The preset is a starting point, not a guaranteed entitlement.
3. Click **Check Codex login**, then **Save assistant**.
4. Ask a question. Subscription limits still apply. Requests time out after 120 seconds.

The backend OS user must have access to the installed CLI and its login. Use `INKWELL_CODEX` to specify the native executable path if it isn't on PATH. On Windows, point this variable to the official native `codex.exe`, not a `.cmd`/`.bat` shim. Restart Inkwell after changing environment variables. Inkwell does not provide an embedded OAuth login window; authentication remains managed by the CLI. To revoke it, run `codex logout` on the backend. Disconnecting the provider inside Inkwell does **not** log out the CLI or other Codex applications.

### Codex security boundary

This is an **advanced local CLI bridge**, not the tool-free HTTP adapter. Inkwell runs an ephemeral request from a fresh temporary directory, with a read-only sandbox, approval policy `never`, user config and rules ignored, web search disabled, and shell/unified execution, apps, MCP-providing plugins, hooks, browser/computer use, multi-agent, image tools, memory, skill search and workspace dependencies disabled. API-key and Inkwell-secret environment variables are not inherited. Prompts are passed via stdin, not a shell command. The temporary response file is deleted after reading.

These restrictions are defense in depth, **not an independently audited containment guarantee**. Codex still owns its authentication, operational files, network connection to OpenAI and underlying agent runtime. Its runtime behavior can change across versions; a read-only sandbox alone is not a privacy sandbox. Use only an official, trusted CLI on a trusted backend. Do not give untrusted people access to your paired Inkwell workspace: paired users can consume that machine's Codex subscription. Prefer a local model or tool-free HTTP provider when stricter isolation is required.

Inkwell does not give Codex mail/calendar API credentials or write tools and does not execute its output as instructions. Review all suggestions. No live subscription request was made during automated testing; CLI invocation, cleanup, login gating and environment restrictions are tested with mocks.

## Local models

### Ollama

```sh
ollama pull llama3.2
# Start ollama serve if its service is not already running.
```

Select Ollama, keep the default URL and enter the pulled model name.

### LM Studio

Download/load a model and start **Developer → Local Server** in LM Studio. Select its preset and enter the model identifier shown by that server. Adjust port and optional server API key to match your configuration.

### llama.cpp

For a locally available GGUF file, for example:

```sh
llama-server -m /path/to/model.gguf --host 127.0.0.1 --port 8080 --alias local-model
```

Select llama.cpp and use `local-model`. Server flags may vary with the installed version. Inkwell does not download models or start the process for you.

### Unsloth

Unsloth is primarily a training/fine-tuning/export workflow, not one universal inference endpoint. Export your model to GGUF and serve it through llama.cpp or Ollama, or deploy it through a compatible inference server such as vLLM. If your Unsloth installation exposes an OpenAI-compatible serving endpoint, use that URL directly. Select **Unsloth (served/exported model)** and enter the actual serving URL and model ID. Inkwell does not train, convert, download or load models itself.

## Verification scope

Automated tests verify adapter URLs, authentication headers, payloads, response parsing, key isolation and errors using mocked responses. Real cloud credentials, subscription entitlement and each local runtime/model combination still require your own connection test. Provider errors are redacted rather than showing potentially sensitive upstream details.
