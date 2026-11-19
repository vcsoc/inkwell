import json

import pytest

from inkwell import html_mail, mail, store

ATTACK = """<h1>Safe HTML</h1><p style="color:red;background-image:url(https://evil.example/track)">Hello</p>
<script>top.compromised=true</script><iframe src="https://evil.example/frame"></iframe>
<form action="https://evil.example/post"><input autofocus></form>
<svg onload="alert(1)"><image href="https://evil.example/svg"/></svg>
<math><mtext><table><mglyph><style><!--</style><img title="--><img src=1 onerror=alert(1)>">
</table></mtext></math><meta http-equiv="refresh" content="0;url=https://evil.example">
<link rel="stylesheet" href="https://evil.example/style"><base href="https://evil.example">
<a href="javascript:alert(1)" onclick="alert(1)">Link</a>
<img src="https://images.example.org/pixel.png" onerror="alert(1)" srcset="https://evil.example/x 2x" alt="Photo">
<img src="http://insecure.example/image"><img src="https://127.0.0.1/private">
<img src="/api/accounts"><img src="data:image/svg+xml,bad">
"""


def test_sanitizer_blocks_all_fetches_and_active_content():
    clean, origins, count = html_mail.sanitize(ATTACK)
    assert "<h1>Safe HTML</h1>" in clean
    for forbidden in (
        "<script",
        "<iframe",
        "<form",
        "<svg",
        "<math",
        "<meta",
        "<link",
        "<base",
        "src=",
        "srcset=",
        "onerror=",
        "onclick=",
        "href=",
        "url(",
    ):
        assert forbidden not in clean
    assert origins == ["https://images.example.org"]
    assert count >= 1
    clean, _, _ = html_mail.sanitize(ATTACK, ["https://images.example.org"])
    assert 'src="https://images.example.org/pixel.png"' in clean
    assert "evil.example" not in clean


@pytest.mark.parametrize(
    "url",
    [
        "https://localhost/x",
        "https://localhost./x",
        "https://0177.0.0.1/x",
        "https://127.0.0.0x1/x",
        "https://127.0.0.1/x",
        "https://[::1]/x",
        "https://10.0.0.1/x",
        "https://user:pass@example.org/x",
        "https://example.org:123/x",
        "https://server.local/x",
        "//example.org/x",
        "https://example.org/\\x",
        "https://example.org/\nx",
    ],
)
def test_disallowed_image_addresses(url):
    assert html_mail.image_url(url) is None


def seed(client):
    client.post("/api/demo")
    id = client.get("/api/messages").json()[0]["id"]
    with store.db() as db:
        db.execute("UPDATE messages SET html_body=? WHERE id=?", (ATTACK, id))
    return id


def test_preview_api_is_isolated_and_permissions_are_explicit(client):
    id = seed(client)
    info = client.get(f"/api/messages/{id}/preview-info").json()
    assert info["has_html"]
    assert info["origins"] == ["https://images.example.org"]
    path = f"/api/messages/{id}/html"
    blocked = client.get(path)
    assert blocked.status_code == 200
    assert "img-src 'none'" in blocked.headers["Content-Security-Policy"]
    assert "script-src 'none'" in blocked.headers["Content-Security-Policy"]
    assert "sandbox" in blocked.headers["Content-Security-Policy"]
    assert blocked.headers["X-Frame-Options"] == "SAMEORIGIN"
    assert blocked.headers["Referrer-Policy"] == "no-referrer"
    assert 'src="https://' not in blocked.text
    allowed = client.get(path, params={"allow": "https://images.example.org"})
    assert allowed.status_code == 200
    assert 'src="https://images.example.org/pixel.png"' in allowed.text
    assert client.get(path, params={"allow": "https://other.example"}).status_code == 400
    assert 'src="https://' not in client.get(path).text
    assert client.get(path, headers={"sec-fetch-site": "cross-site"}).status_code == 403
    client.cookies.clear()
    assert client.get(path).status_code == 401


def test_tags_are_validated_local_and_survive_message_moves(client):
    id = seed(client)
    assert (
        client.patch(
            f"/api/messages/{id}", json={"tags": [" Work ", "work", "Follow up"]}
        ).status_code
        == 200
    )
    assert json.loads(client.get(f"/api/messages/{id}").json()["tags"]) == ["Work", "Follow up"]
    assert [t["name"] for t in client.get("/api/tags").json()] == ["Follow up", "Work"]
    assert all(
        t["count"] == 1 and t["color"].startswith("#") for t in client.get("/api/tags").json()
    )
    assert client.get("/api/messages", params={"q": "Follow up"}).json()[0]["id"] == id
    client.patch(f"/api/messages/{id}", json={"folder": "archive"})
    assert json.loads(client.get("/api/messages?folder=archive").json()[0]["tags"]) == [
        "Work",
        "Follow up",
    ]
    for tags in [["x" * 33], ["a,b"], ["\n"], ["tag" + str(i) for i in range(13)]]:
        assert client.patch(f"/api/messages/{id}", json={"tags": tags}).status_code == 422
    client.patch(f"/api/messages/{id}", json={"tags": []})
    assert all(t["count"] == 0 for t in client.get("/api/tags").json())


def test_workspace_patch_preserves_theme_and_validates_sizes(client):
    original = client.get("/api/preferences").json()
    value = client.patch(
        "/api/preferences/workspace",
        json={
            "preview_mode": "text",
            "sidebar_width": 310,
            "message_list_width": 450,
            "ui_zoom": 120,
        },
    ).json()
    assert value["theme"] == original["theme"]
    assert value["sidebar_width"] == 310
    assert client.get("/api/preferences").json() == value
    for patch in [
        {"sidebar_width": 100},
        {"message_list_width": 901},
        {"ui_zoom": 200},
        {"preview_mode": "unsafe"},
    ]:
        assert client.patch("/api/preferences/workspace", json=patch).status_code == 422


def test_mime_html_and_plain_alternatives_are_kept_separately():
    from email.message import EmailMessage

    message = EmailMessage()
    message.set_content("Plain alternative")
    message.add_alternative("<h1>HTML alternative</h1>", subtype="html")
    assert mail.body_text(message).strip() == "Plain alternative"
    assert "<h1>HTML alternative</h1>" in mail.body_html(message)
