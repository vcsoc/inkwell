import sqlite3

from inkwell import store
from inkwell.message_keys import domain_key, sender_key, subject_key


def insert(sender, subject, folder="inbox", account_id=1, body="A body"):
    with store.db() as db:
        return db.execute(
            "INSERT INTO messages(account_id,folder,sender,recipient,subject,body,date) VALUES (?,?,?,?,?,?,?)",
            (
                account_id,
                folder,
                sender,
                "me@example.net",
                subject,
                body,
                "2026-09-13T12:00:00+00:00",
            ),
        ).lastrowid


def test_key_normalization():
    assert sender_key("Alice <ALICE@Example.COM>") == "alice@example.com"
    assert domain_key("Alice <alice@bücher.example>") == "xn--bcher-kva.example"
    assert domain_key("Alice <alice@sub.example.com>") == "sub.example.com"
    assert sender_key("Unknown") == ""
    assert subject_key("  Re: FWD: re[2]:  Quarterly   Update  ") == "quarterly update"
    assert subject_key("(No subject)") == subject_key("") == ""


def test_collections_across_folders_accounts_and_subject_prefixes(client):
    first = insert("Alice <ALICE@example.com>", "Quarterly update")
    second = insert("Alice <alice@EXAMPLE.com>", "RE: Quarterly update", "archive", 2)
    third = insert("Bob <bob@example.com>", "Fwd: Quarterly update", "trash", 2)
    fourth = insert("News <news@sub.example.com>", "Unrelated", "inbox", 3)
    insert("Other <someone@other.com>", "Different", "sent", 3)
    for kind, expected in [
        ("sender", {first, second}),
        ("organisation", {first, second, third}),
        ("subject", {first, second, third}),
    ]:
        descriptor = client.get(f"/api/collections/from-message/{first}?kind={kind}").json()
        result = client.post(
            "/api/collections/query", json={k: descriptor[k] for k in ("kind", "key")}
        ).json()
        assert result["total"] == len(expected)
        assert {row["id"] for row in result["messages"]} == expected
        assert all("body" not in row for row in result["messages"])
    assert fourth not in expected
    assert client.get(f"/api/collections/from-message/{first}?kind=bad").status_code == 422
    assert client.get("/api/collections/from-message/99999?kind=sender").status_code == 404


def test_collection_pagination_search_and_deleted_source(client):
    ids = [
        insert(
            "Team <team@example.com>", "Topic " + str(i), body="needle" if i == 0 else "Other text"
        )
        for i in range(103)
    ]
    query = {"kind": "sender", "key": "team@example.com"}
    first = client.post("/api/collections/query", json=query).json()
    second = client.post("/api/collections/query", json={**query, "offset": 100}).json()
    assert first["total"] == 103 and len(first["messages"]) == 100
    assert len(second["messages"]) == 3
    assert not {m["id"] for m in first["messages"]} & {m["id"] for m in second["messages"]}
    assert client.post("/api/collections/query", json={**query, "q": "needle"}).json()["total"] == 1
    client.patch(f"/api/messages/{ids[0]}", json={"folder": "trash"})
    client.delete(f"/api/messages/{ids[0]}")
    assert client.post("/api/collections/query", json=query).json()["total"] == 102
    assert client.post("/api/collections/query", json={**query, "offset": -1}).status_code == 422


def test_keys_updated_and_indexed(client):
    mid = insert("Alice <alice@example.com>", "Re: Subject")
    with store.db() as db:
        row = db.execute(
            "SELECT sender_key,domain_key,subject_key FROM messages WHERE id=?", (mid,)
        ).fetchone()
        assert tuple(row) == ("alice@example.com", "example.com", "subject")
        db.execute(
            "UPDATE messages SET sender=?,subject=? WHERE id=?",
            ("Bob <bob@another.com>", "New subject", mid),
        )
        row = db.execute(
            "SELECT sender_key,domain_key,subject_key FROM messages WHERE id=?", (mid,)
        ).fetchone()
        assert tuple(row) == ("bob@another.com", "another.com", "new subject")
        plan = db.execute(
            "EXPLAIN QUERY PLAN SELECT id FROM messages WHERE domain_key=? ORDER BY date DESC,id DESC",
            ("another.com",),
        ).fetchall()
        assert any("message_domain_key_date" in row[3] for row in plan)


def test_collection_migration_backfills_existing_mail(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path)
    with sqlite3.connect(tmp_path / "inkwell.db") as db:
        db.execute(
            "CREATE TABLE messages(id INTEGER PRIMARY KEY,account_id INTEGER,remote_key TEXT UNIQUE,folder TEXT DEFAULT 'inbox',sender TEXT,recipient TEXT,subject TEXT,body TEXT,date TEXT,unread INTEGER DEFAULT 1,starred INTEGER DEFAULT 0,demo INTEGER DEFAULT 0)"
        )
        db.execute(
            "INSERT INTO messages(sender,recipient,subject,body,date) VALUES ('Old <old@example.com>','me@example.net','Re: Original','Preserve this','2026-09-13')"
        )
    store.init()
    store.init()
    with store.db() as db:
        row = db.execute("SELECT sender_key,domain_key,subject_key,body FROM messages").fetchone()
        assert tuple(row) == ("old@example.com", "example.com", "original", "Preserve this")
        assert db.execute("PRAGMA user_version").fetchone()[0] == 11
