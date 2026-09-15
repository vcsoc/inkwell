import threading
import httpx
import pytest
from inkwell import microsoft, store, remote_folders
from inkwell.background_sync import BackgroundSync
from test_background_sync import seed, finish


def account_folder():
    id = seed()
    with store.db() as db:
        return dict(db.execute("SELECT * FROM accounts WHERE id=?", (id,)).fetchone()), dict(
            db.execute("SELECT * FROM remote_folders WHERE well_known='inbox'").fetchone()
        )


def message(id, **changes):
    return {
        "id": str(id),
        "from": {"emailAddress": {"address": "sender@example.org"}},
        "toRecipients": [],
        "ccRecipients": [],
        "bccRecipients": [],
        "isRead": False,
        "flag": {},
        "subject": "Cached",
        "body": {"content": "Body", "contentType": "text"},
        "receivedDateTime": "2026-09-15T12:00:00Z",
        **changes,
    }


def transport(monkeypatch, handler):
    monkeypatch.setattr(microsoft, "access_token", lambda a: "test-token")
    monkeypatch.setattr(
        microsoft, "client", lambda: httpx.Client(transport=httpx.MockTransport(handler))
    )


def test_nullable_and_malformed_outlook_headers_do_not_stop_or_truncate_a_page(client, monkeypatch):
    account, folder = account_folder()
    requests = []
    values = [message(i) for i in range(101)]
    values[0] = message(
        0,
        **{
            "from": None,
            "toRecipients": None,
            "ccRecipients": None,
            "bccRecipients": None,
            "body": None,
            "flag": None,
        },
    )
    values[1] = message(1, **{"from": {"emailAddress": {"address": "foo@@example.org"}}})

    def handle(request):
        requests.append(request)
        return httpx.Response(
            200, json={"value": values, "@odata.deltaLink": microsoft.GRAPH + "/me/checkpoint"}
        )

    transport(monkeypatch, handle)
    checkpoints = []
    assert (
        microsoft.sync_account(
            account,
            folder,
            delta=True,
            max_pages=1,
            on_cursor=lambda a, b: checkpoints.append((a, b)),
        )
        == 101
    )
    assert checkpoints == [(None, microsoft.GRAPH + "/me/checkpoint")]
    assert all(r.method == "GET" and "ImmutableId" in r.headers["Prefer"] for r in requests)
    assert client.get("/api/messages?folder=inbox&summary=true").json()["total"] == 101


def test_incremental_headers_update_but_local_choices_and_removed_copies_survive(
    client, monkeypatch
):
    account, folder = account_folder()
    values = [message(1)]
    transport(
        monkeypatch,
        lambda r: httpx.Response(
            200, json={"value": values, "@odata.deltaLink": microsoft.GRAPH + "/me/checkpoint"}
        ),
    )
    microsoft.sync_account(account, folder, delta=True, max_pages=1)
    id = client.get("/api/messages?folder=inbox").json()[0]["id"]
    client.patch(
        f"/api/messages/{id}",
        json={"unread": False, "starred": False, "flagged": True, "folder": "archive"},
    )
    values[:] = [
        message(1, subject="Updated server draft", isRead=False, flag={"flagStatus": "flagged"})
    ]
    microsoft.sync_account(
        account, folder, delta=True, max_pages=1, start_url=microsoft.GRAPH + "/me/checkpoint"
    )
    updated = client.get(f"/api/messages/{id}").json()
    assert updated["subject"] == "Updated server draft" and updated["flagged"] == 1
    assert updated["folder"] == "archive" and updated["unread"] == updated["starred"] == 0
    values[:] = [{"id": "1", "@removed": {"reason": "deleted"}}]
    microsoft.sync_account(account, folder, delta=True, max_pages=1)
    assert client.get(f"/api/messages/{id}").json() == updated


def test_untrusted_checkpoints_never_receive_credentials(client, monkeypatch):
    account, folder = account_folder()
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(
            200, json={"value": [], "@odata.deltaLink": "https://evil.example/me/stolen"}
        )

    transport(monkeypatch, handle)
    with pytest.raises(ValueError):
        microsoft.sync_account(account, folder, delta=True, max_pages=1)
    assert len(requests) == 1
    with pytest.raises(ValueError):
        microsoft.sync_account(account, folder, start_url="https://evil.example/me/stolen")
    assert len(requests) == 1


def test_page_budget_resumes_after_restart_and_f9_keeps_unfinished_history(client, monkeypatch):
    account, folder = account_folder()
    with store.db() as db:
        db.execute("DELETE FROM remote_folders WHERE id!=?", (folder["id"],))
    calls = []
    heads = []

    def sync(a, f, **kw):
        if not kw.get("delta"):
            heads.append(f["id"])
            kw["on_page"](0)
            return 0
        page = int(kw["start_url"].rsplit("=", 1)[-1]) if kw["start_url"] else 1
        calls.append(page)
        kw["on_page"](0)
        kw["on_cursor"](
            microsoft.GRAPH + "/me/next?page=" + str(page + 1) if page < 130 else None,
            microsoft.GRAPH + "/me/checkpoint" if page == 130 else None,
        )
        return 0

    monkeypatch.setattr(microsoft, "sync_account", sync)
    monkeypatch.setattr(remote_folders, "discover", lambda a: 1)
    first = BackgroundSync(threading.Lock())
    first.start()
    status = finish(first)
    assert calls == list(range(1, 129)) and status["pending"] == 1 and not status["errors"]
    restarted = BackgroundSync(threading.Lock())
    restarted.start(full=True)
    status = finish(restarted)
    assert calls == list(range(1, 131)) and heads == [folder["id"]]
    assert status["done"] == 1 and status["pending"] == 0 and not status["errors"]
    assert restarted.cursor(folder)["delta_url"] == microsoft.GRAPH + "/me/checkpoint"


def test_automatic_checks_respect_retry_after_without_losing_cursors(client, monkeypatch):
    account, folder = account_folder()
    calls = []

    def sync(a, f, **kw):
        calls.append(f["id"])
        request = httpx.Request("GET", microsoft.GRAPH + "/me/messages")
        response = httpx.Response(429, headers={"Retry-After": "60"}, request=request)
        raise httpx.HTTPStatusError("private response", request=request, response=response)

    monkeypatch.setattr(microsoft, "sync_account", sync)
    monkeypatch.setattr(remote_folders, "discover", lambda a: 4)
    job = BackgroundSync(threading.Lock())
    job.start()
    status = finish(job)
    assert len(calls) == 1 and status["pending"] == 4 and "private response" not in str(status)
    assert job.start()["id"] == status["id"] and len(calls) == 1
    assert job.cursor(folder)["next_url"] is None


def test_cyclic_page_chain_is_stopped_and_only_checkpoints_are_reset(client, monkeypatch):
    account, folder = account_folder()
    calls = []
    with store.db() as db:
        db.execute("DELETE FROM remote_folders WHERE id!=?", (folder["id"],))
        db.execute(
            "INSERT INTO messages(sender,recipient,subject,body,date) VALUES ('sender@example.org','me@example.org','Keep','Cached','2026-09-15')"
        )
    a = microsoft.GRAPH + "/me/page-a"
    b = microsoft.GRAPH + "/me/page-b"

    def sync(account, folder, **kw):
        calls.append(kw["start_url"])
        kw["on_page"](0)
        kw["on_cursor"](b if kw["start_url"] == a else a, None)

    monkeypatch.setattr(microsoft, "sync_account", sync)
    monkeypatch.setattr(remote_folders, "discover", lambda a: 1)
    job = BackgroundSync(threading.Lock())
    job.start()
    status = finish(job)
    assert calls == [None, a, b] and len(status["errors"]) == 1
    with store.db() as db:
        assert db.execute("SELECT count(*) FROM mail_sync_pages").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM messages").fetchone()[0] == 1
