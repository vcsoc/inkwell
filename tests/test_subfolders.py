from inkwell import store


def create(client, name, parent=""):
    response = client.post("/api/local-folders", json={"name": name, "parent": parent})
    assert response.status_code == 200, response.text
    return response.json()["id"]


def test_nested_folders_names_and_delete_protection(client):
    first = create(client, "Projects", "inbox")
    child = create(client, "2026", f"local-{first}")
    create(client, "2026", "archive")
    assert (
        client.post(
            "/api/local-folders", json={"name": "2026", "parent": f"local-{first}"}
        ).status_code
        == 409
    )
    rows = client.get("/api/local-folders").json()
    assert next(r for r in rows if r["id"] == child)["path"] == "Inbox / Projects / 2026"
    assert client.delete(f"/api/local-folders/{first}").status_code == 409
    assert client.delete(f"/api/local-folders/{child}").status_code == 200
    assert client.delete(f"/api/local-folders/{first}").status_code == 200


def test_parent_validation_and_depth(client):
    for parent, status in [
        ("starred", 422),
        ("local-999999", 404),
        ("remote:999999", 404),
        ("remote:0", 422),
        ("local-1 OR 1=1", 422),
    ]:
        assert (
            client.post("/api/local-folders", json={"name": "Nested", "parent": parent}).status_code
            == status
        )
    parent = ""
    for index in range(32):
        parent = "local-" + str(create(client, str(index), parent))
    assert (
        client.post("/api/local-folders", json={"name": "Too deep", "parent": parent}).status_code
        == 422
    )


def test_local_descendant_search_includes_children_only_when_requested(client):
    parent = create(client, "Projects", "inbox")
    child = create(client, "Reports", f"local-{parent}")
    draft = client.post("/api/drafts", json={"subject": "Nested report", "body": "Find me"}).json()[
        "id"
    ]
    assert (
        client.post(
            "/api/messages/move", json={"ids": [draft], "folder": f"local-{child}"}
        ).status_code
        == 422
    )
    with store.db() as db:
        db.execute(
            "UPDATE messages SET folder=?,draft_revision=0 WHERE id=?", (f"local-{child}", draft)
        )
    assert (
        client.get("/api/messages", params={"folder": f"local-{parent}", "q": "Nested"}).json()
        == []
    )
    for folder in ["inbox", f"local-{parent}"]:
        found = client.get(
            "/api/messages", params={"folder": folder, "scope": "subfolders", "q": "Nested"}
        ).json()
        assert [r["id"] for r in found] == [draft]


def test_remote_parent_is_local_only_and_missing_parent_preserves_children(client):
    with store.db() as db:
        remote = db.execute(
            "INSERT INTO remote_folders(account_id,remote_id,name,path) VALUES (99,'provider-id','Work','Work')"
        ).lastrowid
    child = create(client, "Private", f"remote:{remote}")
    message = client.post("/api/drafts", json={"subject": "Private nested report"}).json()["id"]
    with store.db() as db:
        db.execute(
            "UPDATE messages SET folder=?,draft_revision=0 WHERE id=?", (f"local-{child}", message)
        )
    result = client.get(
        "/api/messages",
        params={"remote_folder_id": remote, "scope": "subfolders", "q": "Private nested"},
    ).json()
    assert [r["id"] for r in result] == [message]
    with store.db() as db:
        assert db.execute("SELECT count(*) FROM remote_folders").fetchone()[0] == 1
        db.execute("DELETE FROM remote_folders WHERE id=?", (remote,))
    row = next(r for r in client.get("/api/local-folders").json() if r["id"] == child)
    assert row["name"] == "Private" and row["path"] == "Private"


def test_schema_upgrade_keeps_ids_and_high_water_mark(client):
    with store.db() as db:
        db.execute("DROP TABLE local_folders")
        db.execute(
            "CREATE TABLE local_folders(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE)"
        )
        db.execute("INSERT INTO local_folders(id,name) VALUES (5,'Keep'),(50,'Removed')")
        db.execute("DELETE FROM local_folders WHERE id=50")
        db.execute("PRAGMA user_version=10")
    store.init()
    assert client.get("/api/local-folders").json() == [
        {"id": 5, "name": "Keep", "parent": "", "path": "Keep", "position": 0}
    ]
    assert create(client, "New") > 50
    store.init()
    with store.db() as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 14
