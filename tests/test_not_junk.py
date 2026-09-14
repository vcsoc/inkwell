import pytest
from inkwell import store, rules, not_junk


def message(
    sender="Person <person@example.org>", subject="Normal", folder="inbox", override=0, remote=None
):
    with store.db() as db:
        return db.execute(
            "INSERT INTO messages(sender,recipient,subject,body,date,folder,local_folder_override,remote_folder_id) VALUES (?,?,?,?,?,?,?,?)",
            (
                sender,
                "me@example.net",
                subject,
                "Keep body",
                "2020-01-01T00:00:00Z",
                folder,
                override,
                remote,
            ),
        ).lastrowid


def row(client, id):
    return client.get("/api/messages/" + str(id)).json()


def test_not_junk_refiles_all_exact_sender_copies_using_rules_or_inbox(client):
    selected = message(folder="trash", override=1)
    matched = message(
        sender="PERSON@example.org", subject="ABC invoice", folder="archive", override=1
    )
    other = message(sender="different@example.org", folder="trash")
    sent = message(folder="sent")
    draft = message(folder="drafts")
    folder = client.post("/api/local-folders", json={"name": "XYZ"}).json()["id"]
    client.post(
        "/api/rules",
        json={
            "name": "Subject",
            "conditions": [{"field": "subject", "operator": "contains", "value": "abc"}],
            "actions": [{"type": "move", "value": "local-" + str(folder)}, {"type": "star"}],
        },
    )
    result = client.post(f"/api/messages/{selected}/not-junk")
    assert result.status_code == 200, result.text
    assert result.json() == {"sender": "person@example.org", "updated_messages": 2}
    assert row(client, selected)["folder"] == "inbox"
    assert (
        row(client, matched)["folder"] == "local-" + str(folder)
        and row(client, matched)["starred"] == 1
    )
    assert row(client, other)["folder"] == "trash"
    assert row(client, sent)["folder"] == "sent" and row(client, draft)["folder"] == "drafts"
    assert row(client, selected)["body"] == "Keep body" and row(client, selected)["unread"] == 1
    assert client.get("/api/not-junk-senders").json()[0]["sender_key"] == "person@example.org"


def test_future_import_hook_uses_remembered_decision_and_forgetting_keeps_existing(client):
    id = message()
    client.post(f"/api/messages/{id}/not-junk")
    future = message(folder="remote")
    with store.db() as db:
        assert rules.apply(db, future)
    assert (
        row(client, future)["folder"] == "inbox"
        and row(client, future)["local_folder_override"] == 1
    )
    client.delete("/api/not-junk-senders?sender=PERSON@example.org")
    assert client.get("/api/not-junk-senders").json() == []
    newer = message(folder="remote")
    with store.db() as db:
        assert not rules.apply(db, newer)
    assert row(client, newer)["folder"] == "remote" and row(client, future)["folder"] == "inbox"


def test_not_junk_skips_junk_trash_rules_but_keeps_normal_rule_actions(client):
    id = message(folder="trash")
    with store.db() as db:
        remote = db.execute(
            "INSERT INTO remote_folders(account_id,remote_id,name,path,well_known) VALUES (1,'junk','Courrier indésirable','Junk','junkemail')"
        ).lastrowid
    for target in ["trash", "remote:" + str(remote)]:
        assert (
            client.post(
                "/api/rules",
                json={
                    "name": target,
                    "conditions": [{"field": "subject", "operator": "contains", "value": "normal"}],
                    "actions": [{"type": "move", "value": target}, {"type": "mark_read"}],
                },
            ).status_code
            == 200
        )
    client.post(
        "/api/rules",
        json={
            "name": "Normal handling",
            "conditions": [{"field": "subject", "operator": "contains", "value": "normal"}],
            "actions": [{"type": "star"}],
        },
    )
    client.post(f"/api/messages/{id}/not-junk")
    m = row(client, id)
    assert (m["folder"], m["starred"], m["unread"]) == ("inbox", 1, 1)
    future = message(folder="remote", remote=remote)
    with store.db() as db:
        rules.apply(db, future)
    assert (
        row(client, future)["folder"] == "inbox"
        and row(client, future)["remote_folder_id"] == remote
    )


def test_sent_remote_and_trashed_drafts_are_not_reclassified(client):
    with store.db() as db:
        remote = db.execute(
            "INSERT INTO remote_folders(account_id,remote_id,name,path,well_known) VALUES (1,'sent','Sent','Sent','sentitems')"
        ).lastrowid
    sent = message(folder="remote", remote=remote)
    draft = message(folder="trash")
    with store.db() as db:
        db.execute("UPDATE messages SET draft_revision=1 WHERE id=?", (draft,))
    assert client.post(f"/api/messages/{sent}/not-junk").status_code == 422
    assert client.post(f"/api/messages/{draft}/not-junk").status_code == 422
    assert client.get("/api/not-junk-senders").json() == []


def test_not_junk_is_atomic_on_failure(client, monkeypatch):
    first = message(folder="trash")
    second = message(folder="archive")
    real = not_junk.file_copy

    def fail(db, m, configured=None):
        if m["id"] == second:
            raise RuntimeError("disk failure")
        return real(db, m, configured)

    monkeypatch.setattr(not_junk, "file_copy", fail)
    with pytest.raises(RuntimeError):
        client.post(f"/api/messages/{first}/not-junk")
    assert row(client, first)["folder"] == "trash"
    assert client.get("/api/not-junk-senders").json() == []


def test_invalid_sender_and_schema_eight_upgrade(client):
    id = message(sender="Unknown")
    assert client.post(f"/api/messages/{id}/not-junk").status_code == 422
    assert client.post("/api/messages/999999/not-junk").status_code == 404
    with store.db() as db:
        db.execute("DROP TABLE not_junk_senders")
        db.execute("PRAGMA user_version=8")
    store.init()
    store.init()
    assert row(client, id)["body"] == "Keep body"
    assert client.get("/api/not-junk-senders").json() == []


def test_sync_checks_localized_junk_for_trusted_senders_only_and_never_writes_provider(
    client, monkeypatch
):
    import httpx
    from inkwell import microsoft

    id = message()
    client.post(f"/api/messages/{id}/not-junk")
    store.init()
    with store.db() as db:
        db.execute(
            "INSERT INTO accounts(name,email,imap_host,imap_port,smtp_host,smtp_port,username,secret,smtp_security,provider) VALUES ('Mail','me@example.net','',993,'',587,'me@example.net','unused','starttls','microsoft')"
        )
    calls = []

    def handle(request):
        calls.append(request.method)
        path = request.url.path
        if path.endswith("/messages"):
            values = []
            if "/j/messages" in path:
                values = [
                    {
                        "id": key,
                        "subject": key,
                        "from": {"emailAddress": {"address": sender}},
                        "body": {"contentType": "text", "content": "Keep"},
                    }
                    for key, sender in [
                        ("trusted-future", "person@example.org"),
                        ("other-junk", "other@example.org"),
                    ]
                ]
            return httpx.Response(200, json={"value": values})
        roles = {"inbox": "i", "junkemail": "j", "sentitems": "s"}
        if path.rsplit("/", 1)[-1] in roles:
            return httpx.Response(200, json={"id": roles[path.rsplit("/", 1)[-1]]})
        if path.endswith("/mailFolders"):
            return httpx.Response(
                200,
                json={
                    "value": [
                        {"id": id, "displayName": name, "childFolderCount": 0}
                        for id, name in [
                            ("i", "Inbox"),
                            ("j", "Courrier indésirable"),
                            ("s", "Éléments envoyés"),
                        ]
                    ]
                },
            )
        return httpx.Response(404)

    monkeypatch.setattr(microsoft, "access_token", lambda account: "mock")
    monkeypatch.setattr(
        microsoft, "client", lambda: httpx.Client(transport=httpx.MockTransport(handle))
    )
    result = client.post("/api/sync").json()[0]
    assert result["added"] == 1 and "folder_error" not in result
    folders = client.get("/api/remote-folders").json()
    assert next(f for f in folders if f["remote_id"] == "j")["well_known"] == "junkemail"
    sent_folder = next(f for f in folders if f["remote_id"] == "s")
    sent = message(folder="remote", remote=sent_folder["id"])
    with store.db() as db:
        assert not rules.apply(db, sent)
    messages = client.get("/api/messages?scope=all").json()
    future = next(m for m in messages if m["subject"] == "trusted-future")
    assert future["folder"] == "inbox"
    assert not any(m["subject"] == "other-junk" for m in messages)
    client.patch("/api/messages/" + str(future["id"]), json={"folder": "trash"})
    client.post("/api/sync")
    assert row(client, future["id"])["folder"] == "trash"
    assert all(method == "GET" for method in calls)
