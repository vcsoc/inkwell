import json
from inkwell import store
from inkwell.attachment_status import record


def test_indicator_has_three_states_and_uses_this_message_not_thread(client):
    ids = []
    for title in ("with file", "without file", "unknown"):
        m = client.post("/api/drafts", json={"subject": title, "body": "Body"}).json()
        ids.append(m["id"])
        assert client.patch(f"/api/messages/{m['id']}", json={"folder": "inbox"}).status_code == 200
    with store.db() as db:
        record(db, ids[0], True)
        record(db, ids[1], False)
        db.execute(
            "INSERT INTO attachment_views VALUES (?,?)",
            (
                ids[1],
                json.dumps(
                    {
                        "groups": [
                            {"selected": True, "checked": True, "files": []},
                            {"selected": False, "files": [{"name": "Other message.pdf"}]},
                        ]
                    }
                ),
            ),
        )
    data = {m["id"]: m["has_attachments"] for m in client.get("/api/messages?folder=inbox").json()}
    assert [data[id] for id in ids] == [True, False, None]
    with store.db() as db:
        db.execute("DELETE FROM messages WHERE id=?", (ids[0],))
        assert not db.execute(
            "SELECT * FROM message_attachment_status WHERE message_id=?", (ids[0],)
        ).fetchone()
