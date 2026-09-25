import json
import subprocess
from pathlib import Path

import httpx
import pytest

from inkwell import ai, store


def test_preferences_roundtrip_and_validation(client):
    prefs = client.get("/api/preferences").json()
    assert prefs["form_mode"] == "popup"
    prefs["form_mode"] = "inline"
    prefs["layout"] = "classic"
    prefs["theme"].update(name="My midnight", background="#101010", dark=True, radius=20)
    assert client.put("/api/preferences", json=prefs).json() == prefs
    assert client.get("/api/preferences").json() == prefs
    assert client.put("/api/preferences", json={**prefs, "form_mode": "bad"}).status_code == 422
    assert client.put("/api/preferences", json={**prefs, "layout": "unknown"}).status_code == 422
    for patch in [
        {"background": "url(https://evil.example)"},
        {"radius": 100},
        {"font": "url(x)"},
        {"css": "body{display:none}"},
    ]:
        assert (
            client.put(
                "/api/preferences", json={**prefs, "theme": {**prefs["theme"], **patch}}
            ).status_code
            == 422
        )
    assert client.get("/api/preferences").json() == prefs


def test_saved_theme_library_and_active_theme_are_independent(client):
    initial = client.get('/api/preferences/themes').json()
    assert len(initial) == 1 and initial[0]['name'] == 'Sage'
    alternate = {**initial[0], 'name': 'Night & day', 'background': '#101010'}
    assert client.put('/api/preferences/themes', json=alternate).status_code == 200
    assert client.put('/api/preferences/themes', json={**alternate, 'name': 'night & day'}).status_code == 200
    themes = client.get('/api/preferences/themes').json()
    assert len(themes) == 2 and themes[1]['name'] == 'night & day'
    assert client.get('/api/preferences').json()['theme']['name'] == 'Sage'
    prefs = client.get('/api/preferences').json()
    prefs['theme'] = alternate
    assert client.put('/api/preferences', json=prefs).status_code == 200
    assert [t['name'] for t in client.get('/api/preferences/themes').json()] == ['Sage', 'night & day']
    assert client.put('/api/preferences/themes', json={**alternate, 'text': 'url(x)'}).status_code == 422
    assert client.delete('/api/preferences/themes/unknown').status_code == 404
    assert client.delete('/api/preferences/themes/night%20%26%20day').status_code == 200
    assert client.delete('/api/preferences/themes/Sage').status_code == 200
    assert client.get('/api/preferences/themes').json() == []
    assert client.get('/api/preferences').json()['theme']['name'] == 'Night & day'


def test_provider_catalog_and_key_isolation(client):
    catalog = client.get("/api/ai/providers").json()
    assert {
        "codex",
        "openrouter",
        "anthropic",
        "gemini",
        "ollama",
        "unsloth",
        "lmstudio",
        "llamacpp",
    } <= {p["id"] for p in catalog}
    config = {
        "provider": "openrouter",
        "endpoint": "https://openrouter.ai/api/v1",
        "model": "a/model",
        "api_key": "router-secret",
    }
    client.put("/api/ai/config", json=config)
    assert store.unseal(store.setting("ai_key")) == "router-secret"
    client.put("/api/ai/config", json={**config, "api_key": "", "model": "another/model"})
    assert store.unseal(store.setting("ai_key")) == "router-secret"
    client.put(
        "/api/ai/config", json={**config, "endpoint": "https://other.example/v1", "api_key": ""}
    )
    assert store.setting("ai_key") == ""
    assert client.put("/api/ai/config", json={"provider": "unknown"}).status_code == 422
    assert (
        client.put(
            "/api/ai/config", json={"provider": "codex", "model": "model & command"}
        ).status_code
        == 422
    )


@pytest.mark.parametrize(
    "provider",
    [
        "openai",
        "openrouter",
        "anthropic",
        "gemini",
        "ollama",
        "unsloth",
        "lmstudio",
        "llamacpp",
        "mistral",
        "groq",
        "deepseek",
        "xai",
        "together",
        "custom",
    ],
)
def test_provider_protocols(client, monkeypatch, provider):
    entry = ai.PROVIDERS[provider]
    client.put(
        "/api/ai/config",
        json={
            "provider": provider,
            "endpoint": entry[1],
            "model": entry[2],
            "api_key": "only-this-key",
        },
    )
    captured = []
    original_client = httpx.Client

    def handle(request):
        captured.append(request)
        if provider == "anthropic":
            response = {"content": [{"type": "text", "text": "A suggestion"}]}
        elif provider == "gemini":
            response = {"candidates": [{"content": {"parts": [{"text": "A suggestion"}]}}]}
        else:
            response = {"choices": [{"message": {"content": "A suggestion"}}]}
        return httpx.Response(200, json=response)

    monkeypatch.setattr(
        ai.httpx, "Client", lambda **kwargs: original_client(transport=httpx.MockTransport(handle))
    )
    result = client.post(
        "/api/ai/chat", json={"prompt": "Help me reply", "context": "Private selected email"}
    )
    assert result.json() == {"answer": "A suggestion"}
    request = captured[0]
    data = json.loads(request.content)
    assert "tools" not in data
    assert "Private selected email" in request.content.decode()
    assert "only-this-key" not in str(request.url)
    if provider == "anthropic":
        assert request.url.path.endswith("/messages")
        assert request.headers["x-api-key"] == "only-this-key"
        assert "authorization" not in request.headers
    elif provider == "gemini":
        assert request.url.path.endswith(":generateContent")
        assert request.headers["x-goog-api-key"] == "only-this-key"
    else:
        assert request.url.path.endswith("/chat/completions")
        assert request.headers["authorization"] == "Bearer only-this-key"


def test_codex_bridge_arguments_and_cleanup(client, monkeypatch):
    monkeypatch.setattr(ai.shutil, "which", lambda name: "/usr/bin/codex")
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-inherit")
    monkeypatch.setenv("INKWELL_ACCESS_KEY", "private-application-key")
    calls = []

    def run(command, **kwargs):
        calls.append((command, kwargs))
        if command[1:] == ["login", "status"]:
            return subprocess.CompletedProcess(
                command, 0, stdout="Logged in using ChatGPT", stderr=""
            )
        output = Path(command[command.index("--output-last-message") + 1])
        output.write_text("A subscription-backed draft", encoding="utf-8")
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(ai.subprocess, "run", run)
    assert client.get("/api/ai/codex/status").json()["available"]
    client.put("/api/ai/config", json={"provider": "codex", "model": "gpt-5.4", "thinking_level": "high"})
    result = client.post("/api/ai/chat", json={"prompt": "Draft a greeting"})
    assert result.json()["answer"] == "A subscription-backed draft"
    command, options = calls[-1]
    assert "--ignore-user-config" in command and "--ignore-rules" in command
    assert command[command.index("--sandbox") + 1] == "read-only"
    assert "shell_tool" in command and "unified_exec" in command
    assert "--ephemeral" in command
    assert 'model_reasoning_effort="high"' in command
    assert 'Do not assist with software development or modifications to the inkwell codebase' in options['input']
    assert not options.get("shell", False)
    assert "OPENAI_API_KEY" not in options["env"] and "INKWELL_ACCESS_KEY" not in options["env"]
    assert "Draft a greeting" in options["input"]
    assert not Path(options["cwd"]).exists()


def test_codex_models_use_installed_cli_cache_without_private_fields(client, monkeypatch, tmp_path):
    import json

    monkeypatch.setenv('CODEX_HOME', str(tmp_path))
    assert client.get('/api/ai/codex/models').json() == []
    (tmp_path / 'models_cache.json').write_text(json.dumps({'models': [
        {'slug': 'visible', 'visibility': 'list', 'default_reasoning_level': 'medium',
         'supported_reasoning_levels': [{'effort': 'low'}, {'effort': 'medium'}], 'secret': 'do-not-expose'},
        {'slug': 'internal', 'visibility': 'hide'},
    ]}), encoding='utf-8')
    assert client.get('/api/ai/codex/models').json() == [
        {'id': 'visible', 'default_thinking': 'medium', 'thinking_levels': ['low', 'medium']}
    ]


def test_codex_absent_and_provider_errors_redacted(client, monkeypatch):
    monkeypatch.setattr(ai.shutil, "which", lambda name: None)
    assert not client.get("/api/ai/codex/status").json()["available"]
    client.put("/api/ai/config", json={"provider": "codex"})
    assert client.post("/api/ai/chat", json={"prompt": "Hi"}).status_code == 502

    def fail(*args):
        raise ValueError("Sensitive provider credential")

    monkeypatch.setattr(ai, "answer", fail)
    result = client.post("/api/ai/chat", json={"prompt": "Hi"})
    assert "Sensitive" not in result.text
