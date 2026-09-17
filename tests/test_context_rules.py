import json
import pytest
from inkwell import store, rules


def message(sender="Writer <writer@example.co.uk>", folder="inbox"):
    with store.db() as db:
        return db.execute(
            "INSERT INTO messages(sender,recipient,subject,body,date,folder,local_folder_override) VALUES (?,'me@example.net','Example subject','Keep body','2026-09-14',?,1)",
            (sender, folder),
        ).lastrowid


def rule(client, field="tld", value=".UK", actions=None):
    result = client.post(
        "/api/rules",
        json={
            "name": "Selected rule",
            "conditions": [{"field": field, "operator": "is", "value": value}],
            "actions": actions or [{"type": "star"}],
        },
    )
    assert result.status_code == 200, result.text
    return result.json()["id"]


def test_seed_sender_subject_domain_and_final_label(client):
    id = message()
    data = client.get(f"/api/rules/from-message/{id}").json()
    assert data["values"] == {
        "sender": "writer@example.co.uk",
        "domain": "example.co.uk",
        "tld": "uk",
        "subject": "Example subject",
    }
    assert data["can_apply"] and data["message_id"] == id
    assert client.get("/api/rules/from-message/999999").status_code == 404
    unknown = message("Unknown")
    assert (
        client.get(f"/api/rules/from-message/{unknown}").json()["rule"]["conditions"][0]["field"]
        == "subject"
    )


def test_explicit_rule_applies_only_selected_copy_despite_earlier_rules(client):
    first = message(folder="archive")
    second = message()
    rule(client, actions=[{"type": "move", "value": "trash"}])
    chosen = rule(client)
    result = client.post(f"/api/rules/{chosen}/apply-message", json={"message_id": first})
    assert result.json() == {"applied": True}
    assert client.get(f"/api/messages/{first}").json()["starred"] == 1
    assert client.get(f"/api/messages/{first}").json()["folder"] == "archive"
    assert client.get(f"/api/messages/{second}").json()["starred"] == 0
    assert (
        client.post(f"/api/rules/{chosen}/apply-message", json={"message_id": 999999}).status_code
        == 404
    )


@pytest.mark.parametrize(
    "sender,expected",
    [
        ("a@one.ca", True),
        ("a@other.CA", True),
        ("a@one.ca.evil", False),
        ("a@example.com", False),
        ("a@localhost", False),
        ("a@127.0.0.1", False),
    ],
)
def test_tld_matching_is_exact_final_label(client, sender, expected):
    id = message(sender)
    rid = rule(client, value=".ca")
    assert (
        client.post(f"/api/rules/{rid}/apply-message", json={"message_id": id}).json()["applied"]
        == expected
    )


@pytest.mark.parametrize("value", ["co.uk", "com.evil", "*", "123", "-com"])
def test_invalid_tld_values_rejected(value):
    with pytest.raises(ValueError):
        rules.Condition(field="tld", operator="is", value=value)


@pytest.mark.parametrize("folder", ["drafts", "sent"])
def test_apply_protects_outgoing_copies(client, folder):
    id = message(folder=folder)
    rid = rule(client)
    assert not client.get(f"/api/rules/from-message/{id}").json()["can_apply"]
    assert (
        client.post(f"/api/rules/{rid}/apply-message", json={"message_id": id}).status_code == 422
    )
    assert client.get(f"/api/messages/{id}").json()["starred"] == 0


def test_selected_rule_overflow_is_atomic_and_schema_nine_upgrade_preserves_mail(client):
    id = message()
    client.patch(f"/api/messages/{id}", json={"tags": [f"Tag{i}" for i in range(12)]})
    tag = client.post("/api/tags", json={"name": "One more"}).json()["id"]
    rid = rule(
        client, actions=[{"type": "move", "value": "trash"}, {"type": "add_tag", "value": str(tag)}]
    )
    assert client.post(f"/api/rules/{rid}/apply-message", json={"message_id": id}).json() == {
        "applied": False
    }
    with store.db() as db:
        db.execute("PRAGMA user_version=9")
    store.init()
    with store.db() as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 16
    result = client.get(f"/api/messages/{id}").json()
    assert (
        result["folder"] == "inbox"
        and result["body"] == "Keep body"
        and len(json.loads(result["tags"])) == 12
    )
