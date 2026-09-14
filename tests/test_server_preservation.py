"""Local message management must not mutate the provider's mailbox."""

import pytest

from inkwell import mail, microsoft, store


@pytest.mark.parametrize("provider", ["imap", "microsoft"])
def test_local_actions_and_disconnect_never_contact_mail_server(client, monkeypatch, provider):
    def forbidden(*args, **kwargs):
        pytest.fail("Local message actions must not contact the server")

    monkeypatch.setattr(mail.imaplib, "IMAP4_SSL", forbidden)
    monkeypatch.setattr(microsoft, "client", forbidden)
    with store.db() as db:
        account_id = db.execute(
            """INSERT INTO accounts(name,email,imap_host,imap_port,smtp_host,smtp_port,
            username,secret,smtp_security,provider) VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                "Test",
                "test@example.com",
                "imap.example.com",
                993,
                "smtp.example.com",
                465,
                "test@example.com",
                store.seal("test-only"),
                "tls",
                provider,
            ),
        ).lastrowid
        message_id = db.execute(
            """INSERT INTO messages(account_id,remote_key,sender,recipient,subject,body,date)
            VALUES (?,?,?,?,?,?,?)""",
            (
                account_id,
                "server-message",
                "sender@example.com",
                "test@example.com",
                "Keep server copy",
                "Test",
                "2026-09-13T00:00:00Z",
            ),
        ).lastrowid
    for changes in (
        {"unread": False},
        {"starred": True},
        {"folder": "archive"},
        {"folder": "inbox"},
        {"folder": "trash"},
    ):
        assert client.patch(f"/api/messages/{message_id}", json=changes).status_code == 200
    assert client.delete(f"/api/messages/{message_id}").status_code == 200
    assert client.delete(f"/api/accounts/{account_id}").status_code == 200
