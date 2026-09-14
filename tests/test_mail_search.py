import pytest
from inkwell import store


def message(client, subject="Topic", folder="inbox", tags=(), **fields):
    id = client.post(
        "/api/drafts", json={"subject": subject, "body": "Plain body", **fields}
    ).json()["id"]
    assert (
        client.patch(
            f"/api/messages/{id}",
            json={"folder": "inbox" if folder == "sent" else folder, "tags": list(tags)},
        ).status_code
        == 200
    )
    if folder == "sent":
        with store.db() as db:
            db.execute("UPDATE messages SET folder='sent' WHERE id=?", (id,))
    return id


def search(client, q, **params):
    result = client.get("/api/messages", params={"scope": "all", "q": q, **params})
    assert result.status_code == 200, result.text
    return {row["id"] for row in result.json()}


def test_all_scope_includes_cached_junk_archive_and_inbox(client):
    inbox = message(client, "Needle inbox")
    archive = message(client, "Needle archive", "archive")
    junk = message(client, "Needle junk")
    with store.db() as db:
        folder = db.execute(
            "INSERT INTO remote_folders(account_id,remote_id,name,path,well_known) VALUES (1,'junk','Junk Email','Junk Email','junkemail')"
        ).lastrowid
        db.execute(
            "UPDATE messages SET folder='remote',remote_folder_id=?,local_folder_override=0 WHERE id=?",
            (folder, junk),
        )
    assert search(client, "Needle") == {inbox, archive, junk}
    assert search(client, "Needle", scope="folder") == {inbox}
    assert search(client, "Needle", scope="folder", remote_folder_id=folder) == {junk}
    assert search(client, "Needle", remote_folder_id=999999) == {inbox, archive, junk}


@pytest.mark.parametrize(
    "query", ["éQUIPE", "e\u0301quipe", "tag:équipe", "tags:ÉQUIPE", 'tag:"Équipe"', "#équipe"]
)
def test_unicode_tag_search_across_folders(client, query):
    id = message(client, folder="sent", tags=["Équipe"])
    message(client, subject="No tag")
    assert search(client, query) == {id}


def test_tag_only_partial_exact_and_hash_labels(client):
    first = message(client, tags=["Work"])
    second = message(client, tags=["Work projects"])
    hashed = message(client, tags=["#Work"])
    body_only = message(client, subject="Work")
    assert search(client, "Work") == {first, second, hashed, body_only}
    assert search(client, "tag:Work") == {first, second, hashed}
    assert search(client, 'tag:"Work"') == {first}
    assert search(client, "#Work") == {first, hashed}
    assert search(client, "tag:") == set()
    ticket = message(client, subject="Ticket #12345")
    assert search(client, "#12345") == {ticket}


def test_literal_wildcards_and_recipient_headers(client):
    percent = message(
        client, "Budget 100% complete", cc="copy@example.org", bcc="private@example.org"
    )
    message(client, "Budget 100x complete")
    tagged = message(client, tags=["Plan_100%"])
    assert search(client, "100%") == {percent, tagged}
    assert search(client, "_100%") == {tagged}
    assert search(client, "copy@example.org") == {percent}
    assert search(client, "private@example.org") == {percent}
    assert search(client, "%' OR 1=1--") == set()


def test_collection_tag_search_and_pre_pagination_totals(client):
    for _ in range(102):
        message(client, tags=["Équipe"])
    result = client.get(
        "/api/messages", params={"scope": "all", "q": "tag:équipe", "summary": "true"}
    ).json()
    assert result["total"] == 102 and len(result["messages"]) == 100
    assert len(search(client, "tag:équipe", offset=100)) == 2
    collection = client.post(
        "/api/collections/query", json={"kind": "subject", "key": "topic", "q": "tag:équipe"}
    ).json()
    assert collection["total"] == 102 and len(collection["messages"]) == 100
