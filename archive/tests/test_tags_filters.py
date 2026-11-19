import json
import pytest
from inkwell import store


def message(client, tags=(), folder="inbox"):
    id = client.post(
        "/api/drafts", json={"subject": "Tagged message", "body": "Preserve body"}
    ).json()["id"]
    assert (
        client.patch(f"/api/messages/{id}", json={"folder": folder, "tags": list(tags)}).status_code
        == 200
    )
    return id


def catalog(client):
    return {row["name"]: row for row in client.get("/api/tags").json()}


def test_catalog_create_color_rename_and_unused_tags(client):
    id = message(client, ["Work", "follow up"])
    tag = catalog(client)["Work"]
    assert tag["count"] == 1 and tag["color"].startswith("#")
    assert (
        client.put(f"/api/tags/{tag['id']}", json={"name": "WORK", "color": "#ABCDEF"}).status_code
        == 200
    )
    assert json.loads(client.get(f"/api/messages/{id}").json()["tags"]) == ["WORK", "follow up"]
    assert catalog(client)["WORK"]["color"] == "#abcdef"
    assert client.post("/api/tags", json={"name": "Unused", "color": "#123456"}).status_code == 200
    assert catalog(client)["Unused"]["count"] == 0
    assert client.post("/api/tags", json={"name": "unused", "color": "#123456"}).status_code == 409
    client.patch(f"/api/messages/{id}", json={"tags": ["work"]})
    assert json.loads(client.get(f"/api/messages/{id}").json()["tags"]) == ["WORK"]


def test_merge_deduplicates_every_folder_and_keeps_target_color(client):
    ids = [
        message(client, ["A", "B", "Target"], folder) for folder in ["inbox", "archive", "trash"]
    ]
    tags = catalog(client)
    color = tags["Target"]["color"]
    response = client.post(
        "/api/tags/merge", json={"ids": [tags["A"]["id"], tags["B"]["id"]], "name": "target"}
    )
    assert response.status_code == 200 and response.json()["updated_messages"] == 3
    for id in ids:
        row = client.get(f"/api/messages/{id}").json()
        assert json.loads(row["tags"]) == ["Target"] and row["body"] == "Preserve body"
    assert catalog(client)["Target"]["count"] == 3 and catalog(client)["Target"]["color"] == color
    assert client.post("/api/tags/delete", json={"ids": [tags["Target"]["id"]]}).status_code == 200
    assert not catalog(client)
    assert all(client.get(f"/api/messages/{id}").json()["tags"] == "[]" for id in ids)


def test_casefold_exact_tag_filter_and_atomic_missing_source(client):
    id = message(client, ["Straße"])
    tag = catalog(client)["Straße"]
    assert client.post("/api/tags", json={"name": "STRASSE"}).status_code == 409
    assert client.get(f"/api/messages?tag_id={tag['id']}").json()[0]["id"] == id
    assert client.post("/api/tags/delete", json={"ids": [tag["id"], 99999]}).status_code == 404
    assert catalog(client)["Straße"]["count"] == 1
    assert (
        client.post("/api/tags/merge", json={"ids": [tag["id"], 99999], "name": "New"}).status_code
        == 404
    )
    assert "New" not in catalog(client)


def test_bulk_assignment_limit_is_atomic_and_does_not_change_local_state(client):
    first = message(client, ["Keep"], "archive")
    full = message(client, [f"t{i}" for i in range(12)])
    target = client.post("/api/tags", json={"name": "Added", "color": "#ffdc60"}).json()["id"]
    assert (
        client.post("/api/tags/assign", json={"ids": [first, full], "tag_id": target}).status_code
        == 409
    )
    assert json.loads(client.get(f"/api/messages/{first}").json()["tags"]) == ["Keep"]
    assert (
        client.post("/api/tags/assign", json={"ids": [first], "tag_id": target}).status_code == 200
    )
    row = client.get(f"/api/messages/{first}").json()
    assert row["folder"] == "archive" and json.loads(row["tags"]) == ["Keep", "Added"]
    assert (
        client.post(
            "/api/tags/assign", json={"ids": [first], "tag_id": target, "add": False}
        ).status_code
        == 200
    )


@pytest.mark.parametrize(
    "body",
    [
        {"name": "bad,tag"},
        {"name": "bad\u007ftag"},
        {"name": "X" * 33},
        {"name": "ok", "color": "red"},
        {"name": "ok", "color": "#ffffff;display:none"},
    ],
)
def test_catalog_validation(client, body):
    assert client.post("/api/tags", json=body).status_code == 422


def test_schema_six_migration_backfills_and_deduplicates_tags(client):
    id = message(client, ["Work"])
    with store.db() as db:
        db.execute("ALTER TABLE messages DROP COLUMN cc")
        db.execute("ALTER TABLE messages DROP COLUMN bcc")
        db.execute("DROP TABLE address_history")
        db.execute("DROP TABLE not_junk_senders")
        db.execute("DROP TABLE tag_catalog")
        db.execute("DROP INDEX tagged_messages")
        db.execute(
            "UPDATE messages SET tags=? WHERE id=?",
            (json.dumps([" Work ", "work", "Personal"]), id),
        )
        db.execute("PRAGMA user_version=6")
    store.init()
    store.init()
    assert set(catalog(client)) == {"Work", "Personal"}
    assert json.loads(client.get(f"/api/messages/{id}").json()["tags"]) == ["Work", "Personal"]


def test_filters_and_totals_apply_before_pagination(client):
    with store.db() as db:
        db.executemany(
            "INSERT INTO messages(sender,recipient,subject,body,date,unread,starred) VALUES ('same@example.org','me@example.org',?,'body',?,0,0)",
            [(f"Bulk {i:03}", "2099-01-01T00:00:00Z") for i in range(130)],
        )
        old = db.execute(
            "INSERT INTO messages(sender,recipient,subject,body,date,unread,starred) VALUES ('same@example.org','me@example.org','Old unread','body','2000-01-01T00:00:00Z',1,1)"
        ).lastrowid
    client.patch(f"/api/messages/{old}", json={"tags": ["Special"]})
    tag = catalog(client)["Special"]["id"]
    result = client.get(
        f"/api/messages?unread_only=true&starred_only=true&tag_state=tagged&tag_id={tag}&summary=true"
    ).json()
    assert result["total"] == 1 and result["messages"][0]["id"] == old
    assert client.get("/api/messages?tag_state=untagged&summary=true").json()["total"] == 130
    page = client.get("/api/messages?sort_by=subject&sort_order=asc&offset=100&summary=true").json()
    assert page["total"] == 131 and page["messages"][0]["subject"] == "Bulk 100"
    collection = client.post(
        "/api/collections/query",
        json={"kind": "sender", "key": "same@example.org", "unread_only": True, "tag_id": tag},
    ).json()
    assert collection["total"] == 1 and collection["messages"][0]["id"] == old
    assert client.get("/api/messages?sort_by=body;DROP%20TABLE%20messages").status_code == 422


def test_quick_view_preferences_merge_without_losing_theme(client):
    theme = client.get("/api/preferences").json()["theme"]
    result = client.patch(
        "/api/preferences/workspace",
        json={
            "mail_view": "table",
            "mail_sort": "sender",
            "mail_order": "asc",
            "quick_filter_pinned": True,
        },
    ).json()
    assert result["theme"] == theme and result["mail_view"] == "table"
    assert client.get("/api/preferences").json()["mail_sort"] == "sender"
