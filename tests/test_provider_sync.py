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
