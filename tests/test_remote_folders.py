import httpx
import pytest

from inkwell import microsoft, remote_folders, store


def seed():
    with store.db() as db:
        id_ = db.execute("""INSERT INTO accounts(name,email,imap_host,imap_port,smtp_host,smtp_port,username,secret,smtp_security,provider)
            VALUES ('Mail','mail@example.com','',993,'',587,'mail@example.com','unused','starttls','microsoft')""").lastrowid
        return dict(db.execute("SELECT * FROM accounts WHERE id=?", (id_,)).fetchone())


def test_discovery_hierarchy_folder_import_and_search_scopes(client, monkeypatch):
    account = seed()
    calls = []
    monkeypatch.setattr(microsoft, "access_token", lambda a: "mock-token")

    def handle(request):
        calls.append((request.method, str(request.url)))
        path = request.url.path
        if path.endswith("/messages"):
            child = "/child/" in path
            return httpx.Response(
                200,
                json={
                    "value": [
                        {
                            "id": "child-message" if child else "inbox-message",
                            "subject": "Matching child" if child else "Matching inbox",
                            "body": {"content": "Hello", "contentType": "text"},
                            "from": {"emailAddress": {"address": "sender@example.com"}},
                            "receivedDateTime": "2026-09-13T10:00:00Z",
                        }
                    ]
                },
            )
        if path.endswith("/inbox"):
            return httpx.Response(200, json={"id": "inbox-id"})
        if path.rsplit("/", 1)[-1] in {
            "junkemail",
            "deleteditems",
            "sentitems",
            "drafts",
            "archive",
        }:
            return httpx.Response(404)
        if path.endswith("/childFolders"):
            return httpx.Response(
                200,
                json={
                    "value": [
                        {
                            "id": "child",
                            "displayName": "Projects <test>",
                            "childFolderCount": 0,
                            "totalItemCount": 1,
                        }
                    ]
                },
            )
        return httpx.Response(
            200,
            json={
                "value": [
                    {
                        "id": "inbox-id",
                        "displayName": "Inbox",
                        "childFolderCount": 1,
                        "totalItemCount": 1,
                    },
                    {
                        "id": "other",
                        "displayName": "Other",
                        "childFolderCount": 0,
                        "totalItemCount": 0,
                    },
                ]
            },
        )

    monkeypatch.setattr(
        microsoft, "client", lambda: httpx.Client(transport=httpx.MockTransport(handle))
    )
    assert remote_folders.discover(account) == 3
    folders = client.get("/api/remote-folders").json()
    inbox = next(f for f in folders if f["well_known"] == "inbox")
    child = next(f for f in folders if f["remote_id"] == "child")
    assert child["parent_remote_id"] == "inbox-id"
    assert child["path"] == "Inbox / Projects <test>"
    assert client.post(f"/api/remote-folders/{inbox['id']}/sync").json()["added"] == 1
    assert client.post(f"/api/remote-folders/{child['id']}/sync").json()["added"] == 1
    assert client.post(f"/api/remote-folders/{child['id']}/sync").json()["added"] == 0

    def query(scope):
        return client.get(
            "/api/messages",
            params={"q": "Matching", "remote_folder_id": inbox["id"], "scope": scope},
        ).json()

    assert len(query("folder")) == 1
    assert len(query("subfolders")) == 2
    assert len(query("all")) == 2
    assert len(client.get("/api/messages?folder=inbox&scope=subfolders&q=Matching").json()) == 2
    mid = next(m["id"] for m in query("all") if m["subject"] == "Matching child")
    assert client.patch(f"/api/messages/{mid}", json={"folder": "trash"}).status_code == 200
    client.post(f"/api/remote-folders/{child['id']}/sync")
    assert len(query("subfolders")) == 1  # Do not resurrect local trash on import.
    assert len(query("all")) == 2
    assert all(method == "GET" for method, _ in calls)
    assert client.post("/api/remote-folders/9999/sync").status_code == 404
    assert client.get("/api/messages?scope=invalid").status_code == 422
    old_ids = [f["id"] for f in folders]
    remote_folders.discover(account)
    assert [f["id"] for f in client.get("/api/remote-folders").json()] == old_ids
    assert client.delete(f"/api/accounts/{account['id']}").status_code == 200
    assert client.get("/api/remote-folders").json() == []


def test_failed_discovery_keeps_snapshot_and_blocks_foreign_pagination(client, monkeypatch):
    account = seed()
    with store.db() as db:
        db.execute(
            "INSERT INTO remote_folders(account_id,remote_id,name,path) VALUES (?,'cached','Cached','Cached')",
            (account["id"],),
        )
    monkeypatch.setattr(microsoft, "access_token", lambda a: "mock-token")
    calls = []

    def handle(request):
        calls.append(str(request.url))
        if request.url.path.endswith("/inbox"):
            return httpx.Response(200, json={"id": "inbox"})
        return httpx.Response(
            200,
            json={"value": [], "@odata.nextLink": "https://attacker.example/v1.0/me/mailFolders"},
        )

    monkeypatch.setattr(
        microsoft, "client", lambda: httpx.Client(transport=httpx.MockTransport(handle))
    )
    with pytest.raises(ValueError):
        remote_folders.discover(account)
    assert len(calls) == 2
    assert client.get("/api/remote-folders").json()[0]["name"] == "Cached"
