import json
from urllib.parse import parse_qs

import httpx
import pytest

from inkwell import microsoft

CLIENT_ID = "11111111-2222-3333-4444-555555555555"


def test_publisher_sign_in_requires_no_user_client_id(client, monkeypatch):
    monkeypatch.setenv("INKWELL_MICROSOFT_CLIENT_ID", CLIENT_ID)
    assert client.get("/api/microsoft/config").json() == {"configured": True}
    calls = []

    def handle(request):
        calls.append(parse_qs(request.content.decode()))
        return httpx.Response(
            200,
            json={
                "device_code": "private",
                "user_code": "CODE",
                "verification_uri": "https://www.microsoft.com/link",
                "expires_in": 900,
            },
        )

    monkeypatch.setattr(
        microsoft, "client", lambda: httpx.Client(transport=httpx.MockTransport(handle))
    )
    for body in [{}, {"client_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}]:
        response = client.post("/api/microsoft/begin", json=body)
        assert response.status_code == 200
        assert calls[-1]["client_id"] == [CLIENT_ID]
        assert microsoft.FLOWS[response.json()["id"]]["client_id"] == CLIENT_ID
        assert "private" not in response.text
        client.delete("/api/microsoft/" + response.json()["id"])


def test_account_types_use_restricted_microsoft_authorities(client, monkeypatch):
    monkeypatch.setenv("INKWELL_MICROSOFT_CLIENT_ID", CLIENT_ID)
    paths = []

    def handle(request):
        paths.append(request.url.path)
        return httpx.Response(
            200,
            json={
                "device_code": "private",
                "user_code": "CODE",
                "verification_uri": "https://www.microsoft.com/link",
                "expires_in": 900,
            },
        )

    monkeypatch.setattr(
        microsoft, "client", lambda: httpx.Client(transport=httpx.MockTransport(handle))
    )
    for account_type, tenant in [
        ("consumer", "consumers"),
        ("organization", "organizations"),
        ("any", "common"),
    ]:
        response = client.post("/api/microsoft/begin", json={"account_type": account_type})
        assert response.status_code == 200
        assert paths[-1] == f"/{tenant}/oauth2/v2.0/devicecode"
        flow = microsoft.FLOWS[response.json()["id"]]
        assert f"/{tenant}/" in flow["auth"]
    assert client.post("/api/microsoft/begin", json={"account_type": "invalid"}).status_code == 422


def test_missing_publisher_reports_setup_incomplete(client, monkeypatch):
    monkeypatch.setenv("INKWELL_MICROSOFT_CLIENT_ID", "")
    monkeypatch.setattr(
        microsoft,
        "client",
        lambda: pytest.fail("Must not contact Microsoft without an application ID"),
    )
    assert client.get("/api/microsoft/config").json() == {"configured": False}
    response = client.post("/api/microsoft/begin", json={})
    assert response.status_code == 503
    assert "not configured" in response.json()["detail"]


def test_bundled_publisher_and_environment_override(client, monkeypatch, tmp_path):
    config = tmp_path / "oauth.json"
    config.write_text(json.dumps({"microsoft_client_id": CLIENT_ID}))
    monkeypatch.setattr(microsoft, "OAUTH_CONFIG", config)
    monkeypatch.delenv("INKWELL_MICROSOFT_CLIENT_ID", raising=False)
    assert microsoft.publisher_client_id() == CLIENT_ID
    assert client.get("/api/microsoft/config").json() == {"configured": True}
    monkeypatch.setenv("INKWELL_MICROSOFT_CLIENT_ID", "")
    assert client.get("/api/microsoft/config").json() == {"configured": False}


def test_invalid_publisher_fails_without_exposing_configuration(client, monkeypatch):
    monkeypatch.setenv("INKWELL_MICROSOFT_CLIENT_ID", "not-a-client-id")
    for response in [
        client.get("/api/microsoft/config"),
        client.post("/api/microsoft/begin", json={}),
    ]:
        assert response.status_code == 503
        assert "not-a-client-id" not in response.text
