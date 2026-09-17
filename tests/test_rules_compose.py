import json
import pytest
from inkwell import store, rules, mail, microsoft, addresses


def imported(subject="ABC invoice", **fields):
    with store.db() as db:
        id = db.execute(
            "INSERT INTO messages(sender,recipient,subject,body,date,remote_key) VALUES ('Writer <writer@example.org>','me@example.net',?,'Project details','2020-01-01T00:00:00Z',?)",
            (subject, "import:" + subject),
        ).lastrowid
        for key, value in fields.items():
            assert key in {"unread", "starred", "local_folder_override", "folder", "tags"}
            db.execute(f"UPDATE messages SET {key}=? WHERE id=?", (value, id))
    return id


def rule_payload(**fields):
    return {
        "name": "ABC to XYZ",
        "mode": "all",
        "conditions": [{"field": "subject", "operator": "contains", "value": "abc"}],
        "actions": [{"type": "move", "value": "archive"}, {"type": "mark_read"}, {"type": "star"}],
        **fields,
    }


def account(client):
    return client.post(
        "/api/accounts",
        json={
            "name": "Sender",
            "email": "sender@example.com",
            "username": "sender@example.com",
            "password": "test-only",
            "imap_host": "imap.example.com",
            "smtp_host": "smtp.example.com",
            "smtp_port": 465,
            "smtp_security": "tls",
        },
    ).json()["id"]


def test_rule_multiple_conditions_and_actions_apply_together(client):
    folder = client.post("/api/local-folders", json={"name": "XYZ"}).json()["id"]
    tag = client.post("/api/tags", json={"name": "Review", "color": "#2664a0"}).json()["id"]
    yes = imported()
    no = imported("Unrelated invoice")
    payload = rule_payload(
        conditions=[
            {"field": "subject", "operator": "contains", "value": "ABC"},
            {"field": "domain", "operator": "is", "value": "example.org"},
        ],
        actions=[
            {"type": "move", "value": "local-" + str(folder)},
            {"type": "mark_read"},
            {"type": "star"},
            {"type": "add_tag", "value": str(tag)},
        ],
    )
    response = client.post("/api/rules", json=payload)
    assert response.status_code == 200, response.text
    assert client.post("/api/rules/apply").json()["matched"] == 1
    result = client.get(f"/api/messages/{yes}").json()
    assert (result["folder"], result["unread"], result["starred"], json.loads(result["tags"])) == (
        "local-" + str(folder),
        0,
        1,
        ["Review"],
    )
    assert client.get(f"/api/messages/{no}").json()["folder"] == "inbox"
    assert client.delete(f"/api/local-folders/{folder}").status_code == 409
    assert client.post("/api/rules/apply").json()["matched"] == 0


def test_any_conditions_legacy_rules_and_first_match(client):
    id = imported("Different subject")
    payload = rule_payload(
        mode="any",
        conditions=[
            {"field": "subject", "operator": "contains", "value": "ABC"},
            {"field": "sender", "operator": "is", "value": "writer@example.org"},
        ],
    )
    first = client.post("/api/rules", json=payload).json()["id"]
    assert (
        client.post(
            "/api/rules",
            json={"name": "Legacy", "match": "domain", "value": "EXAMPLE.ORG", "folder": "trash"},
        ).status_code
        == 200
    )
    assert client.post("/api/rules/apply").json()["matched"] == 1
    assert client.get(f"/api/messages/{id}").json()["folder"] == "archive"
    listed = client.get("/api/rules").json()
    assert listed[1]["conditions"][0]["value"] == "example.org"
    assert client.put(f"/api/rules/{first}", json={**payload, "enabled": False}).status_code == 200


@pytest.mark.parametrize(
    ("condition", "expected"),
    [
        ({"field": "subject", "operator": "not_contains", "value": "missing"}, True),
        ({"field": "subject", "operator": "starts_with", "value": "ABC"}, True),
        ({"field": "subject", "operator": "ends_with", "value": "invoice"}, True),
        ({"field": "body", "operator": "contains", "value": "DETAILS"}, True),
        ({"field": "recipient", "operator": "is", "value": "me@example.net"}, True),
        ({"field": "unread", "operator": "is", "value": "false"}, False),
        ({"field": "starred", "operator": "not_is", "value": "true"}, True),
        ({"field": "age_days", "operator": "gt", "value": "1"}, True),
        ({"field": "age_days", "operator": "lt", "value": "1"}, False),
    ],
)
def test_condition_operators(client, condition, expected):
    id = imported()
    assert client.post("/api/rules", json=rule_payload(conditions=[condition])).status_code == 200
    with store.db() as db:
        assert rules.apply(db, id) == expected


def test_rule_overflow_or_missing_resource_never_partially_changes_mail(client):
    id = imported(tags=json.dumps([f"Tag{i}" for i in range(12)]))
    tag = client.post("/api/tags", json={"name": "Thirteenth", "color": "#abcdef"}).json()["id"]
    payload = rule_payload(
        actions=[
            {"type": "move", "value": "trash"},
            {"type": "mark_read"},
            {"type": "add_tag", "value": str(tag)},
        ]
    )
    assert client.post("/api/rules", json=payload).status_code == 200
    assert client.post("/api/rules/apply").json()["matched"] == 0
    m = client.get(f"/api/messages/{id}").json()
    assert (m["folder"], m["unread"], m["local_folder_override"]) == ("inbox", 1, 0)
    with store.db() as db:
        db.execute("DELETE FROM tag_catalog WHERE id=?", (tag,))
    assert client.post("/api/rules/apply").json()["matched"] == 0
    broken = client.get("/api/rules").json()[0]
    assert broken["problem"]
    assert (
        client.put(
            "/api/rules/" + str(broken["id"]), json={**payload, "enabled": False}
        ).status_code
        == 200
    )
    assert (
        client.put("/api/rules/" + str(broken["id"]), json={**payload, "enabled": True}).status_code
        == 404
    )


def test_rule_tag_references_follow_rename_merge_and_disable_on_delete(client):
    ids = [
        client.post("/api/tags", json={"name": name, "color": "#2664a0"}).json()["id"]
        for name in ["A", "B"]
    ]
    payload = rule_payload(
        conditions=[{"field": "tag", "operator": "is", "value": str(ids[0])}],
        actions=[{"type": "add_tag", "value": str(ids[1])}],
    )
    assert client.post("/api/rules", json=payload).status_code == 200
    client.put("/api/tags/" + str(ids[0]), json={"name": "Renamed", "color": "#abcdef"})
    id = imported(tags=json.dumps(["Renamed"]))
    assert client.post("/api/rules/apply").json()["matched"] == 1
    assert json.loads(client.get(f"/api/messages/{id}").json()["tags"]) == ["Renamed", "B"]
    merged = client.post("/api/tags/merge", json={"ids": ids, "name": "Merged"}).json()["id"]
    rule = client.get("/api/rules").json()[0]
    assert rule["conditions"][0]["value"] == rule["actions"][0]["value"] == str(merged)
    client.post("/api/tags/delete", json={"ids": [merged]})
    assert client.get("/api/rules").json()[0]["enabled"] is False


@pytest.mark.parametrize(
    "changes",
    [
        {"conditions": []},
        {"actions": []},
        {"mode": "sql"},
        {"conditions": [{"field": "body", "operator": "regex", "value": ".*"}]},
        {"conditions": [{"field": "unread", "operator": "contains", "value": "yes"}]},
        {"actions": [{"type": "move", "value": "drafts"}]},
        {"actions": [{"type": "move", "value": "archive"}, {"type": "move", "value": "trash"}]},
        {"actions": [{"type": "delete_on_server"}]},
    ],
)
def test_invalid_rule_builders_rejected(client, changes):
    assert client.post("/api/rules", json=rule_payload(**changes)).status_code == 422
    assert client.get("/api/rules").json() == []


def test_drafts_cc_bcc_history_survive_resume_delete_and_schema_upgrade(client):
    draft = client.post(
        "/api/drafts",
        json={
            "recipient": "Person <Past.User@example.com>",
            "cc": "copy@example.com",
            "bcc": "hidden@example.com",
        },
    ).json()
    m = client.get("/api/messages/" + str(draft["id"])).json()
    assert m["cc"] == "copy@example.com" and m["bcc"] == "hidden@example.com"
    assert client.get("/api/addresses?q=person").json()[0]["address"] == "Past.User@example.com"
    client.delete("/api/messages/" + str(draft["id"]))
    assert client.get("/api/addresses?q=hidden").json()[0]["address"] == "hidden@example.com"
    # A real v7 shape, not only a changed version number.
    with store.db() as db:
        db.execute(
            "INSERT INTO messages(sender,recipient,subject,body,date) VALUES ('Old <old@example.com>','known@example.com','Keep','Body','2020-01-01')"
        )
        db.execute("ALTER TABLE messages DROP COLUMN cc")
        db.execute("ALTER TABLE messages DROP COLUMN bcc")
        db.execute("DROP TABLE address_history")
        db.execute("DROP TABLE not_junk_senders")
        db.execute("PRAGMA user_version=7")
    store.init()
    store.init()
    assert client.get("/api/addresses?q=old").json()[0]["address"] == "old@example.com"
    with store.db() as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 16


def test_send_multiple_recipients_and_bcc_only_preserve_local_sent(client, monkeypatch):
    id = account(client)
    sent = []
    monkeypatch.setattr(mail, "send_mail", lambda *args, **kwargs: sent.append((args, kwargs)))
    payload = {
        "account_id": id,
        "recipient": "One <one@example.com>; two@example.com",
        "cc": "copy@example.com, ONE@example.com",
        "bcc": "hidden@example.com",
        "subject": "Delivery",
        "body": "Text",
    }
    response = client.post("/api/send", json=payload)
    assert response.status_code == 200, response.text
    assert sent[0][1] == {"cc": "copy@example.com", "bcc": "hidden@example.com"}
    local = client.get("/api/messages/" + str(response.json()["id"])).json()
    assert local["bcc"] == "hidden@example.com"
    assert (
        client.post("/api/send", json={"account_id": id, "bcc": "private@example.com"}).status_code
        == 200
    )
    assert len(sent) == 2


@pytest.mark.parametrize("field", ["recipient", "cc", "bcc"])
def test_invalid_recipients_or_header_injection_never_submit(client, monkeypatch, field):
    id = account(client)
    calls = []
    monkeypatch.setattr(mail, "send_mail", lambda *args, **kwargs: calls.append(args))
    for value in ["bad", "good@example.com,broken", "good@example.com\r\nBcc: attack@example.com"]:
        assert (
            client.post(
                "/api/send",
                json={"account_id": id, "recipient": "reader@example.com", field: value},
            ).status_code
            == 422
        )
    assert calls == []


def test_smtp_bcc_is_envelope_only(client, monkeypatch):
    sent = []

    class SMTP:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def login(self, *args):
            pass

        def send_message(self, message, **kwargs):
            sent.append((message, kwargs))

    monkeypatch.setattr(mail.smtplib, "SMTP_SSL", lambda *args, **kwargs: SMTP())
    mail.send_mail(
        {
            "email": "sender@example.com",
            "smtp_security": "tls",
            "smtp_host": "smtp.example.com",
            "smtp_port": 465,
            "username": "sender",
            "secret": store.seal("secret"),
        },
        "one@example.com, two@example.com",
        "Subject",
        "Body",
        cc="copy@example.com",
        bcc="hidden@example.com",
    )
    message, kwargs = sent[0]
    assert message["Cc"] == "copy@example.com" and message["Bcc"] is None
    assert "hidden@example.com" not in message.as_string()
    assert kwargs["to_addrs"] == [
        "one@example.com",
        "two@example.com",
        "copy@example.com",
        "hidden@example.com",
    ]


def test_graph_to_cc_bcc_buckets(client, monkeypatch):
    calls = []

    class HTTP:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, *args, **kwargs):
            calls.append(kwargs["json"])
            return type("Response", (), {"status_code": 202})()

    monkeypatch.setattr(microsoft, "client", HTTP)
    monkeypatch.setattr(microsoft, "access_token", lambda account: "mock-token")
    microsoft.send_mail(
        {"email": "me@example.com"},
        "Name <one@example.com>, two@example.com",
        "Subject",
        "Body",
        cc="copy@example.com",
        bcc="hidden@example.com",
    )
    body = calls[0]["message"]
    for key, expected in [
        ("toRecipients", ["one@example.com", "two@example.com"]),
        ("ccRecipients", ["copy@example.com"]),
        ("bccRecipients", ["hidden@example.com"]),
    ]:
        assert [r["emailAddress"]["address"] for r in body[key]] == expected


def test_autocomplete_contacts_history_and_literal_search(client):
    contact = client.post(
        "/api/contacts", json={"name": "Previously used", "email": "past@example.com"}
    ).json()["id"]
    client.delete("/api/contacts/" + str(contact))
    assert client.get("/api/addresses?q=Previously").json()[0]["address"] == "past@example.com"
    assert client.get("/api/addresses?q=%").json() == []
    assert client.delete("/api/addresses").status_code == 200
    assert client.get("/api/addresses?q=past").json() == []
    with pytest.raises(ValueError):
        addresses.normalize(", ".join(f"user{i}@example.com" for i in range(101)))


def test_named_unicode_addresses_and_search_before_limit(client):
    assert (
        addresses.normalize('"Doe, Zoë" <zoe@example.com>; next@example.com')[0]
        == '"Doe, Zoë" <zoe@example.com>, next@example.com'
    )
    client.post("/api/drafts", json={"recipient": "=?utf-8?b?Wm/Dqw==?= <zoe@example.com>"})
    assert client.get("/api/addresses?q=Zoë").json()[0]["name"] == "Zoë"
    with store.db() as db:
        addresses.remember(db, "needle@example.com")
        for i in range(100):
            addresses.remember(db, f"frequent{i}@example.com")
    assert client.get("/api/addresses?q=needle").json()[0]["address"] == "needle@example.com"
    assert len(client.get("/api/addresses").json()) == 30
