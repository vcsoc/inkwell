"""Unsupported or unauthorized edits must never masquerade as synchronized writes."""

import pytest

from inkwell import mail, microsoft, store


@pytest.mark.parametrize("provider", ["imap", "microsoft"])
def test_unauthorized_actions_are_atomic_and_disconnect_keeps_mail(client, monkeypatch, provider):
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
                f'{account_id}:graph:server-message' if provider == 'microsoft' else f'{account_id}:INBOX:1:1',
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
        assert client.patch(f"/api/messages/{message_id}", json=changes).status_code == 409
    saved = client.get(f'/api/messages/{message_id}').json()
    assert saved['folder'] == 'inbox' and saved['starred'] == 0
    with store.db() as db:
        assert db.execute('SELECT count(*) FROM provider_jobs').fetchone()[0] == 0
    assert client.delete(f"/api/accounts/{account_id}").status_code == 200
