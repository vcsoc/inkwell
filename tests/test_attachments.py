from email.message import EmailMessage
from urllib.parse import parse_qs

import httpx
import pytest

from inkwell import attachments, microsoft, store, mail


def seed():
    with store.db() as db:
        db.execute(
            "INSERT INTO accounts(id,name,email,provider,imap_host,imap_port,smtp_host,smtp_port,username,secret,smtp_security) VALUES(1,'Work','me@example.org','microsoft','imap.example.org',993,'smtp.example.org',587,'me@example.org','','starttls')"
        )
        db.execute(
            "INSERT INTO messages(id,account_id,remote_key,sender,recipient,subject,body,date) VALUES(1,1,'1:graph:root','sender@example.org','me@example.org','Current message','Body','2099-01-02')"
        )


def source(id):
    return {
        "id": id,
        "conversationId": "conversation",
        "subject": "Current message" if id == "root" else "Earlier message",
        "from": {"emailAddress": {"address": "sender@example.org"}},
        "receivedDateTime": "2099-01-02T10:00:00Z" if id == "root" else "2099-01-01T10:00:00Z",
    }


def file(id, name, inline=False, kind="fileAttachment"):
    return {
        "id": id,
        "@odata.type": "#microsoft.graph." + kind,
        "name": name,
        "size": 5,
        "contentType": "application/pdf",
        "isInline": inline,
    }


def fixture(monkeypatch, override=None):
    calls = []

    def handle(request):
        calls.append(request)
        if override:
            value = override(request)
            if value is not None:
                return value
        path = request.url.path
        query = parse_qs(request.url.query.decode())
        if path.endswith("/$value"):
            return httpx.Response(200, content=b"%PDF!")
        if path.endswith("/root/attachments"):
            if query.get("page") == ["2"]:
                return httpx.Response(200, json={"value": [file("inline", "logo.png", True)]})
            return httpx.Response(
                200,
                json={
                    "value": [
                        file("report", "Report.pdf"),
                        file("cloud", "Shared workbook", kind="referenceAttachment"),
                    ],
                    "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/messages/root/attachments?page=2",
                },
            )
        if path.endswith("/earlier/attachments"):
            return httpx.Response(200, json={"value": [file("old", "Earlier.pdf")]})
        if path.endswith("/root"):
            return httpx.Response(200, json=source("root"))
        if path.endswith("/messages"):
            if query.get("page") == ["2"]:
                return httpx.Response(200, json={"value": [source("earlier")]})
            assert query["$filter"] == ["conversationId eq 'conversation'"]
            return httpx.Response(
                200,
                json={
                    "value": [source("root")],
                    "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/messages?page=2",
                },
            )
        raise AssertionError(str(request.url))

    monkeypatch.setattr(microsoft, "access_token", lambda a: "test-token")
    monkeypatch.setattr(
        microsoft, "client", lambda: httpx.Client(transport=httpx.MockTransport(handle))
    )
    return calls


def discover(client):
    data = client.post("/api/messages/1/attachments/refresh").json()
    for _ in range(15):
        if data["complete"] or data["error"]:
            return data
        data = client.post("/api/messages/1/attachments/continue").json()
    raise AssertionError("Discovery did not finish")


def test_entire_conversation_pagination_inline_types_and_download(client, monkeypatch):
    seed()
    calls = fixture(monkeypatch)
    result = discover(client)
    assert result["complete"] and result["scope"] == "thread" and not result["error"]
    assert len(result["groups"]) == 2
    files = [f for g in result["groups"] for f in g["files"]]
    assert {f["name"] for f in files} == {
        "Report.pdf",
        "Earlier.pdf",
        "Shared workbook",
        "logo.png",
    }
    assert next(f for f in files if f["inline"])["name"] == "logo.png"
    cloud = next(f for f in files if f["kind"] == "cloud")
    assert not cloud["downloadable"]
    count = len(calls)
    assert client.get("/api/messages/1/attachments/" + cloud["id"] + "/download").status_code == 422
    assert len(calls) == count
    old = next(f for f in files if f["name"] == "Earlier.pdf")
    response = client.get("/api/messages/1/attachments/" + old["id"] + "/download")
    assert response.content == b"%PDF!"
    assert response.headers["content-type"] == "application/octet-stream"
    assert "attachment;" in response.headers["content-disposition"]
    assert response.headers["content-security-policy"] == "sandbox; default-src 'none'"
    assert response.headers["x-frame-options"] == "DENY"
    assert all(c.method == "GET" for c in calls)
    assert calls[-1].url.path.endswith("/earlier/attachments/old/$value")
    with store.db() as db:
        assert db.execute("SELECT count(*) FROM messages").fetchone()[0] == 1


@pytest.mark.parametrize(
    "next_url",
    [
        "https://evil.example/token",
        "https://graph.microsoft.com/v1.0/me/messages/another/attachments",
        "https://graph.microsoft.com/v1.0/me/messages/../drive",
        "https://graph.microsoft.com/v1.0/me/messages/root/attachments",
    ],
)
def test_unsafe_or_repeating_pagination_stops_with_incomplete_state(client, monkeypatch, next_url):
    seed()

    def override(r):
        if r.url.path.endswith("/root/attachments"):
            # Repeat the actual initial URL for cycle detection.
            url = str(r.url) if next_url.endswith("/root/attachments") else next_url
            return httpx.Response(200, json={"value": [], "@odata.nextLink": url})

    calls = fixture(monkeypatch, override)
    result = discover(client)
    assert result["error"] and not result["complete"]
    assert len(calls) == 2 and all(c.url.host == "graph.microsoft.com" for c in calls)


def test_cached_metadata_survives_disconnect_and_deleted_anchor_cascades(client, monkeypatch):
    seed()
    fixture(monkeypatch)
    result = discover(client)
    token = result["groups"][0]["files"][0]["id"]
    client.delete("/api/accounts/1")
    cached = client.get("/api/messages/1/attachments").json()
    assert len(cached["groups"]) == 2 and not cached["connected"]
    assert not cached["groups"][0]["files"][0]["downloadable"]
    assert client.get("/api/messages/1/attachments/" + token + "/download").status_code == 409
    with store.db() as db:
        db.execute("DELETE FROM messages WHERE id=1")
        assert db.execute("SELECT count(*) FROM attachment_views").fetchone()[0] == 0


def test_failure_and_throttling_do_not_claim_no_attachments(client, monkeypatch):
    seed()

    def failure(r):
        return httpx.Response(429, headers={"Retry-After": "60"}, json={"error": {}})

    calls = fixture(monkeypatch, failure)
    data = discover(client)
    assert data["error"] and not data["complete"] and data["retry_at"] > 0
    client.post("/api/messages/1/attachments/refresh")
    assert len(calls) == 1


def test_vanished_thread_member_does_not_hide_other_attachments(client, monkeypatch):
    seed()

    def override(r):
        if r.url.path.endswith("/earlier/attachments"):
            return httpx.Response(404)

    fixture(monkeypatch, override)
    result = discover(client)
    assert result["complete"] and result["warning"]
    assert result["groups"][0]["files"] and result["groups"][1]["cached_only"]


def test_account_identity_changes_and_forged_tokens_are_rejected(client, monkeypatch):
    seed()
    calls = fixture(monkeypatch)
    result = discover(client)
    token = result["groups"][0]["files"][0]["id"]
    count = len(calls)
    assert client.get("/api/messages/1/attachments/" + "f" * 64 + "/download").status_code == 404
    with store.db() as db:
        db.execute("UPDATE accounts SET email='different@example.org' WHERE id=1")
    assert client.get("/api/messages/1/attachments").json()["groups"] == []
    assert client.get("/api/messages/1/attachments/" + token + "/download").status_code == 409
    assert len(calls) == count


def test_download_size_cap_and_safe_unicode_filename(client, monkeypatch):
    seed()
    fixture(monkeypatch)
    data = discover(client)
    monkeypatch.setattr(attachments, "MAX_FILE", 4)
    token = data["groups"][0]["files"][0]["id"]
    assert client.get("/api/messages/1/attachments/" + token + "/download").status_code == 413
    assert "/" not in attachments.filename("../../evil\r\nfile.pdf")
    name = attachments.filename("日本語" * 200 + ".pdf")
    assert len(name.encode()) <= 240 and name.endswith(".pdf")


def test_imap_reads_only_matching_uidvalidity_with_peek(client, monkeypatch):
    seed()
    mime = EmailMessage()
    mime.set_content("Mail body")
    mime.add_attachment(b"hello", maintype="application", subtype="pdf", filename="IMAP.pdf")
    payload = mime.as_bytes()
    calls = []
    with store.db() as db:
        db.execute(
            "UPDATE accounts SET provider='imap',secret=? WHERE id=1", (store.seal("password"),)
        )
        db.execute("UPDATE messages SET remote_key='1:INBOX:123:9' WHERE id=1")

    class IMAP:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def login(self, *args):
            calls.append(("login",))

        def select(self, folder, readonly):
            assert folder == "INBOX" and readonly
            return "OK", []

        def response(self, key):
            return key, [b"123"]

        def uid(self, command, uid, query):
            calls.append((command, uid, query))
            assert command == "fetch" and uid == "9"
            return (
                ("OK", [b"9 (RFC822.SIZE " + str(len(payload)).encode() + b")"])
                if query == "(RFC822.SIZE)"
                else ("OK", [(b"BODY[]", payload)])
            )

    monkeypatch.setattr(mail.imaplib, "IMAP4_SSL", IMAP)
    data = discover(client)
    assert data["scope"] == "message" and data["complete"]
    file = data["groups"][0]["files"][0]
    assert file["name"] == "IMAP.pdf"
    assert client.get("/api/messages/1/attachments/" + file["id"] + "/download").content == b"hello"
    assert any("BODY.PEEK[]" in c[-1] for c in calls)
    with store.db() as db:
        db.execute("UPDATE messages SET remote_key='1:INBOX:124:9' WHERE id=1")
    assert client.post("/api/messages/1/attachments/refresh").json()["error"]
