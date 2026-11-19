import pytest
from inkwell import store
from inkwell.shortcuts import DEFAULTS


def add(date, subject="Boundary", folder="inbox"):
    with store.db() as db:
        return db.execute(
            "INSERT INTO messages(sender,recipient,subject,body,date,folder,starred) VALUES ('sender@example.org','me@example.org',?,'Cached',?,?,1)",
            (subject, date, folder),
        ).lastrowid


def test_dates_use_inclusive_local_days_and_keep_microseconds(client):
    dates = [
        "2026-03-08T04:59:59.999999Z",
        "2026-03-08T05:00:00Z",
        "2026-03-09T03:59:59.999999Z",
        "2026-03-09T04:00:00Z",
    ]
    ids = [add(date) for date in dates]
    base = "/api/messages?folder=inbox&scope=all&date_timezone=America/New_York"
    both = client.get(base + "&date_from=2026-03-08&date_to=2026-03-08").json()
    assert {m["id"] for m in both} == set(ids[1:3])
    assert len(client.get(base + "&date_from=2026-03-08").json()) == 3
    assert len(client.get(base + "&date_to=2026-03-08").json()) == 3
    assert len(client.get(base).json()) == 4
    assert len(client.get(base + "&q=Boundary&date_to=2026-03-08").json()) == 3
    assert client.get(base + "&q=absent&date_to=2026-03-08").json() == []


@pytest.mark.parametrize(
    "query",
    [
        "date_from=2026-02-30",
        "date_to=nope",
        "date_from=2026-09-16&date_to=2026-09-15",
        "date_from=2026-09-15&date_timezone=../../etc/passwd",
    ],
)
def test_bad_dates_rejected(client, query):
    assert client.get("/api/messages?folder=inbox&scope=all&" + query).status_code == 422


def test_fall_dst_extreme_years_and_filters_before_pagination(client):
    for date in ["2026-11-01T04:00:00Z", "2026-11-02T04:59:59.999999Z", "2026-11-02T05:00:00Z"]:
        add(date)
    add("9999-12-31T23:59:59.999999Z")
    response = client.get(
        "/api/messages?folder=inbox&scope=all&summary=true&date_from=2026-11-01&date_to=2026-11-01&date_timezone=America/New_York"
    ).json()
    assert response["total"] == 2 and len(response["messages"]) == 2
    assert len(client.get("/api/messages?folder=inbox&scope=all&date_to=9999-12-31").json()) == 4
    assert (
        len(
            client.get(
                "/api/messages?folder=inbox&scope=all&date_from=0001-01-01&date_timezone=Pacific/Kiritimati"
            ).json()
        )
        == 4
    )


def test_flags_are_persistent_local_and_independent_of_stars(client, monkeypatch):
    id = add("2026-09-15")
    with store.db() as db:
        before = dict(db.execute("SELECT * FROM messages WHERE id=?", (id,)).fetchone())
    assert client.patch(f"/api/messages/{id}", json={"flagged": True}).status_code == 200
    assert (
        client.get("/api/messages?folder=inbox&summary=true").json()["messages"][0]["flagged"] == 1
    )
    store.init()
    with store.db() as db:
        after = dict(db.execute("SELECT * FROM messages WHERE id=?", (id,)).fetchone())
    assert {**before, "flagged": 1} == after
    client.patch(f"/api/messages/{id}", json={"flagged": False})
    assert client.get(f"/api/messages/{id}").json()["starred"] == 1
    with store.db() as db:
        db.execute("ALTER TABLE messages DROP COLUMN flagged")
        db.execute("DROP TABLE mail_sync_state")
        db.execute("PRAGMA user_version=13")
    store.init()
    store.init()
    with store.db() as db:
        assert dict(db.execute("SELECT * FROM messages WHERE id=?", (id,)).fetchone()) == before


def test_dates_and_flags_apply_to_collections_before_pagination(client):
    for _ in range(101):
        add("2090-05-02T12:00:00Z")
    id = add("2090-05-01T12:00:00Z", folder="archive")
    client.patch(f"/api/messages/{id}", json={"flagged": True})
    query = {
        "kind": "sender",
        "key": "sender@example.org",
        "date_from": "2090-05-01",
        "date_to": "2090-05-01",
    }
    data = client.post("/api/collections/query", json=query).json()
    assert (
        data["total"] == 1
        and data["messages"][0]["id"] == id
        and data["messages"][0]["flagged"] == 1
    )
    data = client.get(
        "/api/messages?folder=inbox&scope=all&summary=true&date_from=2090-05-02"
    ).json()
    assert data["total"] == 101 and len(data["messages"]) == 100


def test_shortcut_defaults_validation_and_partial_save(client):
    original = client.get("/api/preferences").json()
    assert original["shortcuts"] == DEFAULTS
    response = client.patch("/api/preferences/workspace", json={"shortcuts": {"sync": "F8"}})
    assert response.status_code == 200
    assert response.json() == {**original, "shortcuts": {**DEFAULTS, "sync": "F8"}}
    assert client.get("/api/preferences").json()["shortcuts"]["sync"] == "F8"
    for bindings in [
        {"sync": "C"},
        {"sync": "Ctrl+C"},
        {"sync": "javascript:bad"},
        {"unknown": "F8"},
    ]:
        assert (
            client.patch("/api/preferences/workspace", json={"shortcuts": bindings}).status_code
            == 422
        )
    assert (
        client.patch("/api/preferences/workspace", json={"shortcuts": {"sync": ""}}).json()[
            "shortcuts"
        ]["sync"]
        == ""
    )
