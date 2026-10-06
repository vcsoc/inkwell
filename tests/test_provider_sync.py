"""Provider write jobs are atomic, scoped, ordered and safe to retry."""

import json
import time
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi import HTTPException

from inkwell import message_moves, microsoft, provider_sync, store
from inkwell.app import Event, MessagePatch, add_event, delete_account, delete_event, patch_message, update_event


@pytest.fixture
def ready(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path)
    store.init()
    with store.db() as db:
        token = {"access_token": "mock", "refresh_token": "mock", "expires_at": time.time() + 3600,
                 "scope": microsoft.WRITE_SCOPES}
        account = db.execute("""INSERT INTO accounts
            (name,email,imap_host,imap_port,smtp_host,smtp_port,username,secret,smtp_security,provider,client_id)
            VALUES ('Outlook','user@example.com','',993,'',587,'user@example.com',?,'starttls','microsoft',?)""",
            (store.seal(json.dumps(token)), "11111111-2222-3333-4444-555555555555")).lastrowid
        provider_sync.connected(db, account)
    return account


def sample_event(name="A meeting"):
    start = datetime(2027, 3, 1, 10, tzinfo=timezone.utc)
    return Event(title=name, start=start, end=start + timedelta(hours=1), timezone="UTC")


def jobs():
    with store.db() as db:
        return [dict(row) for row in db.execute("SELECT * FROM provider_jobs ORDER BY id")]


def test_calendar_create_edit_delete_persist_order_and_local_only(ready):
    event = add_event(sample_event())["id"]
    update_event(event, sample_event("New name"))
    delete_event(event)
    history = jobs()
    assert [j["kind"] for j in history] == ["create", "update", "delete"]
    assert len({j["resource_id"] for j in history}) == 1
    assert json.loads(history[0]["payload"])["title"] == "A meeting"
    assert json.loads(history[1]["payload"])["title"] == "New name"
    assert provider_sync.claim()["id"] == history[0]["id"]
    assert provider_sync.claim() is None  # Same resource cannot overtake a running write.
    provider_sync.set_mode(provider_sync.Mode(local_changes_only=True))
    add_event(sample_event("Private"))
    assert len(jobs()) == 3


def test_old_calendar_event_adopted_only_after_authorized_edit(ready):
    provider_sync.set_mode(provider_sync.Mode(local_changes_only=True))
    event = add_event(sample_event())["id"]
    assert not jobs()
    provider_sync.set_mode(provider_sync.Mode(local_changes_only=False))
    update_event(event, sample_event("Synchronized now"))
    assert [j["kind"] for j in jobs()] == ["create"]
    with store.db() as db:
        assert db.execute("SELECT provider_account_id FROM events WHERE id=?", (event,)).fetchone()[0] == ready


def test_outlook_mail_changes_enqueue_immutable_ids_and_local_only_folders_rejected(ready):
    with store.db() as db:
        message = db.execute("""INSERT INTO messages
            (account_id,remote_key,folder,sender,recipient,subject,body,date)
            VALUES (?,?,'inbox','friend@example.com','user@example.com','Hi','body',?)""",
            (ready, f"{ready}:graph:immutable-id", datetime.now(timezone.utc).isoformat())).lastrowid
        db.execute("INSERT INTO local_folders(name) VALUES ('Private')")
        local_id = db.execute("SELECT id FROM local_folders").fetchone()[0]
    patch_message(message, MessagePatch(unread=False, starred=True))
    with pytest.raises(HTTPException, match="local-only folder"):
        message_moves.move(message_moves.Move(ids=[message], folder=f"local-{local_id}"))
    assert [j["kind"] for j in jobs()] == ["patch"]
    message_moves.move(message_moves.Move(ids=[message], folder="trash"))
    message_moves.trash_selection(message_moves.Trash(ids=[message], permanent=True))
    history = jobs()
    assert [j["kind"] for j in history] == ["patch", "move", "delete"]
    assert json.loads(history[0]["payload"])["fields"] == {
        "isRead": True, "flag": {"flagStatus": "flagged"}}
    assert all(json.loads(j["payload"])["remote_id"] == "immutable-id" for j in history)


def test_durable_graph_retry_and_calendar_transaction_id(ready, monkeypatch):
    event = add_event(sample_event())["id"]
    captured = []

    def graph(account, method, path, *, payload=None, missing_ok=False):
        captured.append((method, path, payload))
        if len(captured) == 1:
            raise httpx.ReadTimeout("temporary offline")
        return {"id": "immutable-event-id"}

    monkeypatch.setattr(provider_sync, "graph", graph)
    provider_sync.run_job(provider_sync.claim())
    with store.db() as db:
        row = db.execute("SELECT * FROM provider_jobs").fetchone()
        assert row["state"] == "pending" and row["attempts"] == 1 and row["next_run"] > time.time()
        db.execute("UPDATE provider_jobs SET next_run=0")
    provider_sync.run_job(provider_sync.claim())
    assert captured[0][2]["transactionId"] == captured[1][2]["transactionId"]
    assert jobs()[0]["state"] == "done"
    with store.db() as db:
        assert db.execute("SELECT provider_event_id FROM events WHERE id=?", (event,)).fetchone()[0] == "immutable-event-id"


def test_move_timeout_reconciles_immutable_message_before_retry(ready, monkeypatch):
    with store.db() as db:
        message = db.execute("""INSERT INTO messages
            (account_id,remote_key,folder,sender,recipient,subject,body,date)
            VALUES (?,?,'inbox','friend@example.com','user@example.com','Hi','body',?)""",
            (ready, f"{ready}:graph:stable-id", datetime.now(timezone.utc).isoformat())).lastrowid
    message_moves.move(message_moves.Move(ids=[message], folder='trash'))
    sent = []
    parent = ['inbox-id']
    def graph(account, method, path, *, payload=None, missing_ok=False):
        sent.append((method, path))
        if path.startswith('mailFolders/'):
            return {'id':'deleted-id'}
        if method == 'GET':
            return {'id':'stable-id', 'parentFolderId':parent[0]}
        parent[0] = 'deleted-id'  # Simulate a server move with a lost response.
        raise httpx.ReadTimeout('response was lost')
    monkeypatch.setattr(provider_sync, 'graph', graph)
    provider_sync.run_job(provider_sync.claim())
    assert jobs()[0]['state'] == 'pending'
    with store.db() as db:
        db.execute('UPDATE provider_jobs SET next_run=0')
    provider_sync.run_job(provider_sync.claim())
    assert jobs()[0]['state'] == 'done'
    assert len([item for item in sent if item[0] == 'POST']) == 1


def test_disconnect_cancels_unsent_jobs_without_removing_local_data(ready):
    event = add_event(sample_event())['id']
    assert jobs()[0]['state'] == 'pending'
    delete_account(ready)
    assert jobs()[0]['state'] == 'cancelled'
    assert provider_sync.claim() is None
    provider_sync.retry_failed()
    assert jobs()[0]['state'] == 'cancelled'
    with store.db() as db:
        row = db.execute('SELECT provider_account_id FROM events WHERE id=?', (event,)).fetchone()
        assert row and row[0] is None
    assert provider_sync.status()['local_changes_only'] is True


def test_disconnect_cannot_resurrect_a_running_job(ready, monkeypatch):
    event = add_event(sample_event())['id']
    running = provider_sync.claim()
    def disconnected(job):
        delete_account(ready)
        return 'remote-event-that-finished-late'
    monkeypatch.setattr(provider_sync, 'perform', disconnected)
    provider_sync.run_job(running)
    assert jobs()[0]['state'] == 'cancelled'
    with store.db() as db:
        row = db.execute('SELECT provider_event_id FROM events WHERE id=?', (event,)).fetchone()
        assert row and row[0] is None


def test_no_write_without_consent_or_wrong_account(ready):
    with store.db() as db:
        account = dict(db.execute("SELECT * FROM accounts WHERE id=?", (ready,)).fetchone())
        secret = json.loads(store.unseal(account["secret"]))
        secret["scope"] = microsoft.READ_SCOPES
        db.execute("UPDATE accounts SET secret=? WHERE id=?", (store.seal(json.dumps(secret)), ready))
    with pytest.raises(HTTPException) as error:
        provider_sync.set_mode(provider_sync.Mode(local_changes_only=False))
    assert error.value.status_code == 409
    event = add_event(sample_event())["id"]
    assert event and provider_sync.status()["local_changes_only"] is True
    # A grant revoked between requests cannot send changes silently.
    provider_sync.run_job(provider_sync.claim())
    assert jobs()[0]["state"] == "failed"
    assert "reauthorize" in jobs()[0]["error"]


def outlook_message(account, remote="mail-id", folder="inbox"):
    with store.db() as db:
        return db.execute("""INSERT INTO messages
            (account_id,remote_key,folder,sender,recipient,subject,body,date,sender_key,domain_key)
            VALUES (?,?,?,'friend@example.com','user@example.com','Hello','body',?,'friend@example.com','example.com')""",
            (account, f"{account}:graph:{remote}", folder, datetime.now(timezone.utc).isoformat())).lastrowid


def test_readonly_moves_and_deletion_are_blocked_until_consent_or_explicit_local_only(ready):
    message = outlook_message(ready)
    trashed = outlook_message(ready, "already-trashed", "trash")
    with store.db() as db:
        row = db.execute("SELECT * FROM accounts WHERE id=?", (ready,)).fetchone()
        token = json.loads(store.unseal(row["secret"]))
        token["scope"] = microsoft.READ_SCOPES
        db.execute("UPDATE accounts SET secret=? WHERE id=?", (store.seal(json.dumps(token)), ready))
        db.execute("DELETE FROM settings WHERE key='provider_sync_local_only'")
    with pytest.raises(HTTPException, match="write access"):
        message_moves.move(message_moves.Move(ids=[message], folder="trash"))
    with pytest.raises(HTTPException, match="write access"):
        message_moves.trash_selection(message_moves.Trash(ids=[trashed], permanent=True))
    with store.db() as db:
        assert db.execute("SELECT folder FROM messages WHERE id=?", (message,)).fetchone()[0] == "inbox"
        assert db.execute("SELECT 1 FROM messages WHERE id=?", (trashed,)).fetchone()
    assert not jobs()
    assert provider_sync.status()["authorization_required"] == 1
    provider_sync.set_mode(provider_sync.Mode(local_changes_only=True))
    assert message_moves.move(message_moves.Move(ids=[message], folder="trash")) == {"moved": 1}
    assert message_moves.trash_selection(message_moves.Trash(ids=[trashed], permanent=True)) == {"deleted": 1}
    assert not jobs()


def test_remote_folder_trash_restore_and_permanent_delete_run_on_same_server(ready, monkeypatch):
    message = outlook_message(ready, "stable-mail")
    with store.db() as db:
        remote = db.execute("INSERT INTO remote_folders(account_id,remote_id,name,path) VALUES (?,'project-folder','Project','Project')", (ready,)).lastrowid
    result = message_moves.move(message_moves.Move(ids=[message], folder=f"remote:{remote}"))
    assert result["provider_queued"] == 1
    assert message_moves.trash_selection(message_moves.Trash(ids=[message]))["provider_queued"] == 1
    assert message_moves.restore(message_moves.Selection(ids=[message]))["provider_queued"] == 1
    assert message_moves.trash_selection(message_moves.Trash(ids=[message]))["provider_queued"] == 1
    assert message_moves.trash_selection(message_moves.Trash(ids=[message], permanent=True))["provider_queued"] == 1
    calls = []
    current = {"parent": "inbox"}

    def graph(account, method, path, *, payload=None, missing_ok=False):
        assert account["id"] == ready
        calls.append((method, path, payload))
        if path.startswith("mailFolders/"):
            return {"id": path.split("/", 1)[1].split("?", 1)[0]}
        if method == "GET":
            return {"id": "stable-mail", "parentFolderId": current["parent"]}
        if path.endswith("/move"):
            current["parent"] = payload["destinationId"]
            return {"id": "stable-mail"}
        assert path.endswith("/permanentDelete")
        return None

    monkeypatch.setattr(provider_sync, "graph", graph)
    while job := provider_sync.claim():
        provider_sync.run_job(job)
    assert all(job["state"] == "done" for job in jobs())
    assert [payload["destinationId"] for method, path, payload in calls if path.endswith("/move")] == [
        "project-folder", "deleteditems", "project-folder", "deleteditems"]
    assert calls[-1][1].endswith("/permanentDelete")
    assert provider_sync.status()["completed"] == 5


def test_rules_and_not_junk_enqueue_server_changes_in_same_transaction(ready):
    from inkwell import not_junk, rules
    message = outlook_message(ready)
    rules.create(rules.Rule(name='File on server',
        conditions=[{'field': 'sender', 'operator': 'contains', 'value': 'friend@'}],
        actions=[{'type': 'move', 'value': 'archive'}, {'type': 'mark_read'}, {'type': 'star'}]))
    with store.db() as db:
        assert rules.apply(db, message, force=True)
    assert [job["kind"] for job in jobs()] == ["move", "patch"]
    assert json.loads(jobs()[0]["payload"])["destination"] == "archive"
    assert json.loads(jobs()[1]["payload"])["fields"] == {"isRead": True, "flag": {"flagStatus": "flagged"}}
    with store.db() as db:
        db.execute("DELETE FROM mail_rules")
    not_junk.mark(message)
    assert json.loads(jobs()[-1]["payload"])["destination"] == "inbox"


def test_mail_sync_does_not_require_a_single_calendar_account(ready):
    with store.db() as db:
        original = db.execute("SELECT * FROM accounts WHERE id=?", (ready,)).fetchone()
        other = db.execute("""INSERT INTO accounts(name,email,imap_host,imap_port,smtp_host,smtp_port,username,secret,smtp_security,provider,client_id)
            VALUES ('Second','second@example.com','',993,'',587,'second@example.com',?,'starttls','microsoft',?)""",
            (original["secret"], original["client_id"])).lastrowid
        db.execute("DELETE FROM settings WHERE key IN ('provider_sync_local_only','provider_sync_account')")
        provider_sync.connected(db, other)
    assert provider_sync.status()["local_changes_only"] is False
    assert provider_sync.status()["calendar_account_id"] is None
    one = outlook_message(ready, "first-mail")
    two = outlook_message(other, "second-mail")
    assert message_moves.move(message_moves.Move(ids=[one, two], folder="trash"))["provider_queued"] == 2
    provider_sync.set_mode(provider_sync.Mode(local_changes_only=True))
    provider_sync.set_mode(provider_sync.Mode(local_changes_only=False))
    assert provider_sync.status()["local_changes_only"] is False


def test_readonly_not_junk_preserves_import_and_explicit_action_is_atomic(ready):
    from inkwell import not_junk
    message = outlook_message(ready)
    with store.db() as db:
        db.execute('UPDATE accounts SET secret=? WHERE id=?', (store.seal(json.dumps({'scope': microsoft.READ_SCOPES})), ready))
        db.execute("UPDATE messages SET folder='remote' WHERE id=?", (message,))
        item = db.execute('SELECT * FROM messages WHERE id=?', (message,)).fetchone()
        assert not_junk.file_copy(db, item) is False
    with pytest.raises(HTTPException) as error:
        not_junk.mark(message)
    assert error.value.status_code == 409
    assert not jobs()
    with store.db() as db:
        assert db.execute('SELECT folder,local_folder_override FROM messages WHERE id=?', (message,)).fetchone()[:] == ('remote', 0)
        assert db.execute('SELECT count(*) FROM not_junk_senders').fetchone()[0] == 0


def test_mail_write_scope_works_without_calendar_scope(ready):
    with store.db() as db:
        original = db.execute('SELECT * FROM accounts WHERE id=?', (ready,)).fetchone()
        token = json.loads(store.unseal(original['secret']))
        token['scope'] = microsoft.READ_SCOPES + ' https://graph.microsoft.com/Mail.ReadWrite'
        db.execute('UPDATE accounts SET secret=? WHERE id=?', (store.seal(json.dumps(token)), ready))
    status = provider_sync.status()
    assert status['local_changes_only'] is False and status['calendar_account_id'] is None
    assert status['accounts'][0]['ready'] is True and status['accounts'][0]['calendar_ready'] is False
    message = outlook_message(ready)
    assert message_moves.move(message_moves.Move(ids=[message], folder='trash'))['provider_queued'] == 1


def test_wrong_account_remote_folder_does_not_partially_move_a_batch(ready):
    one = outlook_message(ready)
    with store.db() as db:
        original = db.execute('SELECT * FROM accounts WHERE id=?', (ready,)).fetchone()
        other = db.execute("""INSERT INTO accounts(name,email,imap_host,imap_port,smtp_host,smtp_port,username,secret,smtp_security,provider)
            VALUES ('Other','other@example.com','',993,'',587,'other@example.com',?,'starttls','microsoft')""", (original['secret'],)).lastrowid
        remote = db.execute("INSERT INTO remote_folders(account_id,remote_id,name,path) VALUES (?,'private','Private','Private')", (ready,)).lastrowid
    two = outlook_message(other)
    with pytest.raises(HTTPException):
        message_moves.move(message_moves.Move(ids=[one, two], folder=f'remote:{remote}'))
    assert not jobs()
    with store.db() as db:
        assert [row[0] for row in db.execute('SELECT folder FROM messages ORDER BY id')] == ['inbox', 'inbox']
