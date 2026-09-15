from inkwell import store


def create(client, name, parent=""):
    r = client.post("/api/local-folders", json={"name": name, "parent": parent})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def move(client, identifier, target="", placement="inside"):
    return client.post(
        "/api/local-folders/move", json={"id": identifier, "target": target, "placement": placement}
    )


def children(client, parent=""):
    return [r["id"] for r in client.get("/api/local-folders").json() if r["parent"] == parent]


def test_order_move_and_append_are_persistent(client):
    a = create(client, "A")
    b = create(client, "B")
    c = create(client, "C")
    assert move(client, c, f"local-{a}", "before").status_code == 200
    assert children(client) == [c, a, b]
    assert move(client, c, f"local-{a}", "after").status_code == 200
    assert children(client) == [a, c, b]
    assert move(client, a, "archive").status_code == 200
    assert children(client) == [c, b]
    assert children(client, "archive") == [a]
    d = create(client, "D")
    assert children(client) == [c, b, d]
    store.init()
    assert children(client) == [c, b, d]
    assert move(client, a, f"local-{c}", "before").status_code == 200
    assert children(client) == [a, c, b, d]


def test_cycles_conflicts_and_missing_targets_are_atomic(client):
    a = create(client, "A")
    b = create(client, "B", f"local-{a}")
    create(client, "A", "archive")
    before = client.get("/api/local-folders").json()
    for target, placement, status in [
        (f"local-{a}", "inside", 422),
        (f"local-{b}", "inside", 422),
        (f"local-{b}", "before", 422),
        ("archive", "inside", 409),
        ("remote:999999", "inside", 404),
        ("local-999999", "after", 404),
        ("inbox", "before", 422),
    ]:
        assert move(client, a, target, placement).status_code == status
        assert client.get("/api/local-folders").json() == before
    assert move(client, 999999, "inbox").status_code == 404


def test_subtree_move_preserves_mail_rules_and_provider_metadata(client):
    a = create(client, "Parent")
    b = create(client, "Child", f"local-{a}")
    msg = client.post("/api/drafts", json={"subject": "Keep content", "body": "Unchanged"}).json()[
        "id"
    ]
    rule = client.post(
        "/api/rules",
        json={
            "name": "Keep reference",
            "conditions": [{"field": "subject", "operator": "contains", "value": "Keep"}],
            "actions": [{"type": "move", "value": f"local-{b}"}],
        },
    )
    assert rule.status_code == 200, rule.text
    with store.db() as db:
        db.execute(
            "UPDATE messages SET folder=?,remote_key=? WHERE id=?",
            (f"local-{b}", "provider-identity", msg),
        )
        remote = db.execute(
            "INSERT INTO remote_folders(account_id,remote_id,name,path) VALUES (90,'root','Remote','Remote')"
        ).lastrowid
        mail = [tuple(r) for r in db.execute("SELECT * FROM messages ORDER BY id")]
        rules = [tuple(r) for r in db.execute("SELECT * FROM mail_rules")]
        remotes = [tuple(r) for r in db.execute("SELECT * FROM remote_folders")]
    assert move(client, a, f"remote:{remote}").status_code == 200
    assert (
        next(r for r in client.get("/api/local-folders").json() if r["id"] == b)["path"]
        == "Remote / Parent / Child"
    )
    with store.db() as db:
        assert [tuple(r) for r in db.execute("SELECT * FROM messages ORDER BY id")] == mail
        assert [tuple(r) for r in db.execute("SELECT * FROM mail_rules")] == rules
        assert [tuple(r) for r in db.execute("SELECT * FROM remote_folders")] == remotes


def test_subtree_height_is_checked_not_just_parent_depth(client):
    parent = ""
    for index in range(31):
        parent = "local-" + str(create(client, str(index), parent))
    a = create(client, "Moving")
    create(client, "Leaf", f"local-{a}")
    before = client.get("/api/local-folders").json()
    assert move(client, a, parent).status_code == 422
    assert client.get("/api/local-folders").json() == before


def test_orphaned_branches_reorder_with_visible_root_folders(client):
    a = create(client, "A")
    with store.db() as db:
        remote = db.execute(
            "INSERT INTO remote_folders(account_id,remote_id,name,path) VALUES (90,'gone','Gone','Gone')"
        ).lastrowid
    b = create(client, "B", f"remote:{remote}")
    c = create(client, "C")
    with store.db() as db:
        db.execute("DELETE FROM remote_folders WHERE id=?", (remote,))
    assert move(client, c, f"local-{b}", "before").status_code == 200
    assert [r["id"] for r in client.get("/api/local-folders").json()] == [a, c, b]
    assert move(client, b, f"local-{c}", "before").status_code == 200
    assert children(client) == [a, b, c]
    d = create(client, "D")
    assert children(client) == [a, b, c, d]


def test_order_migration_preserves_old_alphabetical_order(client):
    z = create(client, "Z")
    a = create(client, "A")
    b = create(client, "B", "inbox")
    with store.db() as db:
        db.execute("ALTER TABLE local_folders DROP COLUMN position")
        db.execute("PRAGMA user_version=11")
    store.init()
    assert children(client) == [a, z]
    assert children(client, "inbox") == [b]
    with store.db() as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 14
