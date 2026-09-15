import pytest
from inkwell import html_mail, store


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
