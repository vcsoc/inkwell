import base64
import io
from email.message import EmailMessage

import httpx
import pytest
from PIL import Image

from inkwell import microsoft, outgoing, store


def file(inline=False, size=10):
    if inline:
        buffer = io.BytesIO()
        Image.new("RGB", (80, 40), "red").save(buffer, format="PNG")
        raw = buffer.getvalue()
    else:
        raw = b"x" * size
    return dict(
        name="photo.png" if inline else "report.txt",
        content_type="image/png" if inline else "text/plain",
        content=base64.b64encode(raw).decode(),
        content_id="test-image@inkwell" if inline else "test-report@inkwell",
        inline=inline,
    )


def payload():
    return dict(
        subject="Attachment draft",
        body="Before After",
        html_body='<p>Before <img src="cid:test-image@inkwell" width="40" height="20"> After</p>',
        attachments=[file(), file(True)],
    )


def test_draft_roundtrip_downloads_inline_preview_and_cascade(client):
    value = payload()
    saved = client.post("/api/drafts", json=value)
    assert saved.status_code == 200, saved.text
    id = saved.json()["id"]
    message = client.get(f"/api/messages/{id}").json()
    assert message["compose_attachments"] == value["attachments"]
    assert 'width="40"' in message["html_body"]
    metadata = client.get(f"/api/messages/{id}/attachments").json()
    assert metadata["complete"]
    files = metadata["groups"][0]["files"]
    assert len(files) == 2 and all(f["downloadable"] for f in files)
    assert (
        client.get(f"/api/messages/{id}/attachments/{files[0]['id']}/download").content == b"x" * 10
    )
    preview = client.get(f"/api/messages/{id}/html?inline=true")
    assert "data:image/png;base64," in preview.text
    assert (
        client.post(
            "/api/drafts", json={**value, **{"draft_id": id, "draft_revision": 0}}
        ).status_code
        == 409
    )
    assert client.delete(f"/api/messages/{id}").status_code == 200
    with store.db() as db:
        assert not db.execute("SELECT * FROM outgoing_files WHERE message_id=?", (id,)).fetchone()


@pytest.mark.parametrize(
    "changes",
    [
        dict(content="!bad"),
        dict(name="../secret"),
        dict(content_id="bad\r\n"),
        dict(content_type="text/plain\r\nInjected: yes"),
    ],
)
def test_invalid_attachments_never_save(client, changes):
    value = {**file(), **changes}
    assert client.post("/api/drafts", json={"attachments": [value]}).status_code == 422


def test_size_duplicates_and_unresolved_images_rejected(client):
    assert client.post("/api/drafts", json={"attachments": [file(), file()]}).status_code == 422
    assert (
        client.post(
            "/api/drafts", json={"html_body": '<img src="https://tracker.example/image">'}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/drafts",
            json={
                "attachments": [
                    file(size=11 * 1024 * 1024),
                    {**file(size=11 * 1024 * 1024), "content_id": "second"},
                ]
            },
        ).status_code
        == 422
    )
    value = payload()
    value["html_body"] += '<script>alert(1)</script><p onclick="bad()">Safe</p>'
    saved = client.post("/api/drafts", json=value).json()
    html = client.get("/api/messages/" + str(saved["id"])).json()["html_body"]
    assert "<script" not in html and "onclick" not in html


def test_mime_has_plain_alternative_cid_and_normal_attachment_in_any_order():
    for ordered in ([file(), file(True)], [file(True), file()]):
        message = EmailMessage()
        message.set_content("Plain fallback")
        outgoing.add_mime(
            message,
            '<img src="cid:test-image@inkwell" width="40">',
            [outgoing.Attachment(**f) for f in ordered],
        )
        parts = list(message.walk())
        assert any(
            p.get_content_type() == "text/plain" and "Plain fallback" in p.get_content()
            for p in parts
        )
        assert any(
            p.get_content_type() == "text/html" and 'width="40"' in p.get_content() for p in parts
        )
        inline = next(p for p in parts if p.get_content_disposition() == "inline")
        assert inline["Content-ID"] == "<test-image@inkwell>"
        assert inline.get_payload(decode=True) == base64.b64decode(file(True)["content"])
        assert (
            next(p for p in parts if p.get_content_disposition() == "attachment").get_payload(
                decode=True
            )
            == b"x" * 10
        )


def test_graph_small_attachments_use_html_and_content_ids(monkeypatch):
    sent = []

    def handle(request):
        import json

        sent.append(json.loads(request.content))
        return httpx.Response(202)

    monkeypatch.setattr(microsoft, "access_token", lambda a: "test")
    monkeypatch.setattr(
        microsoft, "client", lambda: httpx.Client(transport=httpx.MockTransport(handle))
    )
    microsoft.send_mail(
        {"email": "sender@example.com"},
        "recipient@example.com",
        "Subject",
        "Plain",
        html_body=payload()["html_body"],
        attachments=[outgoing.Attachment(**file(True))],
    )
    message = sent[0]["message"]
    assert message["body"]["contentType"] == "HTML"
    assert message["attachments"][0]["isInline"] is True
    assert message["attachments"][0]["contentId"] == "test-image@inkwell"


@pytest.mark.parametrize("total", [3_100_000, 7_000_000])
def test_graph_large_attachments_upload_without_bearer_on_preauthorized_url(monkeypatch, total):
    calls = []

    def handle(request):
        calls.append(request)
        if request.url.path.endswith("/createUploadSession"):
            return httpx.Response(200, json={"uploadUrl": "https://outlook.office.com/upload"})
        if request.method == "PUT":
            assert "authorization" not in request.headers
            end = int(request.headers["Content-Range"].split("-")[1].split("/")[0])
            return httpx.Response(201 if end + 1 == total else 202)
        if request.url.path.endswith("/send"):
            return httpx.Response(202)
        return httpx.Response(201, json={"id": "draft-id"})

    monkeypatch.setattr(microsoft, "access_token", lambda a: "test")
    monkeypatch.setattr(
        microsoft, "client", lambda: httpx.Client(transport=httpx.MockTransport(handle))
    )
    microsoft.send_mail(
        {"email": "sender@example.com"},
        "recipient@example.com",
        "Subject",
        "Plain",
        attachments=[outgoing.Attachment(**file(size=total))],
    )
    assert calls[-1].url.path.endswith("/send")
    uploads = [c for c in calls if c.method == "PUT"]
    assert b"".join(c.content for c in uploads) == b"x" * total
    assert (
        uploads[0].headers["Content-Range"] == f"bytes 0-{min(total, 320 * 1024 * 10) - 1}/{total}"
    )


def test_failed_graph_upload_cleans_only_unsent_remote_draft(monkeypatch):
    calls = []

    def handle(request):
        calls.append((request.method, request.url.path))
        if request.url.path.endswith("/attachments"):
            return httpx.Response(500)
        return httpx.Response(201, json={"id": "draft-id"})

    monkeypatch.setattr(microsoft, "access_token", lambda a: "test")
    monkeypatch.setattr(
        microsoft, "client", lambda: httpx.Client(transport=httpx.MockTransport(handle))
    )
    with pytest.raises(httpx.HTTPStatusError):
        microsoft.send_mail(
            {"email": "sender@example.com"},
            "recipient@example.com",
            "Subject",
            "Plain",
            attachments=[outgoing.Attachment(**file(size=2_500_000))],
        )
    assert calls[-1] == ("DELETE", "/v1.0/me/messages/draft-id")
    assert not any(path.endswith("/send") for _, path in calls)


@pytest.mark.parametrize("fail", [False, True])
def test_send_preserves_rich_content_and_only_removes_draft_after_provider_acceptance(
    client, monkeypatch, fail
):
    from inkwell import mail

    account = client.post(
        "/api/accounts",
        json={
            "name": "Sender",
            "email": "sender@example.test",
            "username": "sender@example.test",
            "password": "test",
            "imap_host": "imap.example.test",
            "smtp_host": "smtp.example.test",
            "smtp_port": 465,
            "smtp_security": "tls",
        },
    ).json()["id"]
    value = {**payload(), "account_id": account, "recipient": "recipient@example.test"}
    draft = client.post("/api/drafts", json=value).json()
    calls = []

    def submit(*args, **kwargs):
        calls.append((args, kwargs))
        if fail:
            raise OSError("submission uncertain")

    monkeypatch.setattr(mail, "send_mail", submit)
    result = client.post(
        "/api/send",
        json={**value, "draft_id": draft["id"], "draft_revision": draft["draft_revision"]},
    )
    assert result.status_code == (502 if fail else 200), result.text
    assert calls[0][1]["html_body"].startswith("<p>Before")
    assert len(calls[0][1]["attachments"]) == 2
    if fail:
        assert (
            client.get(f"/api/messages/{draft['id']}").json()["compose_attachments"]
            == value["attachments"]
        )
        assert client.get("/api/messages?folder=sent").json() == []
    else:
        assert client.get(f"/api/messages/{draft['id']}").status_code == 404
        metadata = client.get(f"/api/messages/{result.json()['id']}/attachments").json()
        assert len(metadata["groups"][0]["files"]) == 2
