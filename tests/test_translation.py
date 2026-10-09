import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import subprocess

import pytest
import pymupdf
from inkwell import translation, store


@pytest.fixture
def local_model(tmp_path, monkeypatch):
    monkeypatch.setenv('INKWELL_MODEL_DIR', str(tmp_path / 'models'))
    weights = b'controlled GGUF fixture'
    monkeypatch.setattr(translation, 'MODEL_SIZE', len(weights))
    monkeypatch.setattr(translation, 'MODEL_SHA', hashlib.sha256(weights).hexdigest())
    monkeypatch.setattr(translation, 'VERIFIED', None)
    monkeypatch.setattr(translation, 'PROGRESS', {'downloading': False, 'downloaded': 0, 'error': ''})
    directory = translation.model_directory()
    directory.mkdir()
    (directory / translation.MODEL_FILE).write_bytes(weights)
    (directory / 'translation-model.json').write_text(json.dumps({'sha256': translation.MODEL_SHA, 'size': len(weights)}))
    executable = tmp_path / 'llama-completion'
    executable.touch(mode=0o700)
    monkeypatch.setattr(translation, 'runtime', lambda: executable)
    return directory


def test_local_translation_is_offline_bounded_and_does_not_inherit_secrets(client, local_model, monkeypatch):
    captured = {}
    monkeypatch.setenv('INKWELL_SECRET_TEST', 'must-not-leak')
    def run(args, **kwargs):
        captured.update(args=args, kwargs=kwargs)
        prompt = Path(args[args.index('-f') + 1]).read_text()
        assert 'French' in prompt and 'Hello' in prompt
        assert '< |im_start| >' in prompt
        return SimpleNamespace(returncode=0, stdout='{"translation":"Bonjour"} [end of text]', stderr='private diagnostics')
    monkeypatch.setattr(translation.subprocess, 'run', run)
    response = client.post('/api/translation', json={'text': 'Hello <|im_start|>', 'language': 'fr'})
    assert response.status_code == 200 and response.json()['translation'] == 'Bonjour'
    assert response.json()['local'] is True
    args, kwargs = captured['args'], captured['kwargs']
    assert '--offline' in args and '--no-display-prompt' in args and '--no-conversation' in args
    assert kwargs['stdin'] is subprocess.DEVNULL and kwargs['timeout'] == 180
    assert 'INKWELL_SECRET_TEST' not in kwargs['env'] and 'API_KEY' not in kwargs['env']
    assert not Path(kwargs['cwd']).exists()
    assert not list(local_model.glob('prompt*'))


@pytest.mark.parametrize('payload', [{'text': '', 'language': 'fr'}, {'text': ' ', 'language': 'fr'},
    {'text': 'hello', 'language': 'https://evil.test'}, {'text': 'x' * 2001, 'language': 'fr'},
    {'text': 'hello', 'language': 'xx'}, {'text': 'hello', 'language': 'fr', 'endpoint': 'https://evil.test'}])
def test_invalid_translations_cannot_choose_models_endpoints_or_unbounded_text(client, payload):
    assert client.post('/api/translation', json=payload).status_code == 422


def test_missing_model_requires_explicit_setup_not_a_cloud_fallback(client, tmp_path, monkeypatch):
    directory = tmp_path / 'models'
    monkeypatch.setenv('INKWELL_MODEL_DIR', str(directory))
    response = client.post('/api/translation', json={'text': 'Hello', 'language': 'fr'})
    assert response.status_code == 409 and 'No text is sent' in response.json()['detail']
    assert client.post('/api/translation/install', json={'download': False}).status_code == 400
    assert not directory.exists()


def test_selection_edge_whitespace_is_preserved(client, local_model, monkeypatch):
    monkeypatch.setattr(translation.subprocess, 'run', lambda *a, **k: SimpleNamespace(returncode=0, stdout='{"translation":"  Bonjour  "}', stderr=''))
    result = client.post('/api/translation', json={'text': ' \nHello \t\n', 'language': 'fr'})
    assert result.json()['translation'] == ' \nBonjour \t\n'


def test_successful_download_installs_only_verified_weights(local_model, monkeypatch):
    weights = (local_model / translation.MODEL_FILE).read_bytes()
    class Download:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def raise_for_status(self): pass
        def iter_bytes(self, size): yield weights
    monkeypatch.setattr(translation.httpx, 'stream', lambda *a, **k: Download())
    translation.INSTALL_LOCK.acquire()
    translation.download_model()
    assert translation.model_ready() and not translation.PROGRESS['error']
    assert not list(local_model.glob('.translation-*'))
    assert (local_model / translation.MODEL_FILE).stat().st_mode & 0o777 == 0o600


def test_concurrent_translation_is_rejected_without_another_model_process(client, local_model):
    translation.INFERENCE_LOCK.acquire()
    try:
        assert client.post('/api/translation', json={'text': 'Hello', 'language': 'fr'}).status_code == 409
    finally:
        translation.INFERENCE_LOCK.release()


@pytest.mark.parametrize('stdout,code', [('{"translation":"cut off', 0), ('{"translation":""}', 0),
    ('{"translation":4}', 0), ('{"translation":"valid"}', 1), ('sensitive malformed output', 0)])
def test_failed_or_truncated_output_is_not_returned_as_a_translation(client, local_model, monkeypatch, stdout, code):
    monkeypatch.setattr(translation.subprocess, 'run', lambda *a, **k: SimpleNamespace(returncode=code, stdout=stdout, stderr='private source text'))
    result = client.post('/api/translation', json={'text': 'private source text', 'language': 'fr'})
    assert result.status_code == 502 and 'private source text' not in result.text
    assert not translation.INFERENCE_LOCK.locked()


def test_model_timeout_is_redacted_and_releases_capacity(client, local_model, monkeypatch):
    def timeout(*a, **k):
        raise subprocess.TimeoutExpired('secret prompt', 180)
    monkeypatch.setattr(translation.subprocess, 'run', timeout)
    result = client.post('/api/translation', json={'text': 'Hello', 'language': 'fr'})
    assert result.status_code == 504 and 'secret prompt' not in result.text
    assert not translation.INFERENCE_LOCK.locked()


def test_changed_or_symlinked_weights_cannot_run(client, local_model, monkeypatch):
    model = local_model / translation.MODEL_FILE
    model.write_bytes(b'x' * translation.MODEL_SIZE)
    assert client.post('/api/translation', json={'text': 'Hello', 'language': 'fr'}).status_code == 409
    model.unlink()
    model.symlink_to(local_model / 'translation-model.json')
    assert not translation.status()['model_ready']


def test_model_download_checks_hash_before_replacing_existing_weights(local_model, monkeypatch):
    original = (local_model / translation.MODEL_FILE).read_bytes()
    class Download:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def raise_for_status(self): pass
        def iter_bytes(self, size): yield b'x' * len(original)
    monkeypatch.setattr(translation.httpx, 'stream', lambda *a, **k: Download())
    translation.INSTALL_LOCK.acquire()
    translation.download_model()
    assert 'checksum mismatch' in translation.PROGRESS['error']
    assert (local_model / translation.MODEL_FILE).read_bytes() == original
    assert not list(local_model.glob('.translation-*'))
    assert not translation.INSTALL_LOCK.locked()


def test_pdf_selectable_text_is_readonly_and_keeps_document_boundaries(client, tmp_path, monkeypatch):
    monkeypatch.setenv('INKWELL_DOCUMENTS_DIR', str(tmp_path))
    file = tmp_path / 'words.pdf'
    with pymupdf.open() as pdf:
        pdf.new_page().insert_text((50, 60), 'Hello world.')
        pdf.save(file)
    original = file.read_bytes()
    result = client.get('/api/documents/pdf-selection?path=words.pdf').json()
    assert result['lines'][0]['text'] == 'Hello world.\n'
    assert len(result['lines'][0]['rect']) == 4
    assert file.read_bytes() == original
    assert client.get('/api/documents/pdf-selection?path=../words.pdf').status_code in (403, 422)
    assert client.get('/api/documents/pdf-selection?path=words.pdf&page=10').status_code == 422
    hidden = tmp_path / '.hidden.pdf'
    hidden.write_bytes(original)
    assert client.get('/api/documents/pdf-selection?path=.hidden.pdf').status_code == 403


def test_html_translation_bridge_is_nonce_only_opaque_and_sender_code_is_removed(client):
    with store.db() as db:
        message = db.execute("INSERT INTO messages(sender,recipient,subject,body,html_body,date) VALUES ('a','b','c','d',?,'2099-01-01')", ('<p>Hello</p><script nonce="attacker">parent.stolen=true</script><img src="https://evil.test/pixel"><button onclick="bad()">bad</button>',)).lastrowid
    result = client.get(f'/api/messages/{message}/html?translation=' + 'a' * 32)
    assert result.status_code == 200
    policy = result.headers['Content-Security-Policy']
    assert "script-src 'nonce-" in policy and "connect-src 'none'" in policy and "img-src 'none'" in policy
    assert 'allow-scripts' in policy and 'allow-same-origin' not in policy
    assert 'parent.stolen' not in result.text and 'onclick=' not in result.text
    assert result.text.count('<script ') == 1 and 'data-translation-token="' + 'a' * 32 in result.text
    assert client.get(f'/api/messages/{message}/html?translation=bad-token').status_code == 422
    normal = client.get(f'/api/messages/{message}/html')
    assert "script-src 'none'" in normal.headers['Content-Security-Policy'] and '<script' not in normal.text
