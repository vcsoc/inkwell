from email import policy
from email.parser import BytesParser
import pytest
from inkwell import store


@pytest.mark.parametrize(
    "sender",
    [
        "Writer <writer@example.org>",
        "Immigration, Refugees and Citizenship Canada <government@example.org>",
        "Partial <",
    ],
)
def test_eml_export_is_read_only_and_round_trips_cached_mail(client, sender):
    with store.db() as db:
        id = db.execute(
            "INSERT INTO messages(sender,recipient,cc,bcc,subject,body,html_body,date,folder,remote_key) VALUES (?,'you@example.org','copy@example.org','blind@example.org',?,?,'<p>Hello <b>world</b></p>','2026-09-14T12:00:00+00:00','inbox','preserve-provider-id')",
            (sender, "../Test\r\nX-Injected: bad", "Hello world"),
        ).lastrowid
        before = tuple(db.execute("SELECT * FROM messages WHERE id=?", (id,)).fetchone())
    response = client.get(f"/api/messages/{id}/eml")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("message/rfc822")
    assert "/" not in response.headers["content-disposition"].split("filename=")[1]
    assert response.headers["cache-control"] == "no-store"
    mail = BytesParser(policy=policy.default).parsebytes(response.content)
    assert mail["X-Injected"] is None
    assert mail["Bcc"] == "blind@example.org"
    assert mail.get_body(preferencelist=("plain",)).get_content().strip() == "Hello world"
    assert (
        mail.get_body(preferencelist=("html",)).get_content().strip() == "<p>Hello <b>world</b></p>"
    )
    assert "Cached reconstruction" in mail["X-Inkwell-Export"]
    with store.db() as db:
        assert tuple(db.execute("SELECT * FROM messages WHERE id=?", (id,)).fetchone()) == before


def test_eml_export_missing_and_oversized_ids(client):
    assert client.get("/api/messages/999999/eml").status_code == 404
    assert client.get("/api/messages/9223372036854775808/eml").status_code == 422


def test_explicit_run_of_disabled_saved_rule_does_not_enable_it(client):
    with store.db() as db:
        id = db.execute(
            "INSERT INTO messages(sender,recipient,subject,body,date) VALUES ('a@example.org','b@example.org','Saved execution','Body','2026-09-14')"
        ).lastrowid
    rule = client.post(
        "/api/rules",
        json={
            "name": "Disabled manual",
            "enabled": False,
            "conditions": [{"field": "subject", "operator": "is", "value": "Saved execution"}],
            "actions": [{"type": "star"}],
        },
    ).json()["id"]
    assert (
        client.post(
            "/api/rules/run", json={"rule_id": rule, "scope": "message", "message_id": id}
        ).json()["matched"]
        == 1
    )
    assert client.get("/api/rules").json()[0]["enabled"] is False
