import pytest
from inkwell import store
from inkwell.message_keys import sender_key, domain_key

ADDRESS = "immigration.refugees.and.citizenship.canada.immigration.refugies.et.citoyennete.canada@notification.canada.ca"
DISPLAY = (
    "Immigration, Refugees and Citizenship Canada | Immigration Refugies et Citoyennete Canada"
)


@pytest.mark.parametrize("value", [ADDRESS, f"{DISPLAY} <{ADDRESS}>", f'"{DISPLAY}" <{ADDRESS}>'])
def test_long_sender_and_comma_display_name(value):
    assert sender_key(value) == ADDRESS
    assert domain_key(value) == "notification.canada.ca"


@pytest.mark.parametrize(
    "value",
    [
        "first@example.com, Other <second@example.org>",
        "First <first@example.com>, Other <second@example.org>",
        "Group <first@example.com,second@example.org>",
        "Name <first@example.com> trailing",
        "Name, Other\r\nInjected <second@example.com>",
        "Unknown",
    ],
)
def test_ambiguous_or_malformed_legacy_names_are_not_recovered(value):
    assert sender_key(value) == ""


def test_startup_repairs_existing_keys_and_not_junk_works_without_reimport(client):
    raw = f"{DISPLAY} <{ADDRESS}>"
    with store.db() as db:
        id = db.execute(
            "INSERT INTO messages(sender,recipient,subject,body,date,folder,remote_key) VALUES (?,'me@example.net','Notice','Keep content','2026-09-14','trash','original-provider-key')",
            (raw,),
        ).lastrowid
        db.execute("UPDATE messages SET sender_key='',domain_key='' WHERE id=?", (id,))
    store.init()
    store.init()
    with store.db() as db:
        row = db.execute("SELECT * FROM messages WHERE id=?", (id,)).fetchone()
        assert row["sender_key"] == ADDRESS and row["domain_key"] == "notification.canada.ca"
        assert (
            row["sender"] == raw
            and row["folder"] == "trash"
            and row["remote_key"] == "original-provider-key"
        )
    result = client.post(f"/api/messages/{id}/not-junk")
    assert result.status_code == 200, result.text
    assert result.json()["sender"] == ADDRESS
    assert client.get(f"/api/messages/{id}").json()["folder"] == "inbox"
