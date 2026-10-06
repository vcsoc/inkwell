"""Opt-in Graph writes: durable, per-resource ordered jobs with bounded parallel retries.

Only explicitly reauthorized Microsoft accounts are eligible. IMAP, local folders,
local-only messages and historical local calendar entries are never represented as
provider-synced. Jobs are persisted in the same transaction as the local change.
"""

import json
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime
from urllib.parse import quote
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import calendar_tools, microsoft, store

router = APIRouter(prefix="/api/provider-sync")
WORKERS = 4
RETRY_LIMIT = 12


class ProviderDelayed(Exception):
    """Graph's eventual consistency leaves a remote result unconfirmed."""


def account_ready(db, account_id, calendar=False):
    row = db.execute("SELECT * FROM accounts WHERE id=? AND provider='microsoft'", (account_id,)).fetchone()
    permission = microsoft.has_calendar_write_permissions if calendar else microsoft.has_mail_write_permissions
    return bool(row and permission(row))


def local_only(db):
    row = db.execute("SELECT value FROM settings WHERE key='provider_sync_local_only'").fetchone()
    return bool(row and row[0] == "true")


def enabled(db, account_id):
    return not local_only(db) and account_ready(db, account_id)


def require_mail_write(db, message):
    """Never silently file server-backed Outlook mail locally without an explicit opt-out."""
    if local_only(db) or not message["remote_key"]:
        return
    if not message["remote_key"].startswith(f"{message['account_id']}:graph:"):
        return
    if not account_ready(db, message["account_id"]):
        raise HTTPException(409, "Server mail changes require Microsoft write access. Open Settings → Mail accounts → Grant mail/calendar access and approve Microsoft’s prompt, or explicitly enable Local changes only.")


def calendar_account(db):
    row = db.execute("SELECT value FROM settings WHERE key='provider_sync_account'").fetchone()
    return int(row[0]) if row and row[0].isdigit() and not local_only(db) and account_ready(db, int(row[0]), calendar=True) else None


def connected(db, account_id):
    """Call only inside a successful OAuth transaction; never reset an explicit opt-out."""
    matches = db.execute("SELECT id FROM accounts WHERE provider='microsoft'").fetchall()
    if len(matches) == 1 and matches[0]["id"] == account_id:
        db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES ('provider_sync_account',?)", (str(account_id),))
    if not db.execute("SELECT 1 FROM settings WHERE key='provider_sync_local_only'").fetchone():
        db.execute("INSERT INTO settings(key,value) VALUES ('provider_sync_local_only','false')")


def ensure_move(db, message, destination):
    """Refuse unsupported destinations before mutating an eligible provider message."""
    require_mail_write(db, message)
    if not message["remote_key"] or not enabled(db, message["account_id"]):
        return None
    if not message["remote_key"].startswith(f"{message['account_id']}:graph:"):
        return None
    if destination in {"inbox", "archive", "trash"}:
        return {"destination": "deleteditems" if destination == "trash" else destination}
    if destination.startswith("remote:"):
        row = db.execute("SELECT remote_id FROM remote_folders WHERE id=? AND account_id=?",
                         (int(destination[7:]), message["account_id"])).fetchone()
        if row:
            return {"destination": row["remote_id"]}
    raise HTTPException(422, "This is a local-only folder. Turn on Local changes only to file this Microsoft message here.")


def enqueue_mail(db, message, kind, payload):
    if kind == "delete":
        require_mail_write(db, message)
    if not message["remote_key"] or not enabled(db, message["account_id"]):
        return 0
    if not message["remote_key"].startswith(f"{message['account_id']}:graph:"):
        return 0
    payload = {**payload, "remote_id": message["remote_key"].split(":graph:", 1)[1]}
    db.execute("""INSERT INTO provider_jobs(account_id,resource_type,resource_id,kind,payload)
        VALUES (?,'mail',?,?,?)""", (message["account_id"], message["id"], kind, json.dumps(payload)))
    return 1


def mail_result(result, queued):
    return {**result, "provider_queued": queued} if queued else result


class Mode(BaseModel):
    local_changes_only: bool


@router.get("")
def status():
    with store.db() as db:
        accounts = db.execute("SELECT * FROM accounts ORDER BY id").fetchall()
        account = calendar_account(db)
        counts = {row["state"]: row["n"] for row in db.execute(
            "SELECT state,count(*) n FROM provider_jobs WHERE state!='done' GROUP BY state")}
        failure = db.execute("SELECT error FROM provider_jobs WHERE state='failed' ORDER BY id DESC LIMIT 1").fetchone()
        return {
            "local_changes_only": local_only(db) or not any(account_ready(db, row["id"]) for row in accounts),
            "explicit_local_only": local_only(db),
            "authorization_required": sum(row["provider"] == "microsoft" and not microsoft.has_mail_write_permissions(row) for row in accounts),
            "completed": db.execute("SELECT count(*) FROM provider_jobs WHERE state='done'").fetchone()[0],
            "calendar_account_id": account,
            "accounts": [{"id": row["id"], "email": row["email"],
                          "provider": row["provider"],
                          "ready": microsoft.has_mail_write_permissions(row),
                          "calendar_ready": microsoft.has_calendar_write_permissions(row)} for row in accounts],
            "pending": counts.get("pending", 0) + counts.get("running", 0),
            "failed": counts.get("failed", 0),
            "cancelled": counts.get("cancelled", 0),
            "last_error": failure[0] if failure else "",
        }


@router.put("")
def set_mode(data: Mode):
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        if not data.local_changes_only:
            accounts = db.execute("SELECT id FROM accounts WHERE provider='microsoft'").fetchall()
            ready = [row for row in accounts if account_ready(db, row["id"])]
            if not ready:
                raise HTTPException(409, "Reauthorize your Microsoft account for Mail.ReadWrite and Calendars.ReadWrite first. IMAP writes need a separate provider implementation.")
            calendars = [row for row in accounts if account_ready(db, row['id'], calendar=True)]
            if len(calendars) == 1:
                db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES ('provider_sync_account',?)",
                           (str(calendars[0]["id"]),))
        db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES ('provider_sync_local_only',?)",
                   ("true" if data.local_changes_only else "false",))
    return status()


@router.post("/retry")
def retry_failed():
    with store.db() as db:
        db.execute("UPDATE provider_jobs SET state='pending',attempts=0,next_run=0,error='' WHERE state='failed'")
    return status()


def graph(account, method, path, *, payload=None, missing_ok=False):
    headers = {"Authorization": "Bearer " + microsoft.access_token(account),
               "Prefer": 'IdType="ImmutableId"'}
    with microsoft.client() as http:
        response = http.request(method, microsoft.GRAPH + "/me/" + path,
                                headers=headers, json=payload)
        if missing_ok and response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json() if response.content else None


def event_body(event, job):
    zone = "UTC" if event["all_day"] else event["timezone"]
    start = datetime.fromisoformat(event["start"]).astimezone(ZoneInfo(zone))
    end = datetime.fromisoformat(event["end"]).astimezone(ZoneInfo(zone))
    body = {
        "subject": event["title"], "body": {"contentType": "text", "content": event["notes"]},
        "start": {"dateTime": start.replace(tzinfo=None).isoformat(), "timeZone": zone},
        "end": {"dateTime": end.replace(tzinfo=None).isoformat(), "timeZone": zone},
        "isAllDay": bool(event["all_day"]), "location": {"displayName": event["location"]},
    }
    rec = calendar_tools.Recurrence.model_validate_json(event["recurrence"])
    if rec.frequency != "none":
        # Graph supports these four absolute recurrence forms. Bound its count to
        # the occurrences actually represented by the local recurrence engine.
        instances = sum(1 for _ in calendar_tools.schedule(event)[0])
        if not instances:
            raise ValueError("No calendar occurrences to synchronize")
        names = {"MO": "monday", "TU": "tuesday", "WE": "wednesday", "TH": "thursday",
                 "FR": "friday", "SA": "saturday", "SU": "sunday"}
        pattern = {"type": {"daily": "daily", "weekly": "weekly",
                            "monthly": "absoluteMonthly", "yearly": "absoluteYearly"}[rec.frequency],
                   "interval": rec.interval}
        if rec.frequency == "weekly":
            pattern["daysOfWeek"] = [names[day] for day in rec.weekdays] or [start.strftime("%A").lower()]
            pattern["firstDayOfWeek"] = "sunday"
        if rec.frequency in {"monthly", "yearly"}:
            pattern["dayOfMonth"] = start.day
        if rec.frequency == "yearly":
            pattern["month"] = start.month
        body["recurrence"] = {"pattern": pattern,
                              "range": {"type": "numbered", "startDate": start.date().isoformat(),
                                        "numberOfOccurrences": instances, "recurrenceTimeZone": zone}}
    if job["kind"] == "create":
        body["transactionId"] = f"inkwell-{job['account_id']}-{job['id']}"
    return body


def event_remote(db, job):
    row = db.execute("SELECT provider_event_id FROM events WHERE id=? AND provider_account_id=?",
                     (job["resource_id"], job["account_id"])).fetchone()
    if row and row[0]:
        return row[0]
    old = db.execute("""SELECT remote_id FROM provider_jobs WHERE resource_type='event'
        AND resource_id=? AND account_id=? AND kind='create' AND state='done'
        ORDER BY id DESC LIMIT 1""", (job["resource_id"], job["account_id"])).fetchone()
    return old[0] if old else None


def perform(job):
    with store.db() as db:
        account = db.execute("SELECT * FROM accounts WHERE id=? AND provider='microsoft'", (job["account_id"],)).fetchone()
        permission = microsoft.has_calendar_write_permissions if job['resource_type'] == 'event' else microsoft.has_mail_write_permissions
        if not account or not permission(account):
            raise ValueError("Account disconnected or missing Microsoft write permissions; reauthorize")
        remote = event_remote(db, job) if job["resource_type"] == "event" else None
        alive = db.execute("SELECT 1 FROM events WHERE id=?", (job["resource_id"],)).fetchone() if job["resource_type"] == "event" else None
    payload = json.loads(job["payload"])
    if job["resource_type"] == "event":
        if job["kind"] == "create":
            result = graph(account, "POST", "events", payload=event_body(payload, job))
            if not result or not result.get("id"):
                raise ValueError("Graph did not return the new calendar event ID")
            return result["id"]
        if job["kind"] == "update":
            if not alive:  # A later delete supersedes the intermediate change.
                return remote
            if not remote:
                raise ValueError("No provider calendar event ID; retry the earlier create first")
            graph(account, "PATCH", "events/" + quote(remote, safe=""), payload=event_body(payload, job))
            return remote
        if remote := payload.get("remote_id") or remote:
            path = "events/" + quote(remote, safe="")
            if graph(account, "GET", path + "?$select=id", missing_ok=True) is None:
                if job["attempts"] < 4:
                    raise ProviderDelayed("Confirming missing calendar event before marking deletion complete")
            else:
                graph(account, "DELETE", path)
        return remote
    remote = payload["remote_id"]
    path = "messages/" + quote(remote, safe="")
    if job["kind"] == "patch":
        graph(account, "PATCH", path, payload=payload["fields"])
    elif job["kind"] == "delete":
        # A 404 from the action could mean an unsupported endpoint, not that the
        # message was removed. Only a missing message itself confirms completion.
        if graph(account, "GET", path + "?$select=id", missing_ok=True) is not None:
            graph(account, "POST", path + "/permanentDelete")
        elif job["attempts"] < 4:
            raise ProviderDelayed("Confirming missing message before marking deletion complete")
    else:
        target = payload["destination"]
        folder = graph(account, "GET", "mailFolders/" + quote(target, safe="") + "?$select=id")
        destination = folder["id"]
        # A retry after a timeout must not move a message twice. Immutable IDs
        # survive folder moves; compare the current parent first.
        current = graph(account, "GET", path + "?$select=id,parentFolderId", missing_ok=True)
        if current is None:
            raise ProviderDelayed("Waiting for Outlook's immutable message ID after a move")
        if current.get("parentFolderId") != destination:
            result = graph(account, "POST", path + "/move", payload={"destinationId": destination})
            if not result or result.get("id") != remote:
                raise ValueError("Outlook returned an unexpected message ID; review the move")
    return remote


def claim():
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("""SELECT j.* FROM provider_jobs j WHERE j.state='pending'
            AND j.next_run<=? AND NOT EXISTS (
              SELECT 1 FROM provider_jobs older WHERE older.account_id=j.account_id
               AND older.resource_type=j.resource_type AND older.resource_id=j.resource_id
               AND older.id<j.id AND older.state NOT IN ('done','cancelled')) ORDER BY j.id LIMIT 1""",
            (time.time(),)).fetchone()
        if row:
            db.execute("UPDATE provider_jobs SET state='running' WHERE id=?", (row["id"],))
        return dict(row) if row else None


def run_job(job):
    try:
        remote_id = perform(job)
        with store.db() as db:
            db.execute("BEGIN IMMEDIATE")
            completed = db.execute("UPDATE provider_jobs SET state='done',remote_id=?,error='' WHERE id=? AND state='running'",
                                   (remote_id or "", job["id"]))
            if completed.rowcount and job["resource_type"] == "event" and job["kind"] == "create":
                db.execute("UPDATE events SET provider_event_id=? WHERE id=? AND provider_account_id=?",
                           (remote_id, job["resource_id"], job["account_id"]))
    except Exception as error:
        retryable = isinstance(error, (ProviderDelayed, httpx.TimeoutException, httpx.NetworkError)) or (
            isinstance(error, httpx.HTTPStatusError) and error.response.status_code in
            {408, 409, 423, 425, 429, 500, 502, 503, 504})
        attempts = job["attempts"] + 1
        delay = min(3600, 2 ** min(11, attempts) + random.uniform(0, 2))
        if isinstance(error, httpx.HTTPStatusError):
            retry_after = error.response.headers.get("Retry-After", "")
            if retry_after.isdigit():
                delay = max(delay, min(int(retry_after), 3600))
            reason = f"Microsoft Graph returned HTTP {error.response.status_code}"
        else:
            reason = str(error)[:300] if isinstance(error, (ValueError, ProviderDelayed)) else type(error).__name__
        with store.db() as db:
            db.execute("UPDATE provider_jobs SET state=?,attempts=?,next_run=?,error=? WHERE id=? AND state='running'",
                       ("pending" if retryable and attempts < RETRY_LIMIT else "failed",
                        attempts, time.time() + delay, reason, job["id"]))


class ProviderWorker:
    def __init__(self):
        self.stop_event = threading.Event()
        self.thread = None

    def start(self):
        with store.db() as db:
            db.execute("UPDATE provider_jobs SET state='pending' WHERE state='running'")
        self.stop_event.clear()
        self.thread = threading.Thread(target=self._loop, name="inkwell-provider-sync", daemon=True)
        self.thread.start()

    def _loop(self):
        with ThreadPoolExecutor(max_workers=WORKERS, thread_name_prefix="inkwell-graph") as pool:
            running = set()
            while not self.stop_event.is_set():
                running = {future for future in running if not future.done()}
                try:
                    while len(running) < WORKERS and (job := claim()):
                        running.add(pool.submit(run_job, job))
                except Exception:
                    pass  # A transient database lock must not kill the dispatcher.
                self.stop_event.wait(1)
            wait(running)

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=35)
