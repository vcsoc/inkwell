from inkwell import store


def message(client, subject, folder="inbox"):
    identifier = client.post(
        "/api/drafts", json={"subject": subject, "body": "Keep content"}
    ).json()["id"]
    with store.db() as db:
        db.execute(
            "UPDATE messages SET folder=?,remote_key=? WHERE id=?",
            (folder, "provider-" + str(identifier), identifier),
        )
    return identifier


def test_delete_is_two_stage_and_local_only(client):
    ids = [message(client, "One"), message(client, "Two", "drafts")]
    r = client.post("/api/messages/trash-selection", json={"ids": ids + [ids[0]]})
    assert r.json() == {"trashed": 2}
    with store.db() as db:
        rows = [
            dict(db.execute("SELECT * FROM messages WHERE id=?", (id,)).fetchone()) for id in ids
        ]
        assert [r["restore_folder"] for r in rows] == ["inbox", "drafts"]
        assert all(
            r["folder"] == "trash"
            and r["body"] == "Keep content"
            and r["remote_key"] == "provider-" + str(r["id"])
            for r in rows
        )
    assert client.post(
        "/api/messages/trash-selection", json={"ids": ids, "permanent": True}
    ).json() == {"deleted": 2}
    with store.db() as db:
        assert all(
            db.execute("SELECT 1 FROM messages WHERE id=?", (id,)).fetchone() is None for id in ids
        )


def test_permanent_delete_rejects_nontrash_or_stale_selection_atomically(client):
    a = message(client, "Trash", "trash")
    b = message(client, "Inbox")
    for ids, status in [([a, b], 409), ([a, 999999], 404)]:
        assert (
            client.post(
                "/api/messages/trash-selection", json={"ids": ids, "permanent": True}
            ).status_code
            == status
        )
        assert client.get("/api/messages/" + str(a)).status_code == 200
    assert (
        client.post("/api/messages/trash-selection", json={"ids": [b, 999999]}).status_code == 404
    )
    assert client.get("/api/messages/" + str(b)).json()["folder"] == "inbox"


def test_mixed_soft_delete_keeps_trashed_copy_and_its_restore_origin(client):
    a = message(client, "A")
    b = message(client, "B", "archive")
    client.post("/api/messages/trash-selection", json={"ids": [b]})
    assert client.post("/api/messages/trash-selection", json={"ids": [a, b]}).status_code == 200
    with store.db() as db:
        assert (
            db.execute("SELECT restore_folder FROM messages WHERE id=?", (b,)).fetchone()[0]
            == "archive"
        )
    assert client.post("/api/messages/restore", json={"ids": [a, b]}).status_code == 200


def test_delete_request_validation(client):
    for body in [
        {"ids": []},
        {"ids": [True]},
        {"ids": [2**64]},
        {"ids": [1], "permanent": "true"},
        {"ids": [1] * 501},
    ]:
        assert client.post("/api/messages/trash-selection", json=body).status_code == 422
