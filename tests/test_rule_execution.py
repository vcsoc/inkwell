import json

from inkwell import rules, store


def message(folder="inbox", **values):
    with store.db() as db:
        id = db.execute(
            "INSERT INTO messages(sender,recipient,subject,body,date,folder) VALUES ('a@example.com','b@example.net','Chain','Body','2026-09-14',?)",
            (folder,),
        ).lastrowid
        for key, value in values.items():
            db.execute(f"UPDATE messages SET {key}=? WHERE id=?", (value, id))
        return id


def rule(client, name, actions, stop=True, conditions=None):
    response = client.post(
        "/api/rules",
        json={
            "name": name,
            "conditions": conditions or [{"field": "subject", "operator": "is", "value": "Chain"}],
            "actions": actions,
            "stop_processing": stop,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def get(id):
    with store.db() as db:
        return dict(db.execute("SELECT * FROM messages WHERE id=?", (id,)).fetchone())


def test_chain_reads_prior_actions_and_stop_and_import_order(client):
    tag = client.post("/api/tags", json={"name": "Chain tag"}).json()["id"]
    first = rule(client, "First", [{"type": "add_tag", "value": str(tag)}], False)
    second = rule(
        client,
        "Second",
        [{"type": "star"}],
        True,
        [{"field": "tag", "operator": "is", "value": str(tag)}],
    )
    rule(client, "Third", [{"type": "move", "value": "trash"}])
    id = message()
    with store.db() as db:
        assert rules.apply(db, id)
    assert get(id)["starred"] == 1 and get(id)["folder"] == "inbox"
    assert (
        client.post(
            "/api/rules/reorder", json={"id": second, "target_id": first, "placement": "before"}
        ).status_code
        == 200
    )
    id2 = message()
    with store.db() as db:
        assert rules.apply(db, id2)
    assert get(id2)["starred"] == 0 and get(id2)["folder"] == "trash"
    assert [r["id"] for r in client.get("/api/rules").json()][:2] == [second, first]


def test_scoped_runs_snapshot_folder_and_include_managed_copies(client):
    chosen = rule(client, "Move", [{"type": "move", "value": "archive"}])
    ids = [
        message(local_folder_override=1),
        message(),
        message("archive"),
        message("drafts"),
        message("sent"),
        message("trash", restore_folder="sent"),
    ]
    result = client.post(
        "/api/rules/run", json={"rule_id": chosen, "scope": "folder", "folder": "inbox"}
    ).json()
    assert result["matched"] == 2
    assert all(get(id)["folder"] == "archive" for id in ids[:3])
    result = client.post("/api/rules/run", json={"scope": "all"}).json()
    assert result == {"matched": 3, "scanned": 6, "eligible": 3, "skipped": 3}
    assert (
        get(ids[3])["folder"] == "drafts"
        and get(ids[4])["folder"] == "sent"
        and get(ids[5])["folder"] == "trash"
    )


def test_selected_rule_runs_alone_and_bad_scopes_do_not_change_mail(client):
    rule(client, "First", [{"type": "move", "value": "trash"}])
    second = rule(client, "Second", [{"type": "star"}])
    id = message()
    other = message()
    before = get(other)
    result = client.post(
        "/api/rules/run", json={"scope": "message", "message_id": id, "rule_id": second}
    )
    assert (
        result.json()["matched"] == 1 and get(id)["folder"] == "inbox" and get(id)["starred"] == 1
    )
    assert get(other) == before
    for payload in [
        {"scope": "message"},
        {"scope": "message", "message_id": 99999},
        {"scope": "folder", "folder": "local-9999"},
        {"scope": "folder", "folder": "remote:" + str(2**80)},
        {"rule_id": 9999},
    ]:
        assert client.post("/api/rules/run", json=payload).status_code in (404, 422)
    assert get(other) == before


def test_priority_move_preserves_configs_and_invalid_moves_are_atomic(client):
    ids = [rule(client, str(i), [{"type": "star"}]) for i in range(3)]
    with store.db() as db:
        before = {r["id"]: r["config"] for r in db.execute("SELECT * FROM mail_rules")}
    response = client.post(
        "/api/rules/reorder", json={"id": ids[0], "target_id": ids[2], "placement": "after"}
    )
    assert response.json()["ids"] == ids[1:] + ids[:1]
    assert (
        client.post("/api/rules/reorder", json={"id": ids[0], "target_id": 9999}).status_code == 404
    )
    with store.db() as db:
        assert {r["id"]: r["config"] for r in db.execute("SELECT * FROM mail_rules")} == before
    store.init()
    assert [r["id"] for r in client.get("/api/rules").json()] == ids[1:] + ids[:1]


def test_schema_twelve_upgrade_preserves_legacy_first_match(client):
    ids = [rule(client, str(i), [{"type": "star"}]) for i in range(2)]
    with store.db() as db:
        for row in db.execute("SELECT * FROM mail_rules").fetchall():
            config = json.loads(row["config"])
            config.pop("stop_processing")
            db.execute("UPDATE mail_rules SET config=? WHERE id=?", (json.dumps(config), row["id"]))
        db.execute("ALTER TABLE mail_rules DROP COLUMN position")
        db.execute("PRAGMA user_version=12")
        before = [tuple(r) for r in db.execute("SELECT * FROM mail_rules")]
    store.init()
    with store.db() as db:
        assert [tuple(r) for r in db.execute("SELECT id,config FROM mail_rules")] == before
    result = client.get("/api/rules").json()
    assert [r["id"] for r in result] == ids and all(r["stop_processing"] for r in result)


def test_remote_scope_retains_membership_and_protects_outgoing_imports(client):
    with store.db() as db:
        folder = db.execute(
            "INSERT INTO remote_folders(account_id,remote_id,name,path) VALUES (1,'source','Source','Source')"
        ).lastrowid
        sent = db.execute(
            "INSERT INTO remote_folders(account_id,remote_id,name,path,well_known) VALUES (1,'sent','Sent','Sent','sentitems')"
        ).lastrowid
    incoming = message("remote", remote_folder_id=folder, remote_key="provider-incoming")
    outgoing = message("remote", remote_folder_id=sent, remote_key="provider-sent")
    rule(client, "Star", [{"type": "star"}], False)
    result = client.post(
        "/api/rules/run", json={"scope": "folder", "folder": "remote:" + str(folder)}
    ).json()
    assert result["matched"] == 1
    assert (
        get(incoming)["remote_key"] == "provider-incoming"
        and get(incoming)["remote_folder_id"] == folder
    )
    assert get(incoming)["local_destination_id"] == folder and get(incoming)["folder"] == "remote"
    assert (
        client.post(
            "/api/rules/run", json={"scope": "folder", "folder": "remote:" + str(folder)}
        ).json()["matched"]
        == 1
    )
    with store.db() as db:
        assert not rules.apply(db, outgoing)
    assert get(outgoing)["starred"] == 0


def test_manual_chain_keeps_not_junk_protection_and_strict_identifiers(client):
    id = message()
    with store.db() as db:
        db.execute(
            "INSERT INTO not_junk_senders(sender_key,created_at) VALUES ('a@example.com','2026-09-14')"
        )
    rule(client, "Unsafe", [{"type": "move", "value": "trash"}])
    rule(client, "Safe", [{"type": "star"}])
    assert (
        client.post("/api/rules/run", json={"scope": "message", "message_id": id}).json()["matched"]
        == 1
    )
    assert get(id)["folder"] == "inbox" and get(id)["starred"] == 1
    before = get(id)
    for payload in [{"rule_id": True}, {"message_id": "1", "scope": "message"}]:
        assert client.post("/api/rules/run", json=payload).status_code == 422
    assert get(id) == before
