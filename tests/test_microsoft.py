import json
import sqlite3
import time

import httpx
import pytest

from inkwell import microsoft, store

CLIENT_ID = "11111111-2222-3333-4444-555555555555"


def connect(client, monkeypatch, requests):
    def handle(request):
        requests.append(request)
        if request.url.path.endswith("/devicecode"):
            return httpx.Response(
                200,
                json={
                    "device_code": "private-code",
                    "user_code": "ABCD-EFGH",
                    "verification_uri": "https://www.microsoft.com/link",
                    "expires_in": 900,
                    "interval": 5,
                },
            )
        if request.url.path.endswith("/token"):
            return httpx.Response(
                200,
                json={
                    "access_token": "access-secret",
                    "refresh_token": "refresh-secret",
                    "expires_in": 3600,
                },
            )
        return httpx.Response(200, json={"displayName": "Microsoft User", "mail": "ms@example.com"})

    monkeypatch.setattr(
        microsoft, "client", lambda: httpx.Client(transport=httpx.MockTransport(handle))
    )
    flow = client.post("/api/microsoft/begin", json={"client_id": CLIENT_ID})
    assert flow.status_code == 200
    assert "private-code" not in flow.text
    flow_id = flow.json()["id"]
    assert client.post(f"/api/microsoft/{flow_id}/poll").json()["status"] == "pending"
    microsoft.FLOWS[flow_id]["next_poll"] = 0
    result = client.post(f"/api/microsoft/{flow_id}/poll")
    assert result.status_code == 200
    assert result.json()["status"] == "complete"
    return result.json()["account_id"], flow_id


def test_device_authorization_encrypted_and_idempotent(client, monkeypatch):
    requests = []
    account_id, flow_id = connect(client, monkeypatch, requests)
    assert len(requests) == 3
    result = client.post(f"/api/microsoft/{flow_id}/poll")
    assert result.json()["account_id"] == account_id
    accounts = client.get("/api/accounts").json()
    assert len(accounts) == 1 and accounts[0]["provider"] == "microsoft"
    assert "secret" not in accounts[0]
    with store.db() as db:
        secret = db.execute("SELECT secret FROM accounts").fetchone()[0]
    assert "access-secret" not in secret
    assert json.loads(store.unseal(secret))["refresh_token"] == "refresh-secret"
    assert client.delete(f"/api/microsoft/{flow_id}").status_code == 200
    assert client.post(f"/api/microsoft/{flow_id}/poll").status_code == 410


def test_device_flow_validation_pending_slowdown_and_expiry(client, monkeypatch):
    assert (
        client.post("/api/microsoft/begin", json={"client_id": "not-an-app-id"}).status_code == 422
    )
    flow_id = "pending-flow"
    microsoft.FLOWS[flow_id] = {
        "client_id": CLIENT_ID,
        "device_code": "private",
        "expires": time.time() + 500,
        "interval": 5,
        "next_poll": 0,
    }

    def handle(request):
        return httpx.Response(400, json={"error": "slow_down"})

    monkeypatch.setattr(
        microsoft, "client", lambda: httpx.Client(transport=httpx.MockTransport(handle))
    )
    result = client.post(f"/api/microsoft/{flow_id}/poll")
    assert result.json() == {"status": "pending", "interval": 10}
    microsoft.FLOWS[flow_id]["expires"] = 0
    assert client.post(f"/api/microsoft/{flow_id}/poll").status_code == 410


def test_graph_sync_and_send(client, monkeypatch):
    account_id, _ = connect(client, monkeypatch, [])
    calls = []

    def handle(request):
        calls.append(request)
        assert request.headers["authorization"] == "Bearer access-secret"
        if request.url.path.endswith("/sendMail"):
            data = json.loads(request.content)
            assert (
                data["message"]["toRecipients"][0]["emailAddress"]["address"]
                == "friend@example.com"
            )
            assert data["saveToSentItems"] is True
            return httpx.Response(202)
        assert 'body-content-type="html"' in request.headers["prefer"]
        return httpx.Response(
            200,
            json={
                "value": [
                    {
                        "id": "immutable123",
                        "from": {
                            "emailAddress": {"name": "Friend", "address": "friend@example.com"}
                        },
                        "subject": "A Microsoft email",
                        "body": {
                            "contentType": "html",
                            "content": "<p>Hello</p><script>steal()</script>",
                        },
                        "receivedDateTime": "2026-09-13T10:00:00Z",
                        "isRead": False,
                    }
                ]
            },
        )

    monkeypatch.setattr(
        microsoft, "client", lambda: httpx.Client(transport=httpx.MockTransport(handle))
    )
    assert client.post("/api/sync").json()[0]["added"] == 1
    assert client.post("/api/sync").json()[0]["added"] == 0
    message = client.get("/api/messages").json()[0]
    body = client.get("/api/messages/" + str(message["id"])).json()["body"]
    assert "Hello" in body and "steal" not in body
    assert (
        client.post(
            "/api/send",
            json={
                "account_id": account_id,
                "recipient": "friend@example.com",
                "subject": "Hello",
                "body": "World",
            },
        ).status_code
        == 200
    )
    assert len(client.get("/api/messages?folder=sent").json()) == 1


def test_refresh_and_pagination_token_boundary(client, monkeypatch):
    account_id, _ = connect(client, monkeypatch, [])
    with store.db() as db:
        account = dict(db.execute("SELECT * FROM accounts").fetchone())
        token = json.loads(store.unseal(account["secret"]))
        token["expires_at"] = 0
        db.execute("UPDATE accounts SET secret=?", (store.seal(json.dumps(token)),))
    calls = []

    def handle(request):
        calls.append(str(request.url))
        if request.url.path.endswith("/token"):
            assert b"refresh-secret" in request.content
            return httpx.Response(
                200,
                json={
                    "access_token": "new-access",
                    "refresh_token": "rotated-refresh",
                    "expires_in": 3600,
                },
            )
        assert request.headers["authorization"] == "Bearer new-access"
        return httpx.Response(
            200, json={"value": [], "@odata.nextLink": "https://attacker.example/steal"}
        )

    monkeypatch.setattr(
        microsoft, "client", lambda: httpx.Client(transport=httpx.MockTransport(handle))
    )
    with pytest.raises(ValueError, match="pagination"):
        microsoft.sync_account(account)
    assert len(calls) == 2 and all("attacker.example" not in url for url in calls)
    with store.db() as db:
        token = json.loads(
            store.unseal(
                db.execute("SELECT secret FROM accounts WHERE id=?", (account_id,)).fetchone()[0]
            )
        )
    assert token["refresh_token"] == "rotated-refresh"


def test_legacy_schema_migration_preserves_accounts(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path)
    with sqlite3.connect(tmp_path / "inkwell.db") as db:
        db.execute(
            "CREATE TABLE accounts(id INTEGER PRIMARY KEY,name TEXT,email TEXT,imap_host TEXT,imap_port INTEGER,smtp_host TEXT,smtp_port INTEGER,username TEXT,secret TEXT,smtp_security TEXT)"
        )
        db.execute(
            "INSERT INTO accounts VALUES(1,'Existing','existing@example.com','imap',993,'smtp',465,'user','legacy-secret','tls')"
        )
    store.init()
    store.init()
    with store.db() as db:
        account = dict(db.execute("SELECT * FROM accounts").fetchone())
        assert db.execute("PRAGMA user_version").fetchone()[0] == 8
    assert account["provider"] == "imap" and account["secret"] == "legacy-secret"
