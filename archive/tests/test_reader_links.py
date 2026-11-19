import html
import io
from email.message import EmailMessage
from urllib.parse import quote

import pytest
from PIL import Image
from inkwell import calendar_import, html_mail, store


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "data:text/html,bad",
        "file:///etc/passwd",
        "mailto:a@example.org",
        "https://localhost/a",
        "https://127.1/a",
        "http://0x7f000001/a",
        "https://[::1]/a",
        "https://a.internal/a",
        "https://user@example.org/a",
        "https://example.org:444/a",
        "//example.org/a",
        "/api/accounts",
        "https://example.org/\\evil",
        "https://8.8.8.8/a",
    ],
)
def test_unsafe_links_are_never_enabled(url):
    assert html_mail.link_url(url) is None


@pytest.mark.parametrize(
    "background", ["#ffffff", "#202731", "#777777", "#005ac6", "#75bcff", "#a050a0"]
)
def test_link_palette_meets_contrast(background):
    def luminance(color):
        values = [int(color[i : i + 2], 16) / 255 for i in (1, 3, 5)]
        return sum(
            (v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) * w
            for v, w in zip(values, (0.2126, 0.7152, 0.0722))
        )

    first, second = sorted(
        [luminance(background), luminance(html_mail.reader_link_color(background))]
    )
    assert (second + 0.05) / (first + 0.05) >= 4.5


def test_sender_cannot_remove_enabled_link_underlines():
    clean, _, _ = html_mail.sanitize(
        '<a href="https://example.org" style="text-decoration:none!important;text-decoration-line:none;color:red">Link</a>',
        reader_colors=True,
        links=True,
    )
    assert "text-decoration" not in clean and "color:red" not in clean


def test_outlook_safe_links_show_original_url_without_bypassing_protection():
    target = "https://www.aroac.com/"
    protected = "https://na01.safelinks.protection.outlook.com/?url=" + quote(target, safe="") + "&data=private-token&reserved=0"
    escaped = html.escape(protected, quote=True)
    source = f'<p>Download from <a href="{escaped}">{escaped}</a> safely.</p>'
    blocked, _, _ = html_mail.sanitize(source, links=False)
    assert f'>{target}</a>' in blocked
    assert 'safelinks.protection.outlook.com' not in blocked and 'href=' not in blocked
    shown, _, _ = html_mail.sanitize(source, links=True)
    assert f'>{target}</a>' in shown
    assert 'href="https://na01.safelinks.protection.outlook.com/' in shown
    assert 'data=private-token' in shown
    assert 'href="https://www.aroac.com/' not in shown
    readable = html_mail.text_links('Click ' + protected)
    assert readable[0]['display'] == target
    assert readable[0]['url'] == protected


@pytest.mark.parametrize('href,text', [
    ('https://na01.safelinks.protection.outlook.com.evil.org/?url=https%3A%2F%2Fgood.org', None),
    ('https://na01.safelinks.protection.outlook.com/?url=javascript%3Aalert%281%29', None),
    ('https://na01.safelinks.protection.outlook.com/?url=https%3A%2F%2Flocalhost%2F', None),
    ('https://na01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fgood.org&url=https%3A%2F%2Fevil.org', None),
    ('https://na01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fgood.org', 'Click this'),
])
def test_unsafe_or_nonmatching_safe_link_labels_are_not_rewritten(href, text):
    label = text or href
    result, _, _ = html_mail.sanitize(f'<a href="{html.escape(href)}">{html.escape(label)}</a>', links=True)
    assert f'>{html.escape(label)}</a>' in result


def test_sent_link_default_uses_folder_provenance_not_spoofable_sender(client):
    with store.db() as db:
        own = db.execute("INSERT INTO messages(sender,recipient,subject,body,date,folder) VALUES ('Me <me@example.org>','you@example.org','Sent','https://example.org','2026-09-29','sent')").lastrowid
        spoof = db.execute("INSERT INTO messages(sender,recipient,subject,body,date,folder) VALUES ('Me <me@example.org>','me@example.org','Spoof','https://evil.org','2026-09-29','inbox')").lastrowid
        account = db.execute("INSERT INTO accounts(name,email,imap_host,imap_port,smtp_host,smtp_port,username,secret,smtp_security,provider,client_id) VALUES ('Me','me@example.org','',993,'',587,'me@example.org','not-used','starttls','microsoft','')").lastrowid
        folder = db.execute("INSERT INTO remote_folders(account_id,remote_id,name,path,well_known) VALUES (?,'provider-sent-id','Sent Items','Sent Items','sentitems')", (account,)).lastrowid
        imported = db.execute("INSERT INTO messages(account_id,remote_folder_id,remote_key,folder,sender,recipient,subject,body,date) VALUES (?,?,?,'remote','Me <me@example.org>','you@example.org','Provider sent','https://example.org','2026-09-29')", (account, folder, f'{account}:graph:immutable-id')).lastrowid
    assert client.get(f'/api/messages/{own}').json()['sent_by_me'] == 1
    assert client.get(f'/api/messages/{spoof}').json()['sent_by_me'] == 0
    assert client.get(f'/api/messages/{imported}').json()['sent_by_me'] == 1


def test_enabling_links_preserves_scriptless_sandbox_and_does_not_enable_images(client):
    body = '<a href="https://example.org/path?q=1&amp;x=2#part" target="_top" ping="https://evil.org" onclick="bad()">Visit</a><a href="javascript:bad()">Bad</a><script>bad()</script><img src="https://images.example.org/pixel">'
    with store.db() as db:
        id = db.execute(
            "INSERT INTO messages(sender,recipient,subject,body,html_body,date,folder) VALUES ('a@example.org','b@example.org','Links','See http://example.org/path.',?,'2026-09-14','inbox')",
            (body,),
        ).lastrowid
    disabled = client.get(f"/api/messages/{id}/html")
    assert (
        "href=" not in disabled.text
        and "allow-popups" not in disabled.headers["content-security-policy"]
    )
    enabled = client.get(f"/api/messages/{id}/html?links=true")
    assert 'href="https://example.org/path?q=1&amp;x=2#part"' in enabled.text
    assert (
        'target="_blank"' in enabled.text
        and "noopener" in enabled.text
        and "noreferrer" in enabled.text
    )
    for forbidden in (
        "onclick=",
        "ping=",
        "javascript:",
        "<script",
        'src="https:',
        "allow-scripts",
        "allow-same-origin",
        "allow-top-navigation",
    ):
        assert forbidden not in enabled.text + enabled.headers["content-security-policy"]
    assert "script-src 'none'" in enabled.headers["content-security-policy"]
    assert "allow-popups-to-escape-sandbox" in enabled.headers["content-security-policy"]
    links = client.get(f"/api/messages/{id}/preview-info").json()["text_links"]
    assert links == [
        {"start": 4, "end": 27, "text": "http://example.org/path", "url": "http://example.org/path"}
    ]


def test_remote_content_permission_is_message_scoped_persistent_and_validated(client):
    with store.db() as db:
        id = db.execute(
            "INSERT INTO messages(sender,recipient,subject,body,html_body,date) VALUES ('a@example.org','b@example.org','Remote image','Text',?,'2099-01-01')",
            ('<img src="https://images.example.org/icon.png"><img src="cid:icon">',),
        ).lastrowid
        other = db.execute(
            "INSERT INTO messages(sender,recipient,subject,body,html_body,date) VALUES ('a@example.org','b@example.org','Other','Text','<p>No images</p>','2099-01-01')"
        ).lastrowid
    endpoint = f"/api/messages/{id}/remote-content"
    assert client.get(f"/api/messages/{id}/preview-info").json()["saved_origins"] == []
    assert client.put(endpoint, json={"origins": ["https://evil.example.org"]}).status_code == 422
    assert client.put(endpoint, json={"origins": ["*"]}).json() == {"origins": ["*"]}
    assert client.get(f"/api/messages/{id}/preview-info").json()["saved_origins"] == ["*"]
    assert client.get(f"/api/messages/{other}/preview-info").json()["saved_origins"] == []
    assert client.put(endpoint, json={"origins": []}).status_code == 200
    assert client.get(f"/api/messages/{id}/preview-info").json()["saved_origins"] == []


def test_explicit_cid_images_are_safe_reencoded_and_scripts_remain_blocked(client, monkeypatch):
    with store.db() as db:
        id = db.execute(
            "INSERT INTO messages(sender,recipient,subject,body,html_body,date) VALUES ('a@example.org','b@example.org','Embedded','Text',?,'2099-01-01')",
            ('<img src="cid:icon" alt="Safe"><img src="data:image/svg+xml;base64,PHN2Zz4=" alt="Blocked"><script>alert(1)</script>',),
        ).lastrowid
    image = io.BytesIO()
    Image.new("RGB", (2, 2), "blue").save(image, format="PNG")
    mail = EmailMessage()
    mail.set_content("Body")
    mail.add_attachment(image.getvalue(), maintype="image", subtype="png", filename="inline.png", cid="<icon>")
    monkeypatch.setattr(calendar_import, "message_mime", lambda message_id: mail)
    html_mail.embedded_images.cache_clear()
    assert 'src="data:' not in client.get(f"/api/messages/{id}/html").text
    result = client.get(f"/api/messages/{id}/html?inline=true")
    assert result.status_code == 200
    assert 'src="data:image/png;base64,' in result.text
    assert "image/svg+xml" not in result.text and "<script" not in result.text
    assert "img-src data:" in result.headers["content-security-policy"]
    assert "script-src 'none'" in result.headers["content-security-policy"]
