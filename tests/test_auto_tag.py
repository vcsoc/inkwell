import json
from inkwell import store, rules


def test_domain_auto_tag_existing_and_future_imports_without_refiling(client):
    def imported(sender, apply=False):
        with store.db() as db:
            id = db.execute(
                "INSERT INTO messages(sender,recipient,subject,body,date,remote_key) VALUES (?,'me@example.net','Topic','Keep','2026-09-14',?)",
                (sender, sender),
            ).lastrowid
            if apply:
                rules.apply(db, id)
            return id

    old = imported("old@example.com")
    tag = client.post("/api/tags", json={"name": "example"}).json()["id"]
    response = client.post(
        "/api/rules",
        json={
            "name": "Auto-tag example",
            "conditions": [{"field": "domain", "operator": "is", "value": "@EXAMPLE.COM"}],
            "actions": [{"type": "add_tag", "value": str(tag)}],
        },
    )
    assert response.status_code == 200, response.text
    assert client.post("/api/rules/apply").json()["matched"] == 1
    yes = imported("New <new@example.com>", True)
    for sender in ["other@sub.example.com", "fake@example.com.evil", "lookalike@notexample.com"]:
        id = imported(sender, True)
        assert json.loads(client.get(f"/api/messages/{id}").json()["tags"]) == []
    for id in [old, yes]:
        message = client.get(f"/api/messages/{id}").json()
        assert json.loads(message["tags"]) == ["example"]
        assert message["folder"] == "inbox" and message["unread"] == 1 and message["body"] == "Keep"
