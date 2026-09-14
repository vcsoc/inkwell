from uuid import uuid4
from inkwell import store, mail


def draft(client, **fields):
    response = client.post(
        "/api/drafts", json={"subject": "Work in progress", "body": "Keep this", **fields}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_autosave_stable_identity_partial_address_and_revision(client):
    key = str(uuid4())
    first = draft(client, draft_key=key, recipient="unfinished@")
    second = draft(
        client,
        draft_key=key,
        draft_id=first["id"],
        draft_revision=first["draft_revision"],
        body="Latest edits",
    )
    assert first["id"] == second["id"]
    assert second["draft_revision"] == 2
    rejected = client.post(
        "/api/drafts", json={"draft_id": first["id"], "draft_revision": 1, "body": "stale"}
    )
    assert rejected.status_code == 409
    assert client.get(f"/api/messages/{first['id']}").json()["body"] == "Latest edits"
    assert len(client.get("/api/messages?folder=drafts").json()) == 1


def test_draft_first_request_retry_uses_same_key(client):
    key = str(uuid4())
    assert draft(client, draft_key=key)["id"] == draft(client, draft_key=key)["id"]


def test_deleted_or_moved_draft_is_not_resurrected(client):
    saved = draft(client)
    client.patch(f"/api/messages/{saved['id']}", json={"folder": "trash"})
    assert (
        client.post("/api/drafts", json={"draft_id": saved["id"], "body": "late save"}).status_code
        == 409
    )
    client.delete(f"/api/messages/{saved['id']}")
    assert (
        client.post("/api/drafts", json={"draft_id": saved["id"], "body": "late save"}).status_code
        == 409
    )


def test_atomic_selection_and_restore_original_local_folder(client):
    folder = client.post("/api/local-folders", json={"name": "Projects"}).json()
    saved = draft(client)
    id = saved["id"]
    # Existing generic PATCH can file a fixture; batch filing protects active drafts.
    client.patch(f"/api/messages/{id}", json={"folder": f"local-{folder['id']}"})
    assert (
        client.post("/api/messages/move", json={"ids": [id, 999999], "folder": "trash"}).status_code
        == 404
    )
    assert client.get(f"/api/messages/{id}").json()["folder"] == f"local-{folder['id']}"
    for _ in range(2):
        assert (
            client.post("/api/messages/move", json={"ids": [id, id], "folder": "trash"}).status_code
            == 200
        )
    assert client.post("/api/messages/restore", json={"ids": [id]}).status_code == 200
    assert client.get(f"/api/messages/{id}").json()["folder"] == f"local-{folder['id']}"
    client.patch(f"/api/messages/{id}", json={"folder": "trash"})
    assert client.delete(f"/api/local-folders/{folder['id']}").status_code == 200
    client.post("/api/messages/restore", json={"ids": [id]})
    assert client.get(f"/api/messages/{id}").json()["folder"] == "inbox"


def test_restore_is_atomic_and_drafts_can_return_from_trash(client):
    first, second = draft(client)["id"], draft(client)["id"]
    client.patch(f"/api/messages/{first}", json={"folder": "trash"})
    assert client.post("/api/messages/restore", json={"ids": [first, second]}).status_code == 422
    assert client.get(f"/api/messages/{first}").json()["folder"] == "trash"
    assert client.post("/api/messages/restore", json={"ids": [first]}).status_code == 200
    assert client.get(f"/api/messages/{first}").json()["folder"] == "drafts"


def seed_remote():
    with store.db() as db:
        account = db.execute(
            "INSERT INTO accounts(name,email,imap_host,imap_port,smtp_host,smtp_port,username,secret,smtp_security) VALUES ('Test','test@example.org','localhost',993,'localhost',465,'test','', 'tls')"
        ).lastrowid
        origin = db.execute(
            "INSERT INTO remote_folders(account_id,remote_id,name,path,well_known) VALUES (?,'source','Inbox','Inbox','inbox')",
            (account,),
        ).lastrowid
        target = db.execute(
            "INSERT INTO remote_folders(account_id,remote_id,name,path) VALUES (?,'target','Projects','Projects')",
            (account,),
        ).lastrowid
        child = db.execute(
            "INSERT INTO remote_folders(account_id,remote_id,parent_remote_id,name,path) VALUES (?,'child','target','Sub','Projects/Sub')",
            (account,),
        ).lastrowid
        message = db.execute(
            "INSERT INTO messages(account_id,remote_folder_id,sender,recipient,subject,body,date,remote_key) VALUES (?,?,'a@example.org','test@example.org','Keep','Body','2026-09-14T00:00:00Z','immutable-key')",
            (account, origin),
        ).lastrowid
    return account, origin, target, child, message


def test_filing_to_remote_tree_is_local_and_searches_descendants(client):
    _, origin, target, child, id = seed_remote()
    assert (
        client.post(
            "/api/messages/move", json={"ids": [id], "folder": f"remote:{child}"}
        ).status_code
        == 200
    )
    saved = client.get(f"/api/messages/{id}").json()
    assert saved["remote_folder_id"] == origin and saved["remote_key"] == "immutable-key"
    assert saved["local_destination_id"] == child and saved["local_folder_override"] == 1
    assert not client.get(f"/api/messages?folder=remote&remote_folder_id={origin}").json()
    assert client.get(f"/api/messages?folder=remote&remote_folder_id={child}").json()[0]["id"] == id
    assert (
        client.get(
            f"/api/messages?folder=remote&remote_folder_id={target}&scope=subfolders"
        ).json()[0]["id"]
        == id
    )
    client.patch(f"/api/messages/{id}", json={"folder": "trash"})
    client.post("/api/messages/restore", json={"ids": [id]})
    assert client.get(f"/api/messages?folder=remote&remote_folder_id={child}").json()[0]["id"] == id


def test_disconnect_preserves_mail_and_autosaved_drafts(client):
    account, _, _, child, id = seed_remote()
    saved = draft(client, account_id=account)["id"]
    client.post("/api/messages/move", json={"ids": [id], "folder": f"remote:{child}"})
    assert client.delete(f"/api/accounts/{account}").status_code == 200
    assert client.get(f"/api/messages/{saved}").json()["folder"] == "drafts"
    cached = client.get(f"/api/messages/{id}").json()
    assert cached["account_id"] is None and cached["body"] == "Body" and cached["folder"] == "inbox"
    assert not client.get("/api/remote-folders").json()


def test_theme_html_overrides_sender_important_colors(client):
    id = draft(client)["id"]
    with store.db() as db:
        db.execute(
            "UPDATE messages SET html_body=? WHERE id=?",
            ('<p style="color:black!important;background-color:white!important">Visible</p>', id),
        )
    config = client.get("/api/preferences").json()
    config["theme"].update({"dark": True, "surface": "#161b22", "text": "#e6edf3"})
    assert client.put("/api/preferences", json=config).status_code == 200
    response = client.get(f"/api/messages/{id}/html")
    assert "background:#161b22" in response.text and "color:#e6edf3" in response.text
    assert "color:black" not in response.text and "background-color:white" not in response.text
    assert "img-src 'none'" in response.headers["content-security-policy"]
    assert "background:#ffffff" in client.get(f"/api/messages/{id}/html?appearance=light").text
    assert client.get(f"/api/messages/{id}/html?appearance=%3Cscript%3E").status_code == 422


def test_send_directly_consumes_draft_and_cannot_send_same_id_twice(client, monkeypatch):
    account, *_ = seed_remote()
    saved = draft(client, account_id=account, recipient="you@example.org")
    calls = []
    monkeypatch.setattr(mail, "send_mail", lambda *args: calls.append(args))
    payload = {
        "account_id": account,
        "recipient": "you@example.org",
        "body": "Keep this",
        "subject": "Work in progress",
        "draft_id": saved["id"],
        "draft_revision": saved["draft_revision"],
    }
    assert client.post("/api/send", json=payload).status_code == 200
    assert client.post("/api/send", json=payload).status_code == 409
    assert len(calls) == 1
    assert client.get(f"/api/messages/{saved['id']}").status_code == 404
