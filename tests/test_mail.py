"""Transport contract tests. No real credentials or network access are used."""

import ssl

import pytest

from inkwell import mail, store


@pytest.fixture
def account(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path)
    store.init()
    return {
        "id": 1,
        "email": "me@example.com",
        "username": "me@example.com",
        "secret": store.seal("app-password"),
        "imap_host": "imap.example.com",
        "imap_port": 993,
        "smtp_host": "smtp.example.com",
        "smtp_port": 465,
        "smtp_security": "tls",
    }


def test_imap_readonly_peek_and_idempotency(account, monkeypatch):
    from inkwell.rules import Rule

    with store.db() as db:
        db.execute(
            "INSERT INTO mail_rules(config) VALUES (?)",
            (Rule(name="Friends", value="friend@example.com", folder="archive").model_dump_json(),),
        )
    calls = []

    class IMAP:
        def __init__(self, host, port, ssl_context, timeout):
            assert host == "imap.example.com" and port == 993
            assert ssl_context.verify_mode == ssl.CERT_REQUIRED
            assert ssl_context.check_hostname

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def login(self, user, password):
            assert password == "app-password"

        def select(self, folder, readonly):
            assert folder == "INBOX" and readonly is True
            return "OK", [b"2"]

        def response(self, name):
            assert name == "UIDVALIDITY"
            return name, [b"123"]

        def uid(self, command, *args):
            calls.append((command, args))
            if command == "search":
                return "OK", [b"1 2"]
            if args[1] == "(RFC822.SIZE)":
                return "OK", [b"1 (RFC822.SIZE 500)"]
            assert args[1] == "(BODY.PEEK[] FLAGS)"
            return "OK", [
                (
                    b"1 (BODY[] {150}",
                    b"From: Friend <friend@example.com>\r\nTo: me@example.com\r\nSubject: Hello\r\nContent-Type: text/plain\r\n\r\nSafe mail",
                ),
                b" FLAGS (\\Seen))",
            ]

    monkeypatch.setattr(mail.imaplib, "IMAP4_SSL", IMAP)
    assert mail.sync_account(account) == 2
    assert mail.sync_account(account) == 0
    with store.db() as db:
        messages = db.execute("SELECT * FROM messages").fetchall()
    assert len(messages) == 2
    assert messages[0]["unread"] == 0
    assert all(m["folder"] == "archive" and m["local_folder_override"] == 1 for m in messages)
    assert messages[0]["remote_key"] == "1:INBOX:123:1"
    assert all(command in ("fetch", "search") for command, _ in calls)


@pytest.mark.parametrize("security", ["tls", "starttls"])
def test_smtp_requires_verified_tls_before_login(account, monkeypatch, security):
    calls = []
    account["smtp_security"] = security
    account["smtp_port"] = 465 if security == "tls" else 587

    class SMTP:
        def __init__(self, host, port, timeout, context=None):
            if context:
                assert context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname
                calls.append("tls")

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def ehlo(self):
            calls.append("ehlo")

        def starttls(self, context):
            assert context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname
            calls.append("tls")

        def login(self, username, password):
            assert "tls" in calls
            assert password == "app-password"
            calls.append("login")

        def send_message(self, message):
            assert "login" in calls
            assert message["To"] == "friend@example.com"
            assert message["From"] == "me@example.com"
            assert message["Message-ID"] and message["Date"]
            assert message.get_content().strip() == "Hello friend"
            calls.append("send")

    monkeypatch.setattr(mail.smtplib, "SMTP", SMTP)
    monkeypatch.setattr(mail.smtplib, "SMTP_SSL", SMTP)
    mail.send_mail(account, "friend@example.com", "A greeting", "Hello friend")
    assert calls[-2:] == ["login", "send"]
