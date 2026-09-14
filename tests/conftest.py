import pytest
from fastapi.testclient import TestClient

from inkwell import app as module, store


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path)
    monkeypatch.setattr(module, "ACCESS_KEY", "")
    with TestClient(module.app, base_url="http://localhost") as client:
        client.get("/")
        client.headers.update({"Origin": "http://localhost", "X-Inkwell": "1"})
        yield client
