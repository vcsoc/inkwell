import threading
from inkwell import store, microsoft, remote_folders
from inkwell.background_sync import BackgroundSync


def seed():
    with store.db() as db:
        account = db.execute(
            "INSERT INTO accounts(name,email,imap_host,imap_port,smtp_host,smtp_port,username,secret,smtp_security,provider) VALUES ('Test','worker@example.org','',993,'',587,'worker@example.org','unused','starttls','microsoft')"
        ).lastrowid
        for name, role, parent in [
            ("Inbox", "inbox", ""),
            ("Parent", "", ""),
            ("Nested", "", "Parent"),
            ("Archive", "archive", ""),
        ]:
            db.execute(
                "INSERT INTO remote_folders(account_id,remote_id,parent_remote_id,name,path,well_known) VALUES (?,?,?,?,?,?)",
                (account, name, parent, name, name, role),
            )
        return account


def setup(monkeypatch, handler):
    seed()
    monkeypatch.setattr(remote_folders, "discover", lambda a: 4)
    monkeypatch.setattr(microsoft, "sync_account", handler)
    return BackgroundSync(threading.Lock())


def finish(job):
    job.thread.join(2)
    assert not job.thread.is_alive()
    return job.status()


def test_worker_downloads_every_folder_and_child_then_uses_incremental_checks(client, monkeypatch):
    calls = []

    def sync(a, f, **kw):
        calls.append((f["remote_id"], kw["max_pages"]))
        kw["on_page"](1)
        return 1

    job = setup(monkeypatch, sync)
    job.start()
    status = finish(job)
    assert {f for f, _ in calls} == {"Inbox", "Parent", "Nested", "Archive"}
    assert status["total"] == status["done"] == status["added"] == 4
    assert not status["errors"] and not status["active"]
    assert all(p == 5000 for _, p in calls)
    calls.clear()
    job.start()
    finish(job)
    assert all(p == 2 for _, p in calls)
    calls.clear()
    job.start(full=True)
    finish(job)
    assert all(p == 5000 for _, p in calls)


def test_worker_coalesces_requests_and_holds_shared_transport_lock(client, monkeypatch):
    entered = threading.Event()
    release = threading.Event()

    def sync(a, f, **kw):
        entered.set()
        assert release.wait(1)
        return 0

    job = setup(monkeypatch, sync)
    try:
        first = job.start()
        assert entered.wait(1)
        assert job.start()["id"] == first["id"]
        assert not job.sync_lock.acquire(blocking=False)
    finally:
        release.set()
        finish(job)
    assert job.sync_lock.acquire(blocking=False)
    job.sync_lock.release()


def test_failure_does_not_skip_other_folders_and_failed_folder_retries_backfill(
    client, monkeypatch
):
    seen = []

    def sync(a, f, **kw):
        seen.append(f["remote_id"])
        if f["remote_id"] == "Parent":
            raise ValueError("private token must not escape")
        kw["on_page"](1)
        return 1

    job = setup(monkeypatch, sync)
    job.start()
    status = finish(job)
    assert len(seen) == 4 and status["done"] == 4 and status["added"] == 3
    assert len(status["errors"]) == 1 and "private token" not in str(status)


def test_worker_stops_without_starting_remaining_folders(client, monkeypatch):
    calls = []
    job = None

    def sync(a, f, **kw):
        calls.append(f["id"])
        job.cancel.set()
        kw["on_page"](0)

    job = setup(monkeypatch, sync)
    job.start()
    status = finish(job)
    assert len(calls) == 1 and not status["active"]


def test_archive_aggregate_and_cached_counts_share_membership_but_trash_stays_local(client):
    account = seed()
    with store.db() as db:
        folder = db.execute("SELECT id FROM remote_folders WHERE well_known='archive'").fetchone()[
            0
        ]
        db.execute(
            "INSERT INTO messages(sender,recipient,subject,body,date,folder,account_id,remote_folder_id,unread) VALUES ('sender@example.org','me@example.org','Server archive','','2026-01-01','remote',?,?,1)",
            (account, folder),
        )
        db.execute(
            "INSERT INTO messages(sender,recipient,subject,body,date,folder,unread) VALUES ('sender@example.org','me@example.org','Local archive','','2026-01-01','archive',1)"
        )
    result = client.get("/api/messages?folder=archive").json()
    assert len(result) == 2
    counts = {r["folder"]: r for r in client.get("/api/counts").json()}
    assert counts["archive"]["total"] == counts["archive"]["unread"] == 2
    remote = next(f for f in client.get("/api/remote-folders").json() if f["id"] == folder)
    assert remote["cached_total"] == remote["cached_unread"] == 1
    assert client.get("/api/messages?folder=trash").json() == []
    with store.db() as db:
        child = db.execute(
            "INSERT INTO remote_folders(account_id,remote_id,parent_remote_id,name,path) VALUES (?,'archive-child','Archive','Child','Archive / Child')",
            (account,),
        ).lastrowid
        db.execute(
            "INSERT INTO messages(sender,recipient,subject,body,date,folder,account_id,remote_folder_id) VALUES ('sender@example.org','me@example.org','Child archive','','2026-01-01','remote',?,?)",
            (account, child),
        )
        for role in ("sentitems", "drafts", "deleteditems"):
            remote = db.execute(
                "INSERT INTO remote_folders(account_id,remote_id,name,path,well_known) VALUES (?,?,?,?,?)",
                (account, role, role, role, role),
            ).lastrowid
            db.execute(
                "INSERT INTO messages(sender,recipient,subject,body,date,folder,account_id,remote_folder_id) VALUES ('me@example.org','other@example.org','Server copy','','2026-01-01','remote',?,?)",
                (account, remote),
            )
    assert len(client.get("/api/messages?folder=archive").json()) == 2
    assert len(client.get("/api/messages?folder=archive&scope=subfolders").json()) == 3
    assert len(client.get("/api/messages?folder=sent").json()) == 1
    assert client.get("/api/messages?folder=drafts").json() == []
    assert client.get("/api/messages?folder=trash").json() == []
    client.post(
        "/api/rules",
        json={"name": "Not outgoing", "match": "subject", "value": "Server", "folder": "archive"},
    )
    result = client.post("/api/rules/run", json={"scope": "folder", "folder": "sent"}).json()
    assert result["scanned"] == 1 and result["matched"] == 0


def test_full_graph_backfill_follows_more_than_two_pages_with_get_only(client, monkeypatch):
    import httpx

    account_id = seed()
    with store.db() as db:
        account = dict(db.execute("SELECT * FROM accounts WHERE id=?", (account_id,)).fetchone())
        folder = dict(
            db.execute("SELECT * FROM remote_folders WHERE well_known='inbox'").fetchone()
        )
    requests = []

    def handle(request):
        requests.append(request)
        page = int(request.url.params.get("page", "1"))
        data = {
            "value": [
                {
                    "id": str(page),
                    "subject": "Page " + str(page),
                    "from": {"emailAddress": {"address": "sender@example.org"}},
                    "body": {"content": "Cached body", "contentType": "text"},
                }
            ]
        }
        if page < 3:
            data["@odata.nextLink"] = (
                microsoft.GRAPH + "/me/mailFolders/Inbox/messages?page=" + str(page + 1)
            )
        return httpx.Response(200, json=data)

    monkeypatch.setattr(microsoft, "access_token", lambda a: "test-token")
    monkeypatch.setattr(
        microsoft, "client", lambda: httpx.Client(transport=httpx.MockTransport(handle))
    )
    assert microsoft.sync_account(account, folder) == 2
    pages = []
    assert microsoft.sync_account(account, folder, max_pages=5000, on_page=pages.append) == 1
    assert pages == [0, 0, 1]
    assert len(client.get("/api/messages?folder=inbox").json()) == 3
    assert all(r.method == "GET" for r in requests)
