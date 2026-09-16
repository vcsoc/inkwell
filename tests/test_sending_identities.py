import httpx
from inkwell import store, microsoft, mail
from test_background_sync import seed


def test_default_and_selected_sender_are_explicit_without_changing_oauth_identity(
    client, monkeypatch
):
    id = seed()
    requests = []
    identities = []

    def token(a):
        identities.append(a["email"])
        return "test-token"

    def handle(r):
        requests.append(r)
        return httpx.Response(202)

    monkeypatch.setattr(microsoft, "access_token", token)
    monkeypatch.setattr(
        microsoft, "client", lambda: httpx.Client(transport=httpx.MockTransport(handle))
    )
    config = {"default_from": "chosen@example.org", "additional_addresses": ["chosen@example.org"]}
    assert client.put(f"/api/accounts/{id}/senders", json=config).status_code == 200
    for chosen in (None, "worker@example.org", "chosen@example.org"):
        payload = {
            "account_id": id,
            "recipient": "recipient@example.org",
            "subject": "Explicit sender",
            "body": "Test",
        }
        if chosen is not None:
            payload["from_address"] = chosen
        result = client.post("/api/send", json=payload)
        assert result.status_code == 200
        import json

        actual = json.loads(requests[-1].content)["message"]["from"]["emailAddress"]["address"]
        assert actual == (chosen or config["default_from"])
        assert client.get("/api/messages/" + str(result.json()["id"])).json()["sender"] == actual
    assert identities == ["worker@example.org"] * 3
    with store.db() as db:
        assert (
            db.execute("SELECT email FROM accounts WHERE id=?", (id,)).fetchone()[0]
            == "worker@example.org"
        )


def test_unknown_or_removed_sender_is_rejected_before_transport_and_draft_keeps_choice(
    client, monkeypatch
):
    id = seed()
    monkeypatch.setattr(
        microsoft,
        "send_mail",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("Must not send")),
    )
    client.put(
        f"/api/accounts/{id}/senders",
        json={"default_from": "worker@example.org", "additional_addresses": ["alias@example.org"]},
    )
    draft = client.post(
        "/api/drafts",
        json={
            "account_id": id,
            "from_address": "alias@example.org",
            "recipient": "recipient@example.org",
            "subject": "Keep me",
        },
    ).json()
    saved = client.get("/api/messages/" + str(draft["id"])).json()
    assert saved["sender"] == "alias@example.org"
    client.put(
        f"/api/accounts/{id}/senders",
        json={"default_from": "worker@example.org", "additional_addresses": []},
    )
    for chosen in ("alias@example.org", "stranger@example.org"):
        result = client.post(
            "/api/send",
            json={
                "account_id": id,
                "from_address": chosen,
                "recipient": "recipient@example.org",
                "draft_id": draft["id"],
                "draft_revision": draft["draft_revision"],
            },
        )
        assert result.status_code == 422
    assert client.get("/api/messages/" + str(draft["id"])).json() == saved


def test_graph_discovery_is_read_only_and_does_not_invent_personal_aliases(client, monkeypatch):
    id = seed()
    requests = []
    profile = {"mail": "worker@example.org", "proxyAddresses": None}

    def handle(r):
        requests.append(r)
        return httpx.Response(200, json=profile)

    monkeypatch.setattr(microsoft, "access_token", lambda a: "test-token")
    monkeypatch.setattr(
        microsoft, "client", lambda: httpx.Client(transport=httpx.MockTransport(handle))
    )
    url = f"/api/accounts/{id}/senders"
    result = client.post(url + "/refresh").json()
    assert [a["address"] for a in result["addresses"]] == ["worker@example.org"]
    profile["proxyAddresses"] = [
        "SMTP:worker@example.org",
        "smtp:alias@example.org",
        "X500:not-an-email",
        "smtp:bad\r\naddress",
    ]
    result = client.post(url + "/refresh").json()
    assert {a["address"] for a in result["addresses"]} == {
        "worker@example.org",
        "alias@example.org",
    }
    assert all(r.method == "GET" for r in requests)
    for bad in ("bad\r\nBcc:bad@example.org", "other@example.org,second@example.org"):
        assert (
            client.put(url, json={"default_from": bad, "additional_addresses": [bad]}).status_code
            == 422
        )


def test_microsoft_sender_rejection_keeps_draft_and_never_retries_another_identity(
    client, monkeypatch
):
    id = seed()
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(403, json={"error": {"code": "ErrorSendAsDenied"}})

    monkeypatch.setattr(microsoft, "access_token", lambda a: "test-token")
    monkeypatch.setattr(
        microsoft, "client", lambda: httpx.Client(transport=httpx.MockTransport(handle))
    )
    draft = client.post(
        "/api/drafts",
        json={
            "account_id": id,
            "from_address": "worker@example.org",
            "recipient": "person@example.org",
            "subject": "Preserve",
        },
    ).json()
    response = client.post(
        "/api/send",
        json={
            "account_id": id,
            "recipient": "person@example.org",
            "draft_id": draft["id"],
            "draft_revision": draft["draft_revision"],
        },
    )
    assert response.status_code == 403 and len(calls) == 1
    assert client.get("/api/messages/" + str(draft["id"])).json()["folder"] == "drafts"


def test_smtp_sender_changes_only_header_identity_not_login_credentials(client, monkeypatch):
    id = seed()
    with store.db() as db:
        db.execute(
            "UPDATE accounts SET provider='custom',username='login@example.org' WHERE id=?", (id,)
        )
    client.put(
        f"/api/accounts/{id}/senders",
        json={"default_from": "alias@example.org", "additional_addresses": ["alias@example.org"]},
    )
    captured = []
    monkeypatch.setattr(mail, "send_mail", lambda a, *args, **kwargs: captured.append(a))
    assert (
        client.post(
            "/api/send", json={"account_id": id, "recipient": "person@example.org"}
        ).status_code
        == 200
    )
    assert (
        captured[0]["email"] == "alias@example.org"
        and captured[0]["username"] == "login@example.org"
    )
