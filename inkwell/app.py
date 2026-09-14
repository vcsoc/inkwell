"""Inkwell's loopback-only application API."""

import os
import json
import re
import secrets
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator, model_validator
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import (
    not_junk,
    mail_search,
    addresses,
    tag_store,
    mail_filters,
    message_moves,
    ai,
    collections,
    html_mail,
    mail,
    microsoft,
    preferences,
    remote_folders,
    store,
    rules,
    calendar_tools,
)

STATIC = Path(__file__).parent / "static"
ACCESS_KEY = os.environ.get("INKWELL_ACCESS_KEY", "")
if ACCESS_KEY and len(ACCESS_KEY) < 32:
    raise RuntimeError("INKWELL_ACCESS_KEY must contain at least 32 characters")
EXTRA_HOSTS = [h.strip() for h in os.environ.get("INKWELL_HOSTS", "").split(",") if h.strip()]
if EXTRA_HOSTS and not ACCESS_KEY:
    raise RuntimeError("Remote access requires INKWELL_ACCESS_KEY")
TOKEN = secrets.token_urlsafe(32)
SYNC_LOCK = threading.Lock()
LOGIN_LOCK = threading.Lock()
LOGIN_ATTEMPTS = []


@asynccontextmanager
async def lifespan(app):
    store.init()
    yield


app = FastAPI(title="inkwell", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(preferences.router)
app.include_router(microsoft.router)
app.include_router(collections.router)
app.include_router(html_mail.router)
app.include_router(rules.router)
app.include_router(message_moves.router)
app.include_router(tag_store.router)
app.include_router(addresses.router)
app.include_router(not_junk.router)
app.add_middleware(
    TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "[::1]", *EXTRA_HOSTS]
)


@app.middleware("http")
async def local_security(request: Request, call_next):
    if request.url.path.startswith("/api/"):
        if request.url.path != "/api/unlock" and not secrets.compare_digest(
            request.cookies.get("inkwell_session", ""), TOKEN
        ):
            return JSONResponse({"detail": "Open inkwell in your browser first."}, 401)
        if request.headers.get("sec-fetch-site") == "cross-site":
            return JSONResponse({"detail": "Cross-site requests are blocked."}, 403)
        if request.method not in ("GET", "HEAD"):
            origin = request.headers.get("origin")
            if (
                origin != str(request.base_url).rstrip("/")
                or request.headers.get("x-inkwell") != "1"
            ):
                return JSONResponse({"detail": "Invalid request origin."}, 403)
    response = await call_next(request)
    preview_policy = (
        response.headers.get("Content-Security-Policy")
        if re.fullmatch(r"/api/messages/\d+/html", request.url.path)
        else None
    )
    response.headers.update(
        {
            "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "Cache-Control": "no-store",
            "X-Frame-Options": "DENY",
        }
    )
    if preview_policy:
        response.headers["Content-Security-Policy"] = preview_policy
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
    return response


@app.get("/")
def index():
    response = FileResponse(STATIC / "index.html")
    if not ACCESS_KEY:
        response.set_cookie("inkwell_session", TOKEN, httponly=True, samesite="strict")
    return response


class Unlock(BaseModel):
    key: str = Field(max_length=4096)


@app.post("/api/unlock")
def unlock(data: Unlock, request: Request):
    with LOGIN_LOCK:
        now = time.monotonic()
        LOGIN_ATTEMPTS[:] = [t for t in LOGIN_ATTEMPTS if now - t < 60]
        if len(LOGIN_ATTEMPTS) >= 10:
            raise HTTPException(429, "Too many attempts. Try again in a minute.")
        LOGIN_ATTEMPTS.append(now)
    if not ACCESS_KEY or not secrets.compare_digest(data.key.encode(), ACCESS_KEY.encode()):
        raise HTTPException(401, "Incorrect access key")
    response = JSONResponse({"ok": True})
    response.set_cookie(
        "inkwell_session",
        TOKEN,
        httponly=True,
        samesite="strict",
        secure=request.url.scheme == "https",
    )
    return response


@app.get("/sw.js")
def service_worker():
    return FileResponse(
        STATIC / "sw.js",
        media_type="application/javascript",
        headers={"Service-Worker-Allowed": "/"},
    )


app.mount("/static", StaticFiles(directory=STATIC), name="static")


def rows(query, args=()):
    with store.db() as conn:
        return [dict(r) for r in conn.execute(query, args).fetchall()]


def account_by_id(account_id):
    result = rows("SELECT * FROM accounts WHERE id=?", (account_id,))
    if not result:
        raise HTTPException(404, "Account not found")
    return result[0]


def require_change(cursor):
    if not cursor.rowcount:
        raise HTTPException(404, "Item not found")


class Account(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: str = Field(max_length=254)
    imap_host: str = Field(min_length=1, max_length=253)
    imap_port: int = Field(default=993, ge=1, le=65535)
    smtp_host: str = Field(min_length=1, max_length=253)
    smtp_port: int = Field(default=465, ge=1, le=65535)
    username: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=4096)
    smtp_security: Literal["tls", "starttls"] = "tls"

    @field_validator("email")
    @classmethod
    def email_valid(cls, value):
        return validate_email(value)


def validate_email(value):
    import re

    if not re.fullmatch(r"[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+", value):
        raise ValueError("Enter one valid email address")
    return value


@app.get("/api/accounts")
def accounts():
    return rows(
        "SELECT id,name,email,imap_host,imap_port,smtp_host,smtp_port,username,smtp_security,provider,client_id FROM accounts"
    )


@app.post("/api/accounts")
def add_account(data: Account):
    with store.db() as conn:
        cursor = conn.execute(
            """INSERT INTO accounts
            (name,email,imap_host,imap_port,smtp_host,smtp_port,username,secret,smtp_security)
            VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                data.name,
                data.email,
                data.imap_host,
                data.imap_port,
                data.smtp_host,
                data.smtp_port,
                data.username,
                store.seal(data.password),
                data.smtp_security,
            ),
        )
        addresses.remember(conn, data.email, display_name=data.name)
        return {"id": cursor.lastrowid}


@app.delete("/api/accounts/{account_id}")
def delete_account(account_id: int):
    with store.db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        require_change(conn.execute("DELETE FROM accounts WHERE id=?", (account_id,)))
        conn.execute(
            "UPDATE messages SET folder=CASE WHEN folder='remote' THEN 'inbox' ELSE folder END,local_destination_id=NULL WHERE local_destination_id IN (SELECT id FROM remote_folders WHERE account_id=?)",
            (account_id,),
        )
        conn.execute(
            "UPDATE messages SET account_id=NULL,remote_key=NULL,remote_folder_id=NULL,folder=CASE WHEN folder='remote' AND local_destination_id IS NULL THEN 'inbox' ELSE folder END WHERE account_id=?",
            (account_id,),
        )
        conn.execute("DELETE FROM remote_folders WHERE account_id=?", (account_id,))
    return {"ok": True}


@app.post("/api/sync")
def sync():
    if not SYNC_LOCK.acquire(blocking=False):
        raise HTTPException(409, "Sync is already running")
    try:
        results = []
        for account in rows("SELECT * FROM accounts"):
            try:
                transport = microsoft if account["provider"] == "microsoft" else mail
                result = {"email": account["email"], "added": transport.sync_account(account)}
                if account["provider"] == "microsoft":
                    try:
                        result["folders"] = remote_folders.discover(account)
                        if rows("SELECT sender_key FROM not_junk_senders LIMIT 1"):
                            for junk in rows(
                                "SELECT * FROM remote_folders WHERE account_id=? AND well_known='junkemail'",
                                (account["id"],),
                            ):
                                try:
                                    result["added"] += microsoft.sync_account(
                                        account, junk, trusted_only=True
                                    )
                                except Exception:
                                    result["folder_error"] = (
                                        "Junk check failed; cached mail was preserved. Retry Sync."
                                    )
                    except Exception:
                        result["folder_error"] = (
                            "Folder discovery failed; cached folders were preserved. Retry Sync."
                        )
                results.append(result)
            except Exception:
                results.append(
                    {
                        "email": account["email"],
                        "error": "Sync failed. Check the network and account authorization. Microsoft accounts may need reconnecting or administrator consent; IMAP accounts may need a new app password.",
                    }
                )
        return results
    finally:
        SYNC_LOCK.release()


@app.get("/api/remote-folders")
def server_folders():
    return rows("SELECT * FROM remote_folders ORDER BY account_id,path COLLATE NOCASE")


@app.post("/api/remote-folders/{folder_id}/sync")
def sync_server_folder(folder_id: int):
    found = rows("SELECT * FROM remote_folders WHERE id=?", (folder_id,))
    if not found:
        raise HTTPException(404, "Server folder not found. Refresh folders with Sync.")
    folder = found[0]
    account = account_by_id(folder["account_id"])
    if account["provider"] != "microsoft":
        raise HTTPException(400, "Server folder transport is not supported")
    if not SYNC_LOCK.acquire(blocking=False):
        raise HTTPException(409, "Sync is already running. Try this folder again shortly.")
    try:
        return {"added": microsoft.sync_account(account, folder)}
    except Exception as error:
        raise HTTPException(
            502, "Folder sync failed. Cached mail is still available; retry Sync."
        ) from error
    finally:
        SYNC_LOCK.release()


@app.get("/api/messages")
def messages(
    folder: str = "inbox",
    q: str = "",
    offset: int = 0,
    remote_folder_id: int | None = None,
    scope: Literal["folder", "subfolders", "all"] = "folder",
    filters: mail_filters.Filters = Depends(),
    summary: bool = False,
):
    if not re.fullmatch(
        r"(inbox|starred|sent|drafts|archive|trash|remote|local-[1-9][0-9]*)", folder
    ):
        raise HTTPException(422, "Invalid folder")
    clause = "starred=1 AND folder!='trash'" if folder == "starred" else "folder=?"
    params = [] if folder == "starred" else [folder]
    if remote_folder_id is not None and scope != "all":
        if not rows("SELECT id FROM remote_folders WHERE id=?", (remote_folder_id,)):
            raise HTTPException(404, "Server folder not found")
        clause = "CASE WHEN local_folder_override=1 THEN local_destination_id ELSE remote_folder_id END=? AND folder IN ('inbox','remote')"
        params = [remote_folder_id]
    if scope == "subfolders" and (remote_folder_id is not None or folder == "inbox"):
        root = "id=?" if remote_folder_id is not None else "well_known='inbox'"
        clause = f"""CASE WHEN local_folder_override=1 THEN local_destination_id ELSE remote_folder_id END IN (
            WITH RECURSIVE subtree(id,remote_id,account_id) AS (
                SELECT id,remote_id,account_id FROM remote_folders WHERE {root}
                UNION SELECT child.id,child.remote_id,child.account_id FROM remote_folders child
                JOIN subtree parent ON child.parent_remote_id=parent.remote_id AND child.account_id=parent.account_id
            ) SELECT id FROM subtree) AND folder IN ('inbox','remote')"""
        params = [remote_folder_id] if remote_folder_id is not None else []
        if remote_folder_id is None:
            clause = "(" + clause + " OR folder='inbox')"
    if scope == "subfolders":
        roots = [f"remote:{remote_folder_id}" if remote_folder_id is not None else folder]
        if remote_folder_id is not None or folder == "inbox":
            root = "id=?" if remote_folder_id is not None else "well_known='inbox'"
            descendants = rows(
                f"""WITH RECURSIVE tree(id,remote_id,account_id) AS (
                SELECT id,remote_id,account_id FROM remote_folders WHERE {root}
                UNION SELECT c.id,c.remote_id,c.account_id FROM remote_folders c JOIN tree p
                ON c.parent_remote_id=p.remote_id AND c.account_id=p.account_id
            ) SELECT id FROM tree""",
                (remote_folder_id,) if remote_folder_id is not None else (),
            )
            roots.extend("remote:" + str(r["id"]) for r in descendants)
        clause = (
            "("
            + clause
            + """ OR folder IN (
            WITH RECURSIVE children(id) AS (
                SELECT id FROM local_folders WHERE parent IN (SELECT value FROM json_each(?))
                UNION SELECT f.id FROM local_folders f JOIN children c ON f.parent='local-'||c.id
            ) SELECT 'local-'||id FROM children))"""
        )
        params.append(json.dumps(roots))
    if scope == "all":
        clause, params = "1=1", []
    search, search_params = mail_search.predicate(q)
    if search:
        clause += " AND " + search
        params += search_params
    extra, values = filters.sql()
    clause = "(" + clause + ")" + extra
    params += values
    with store.db() as db:
        db.execute("BEGIN")
        result = [
            dict(row)
            for row in db.execute(
                f"SELECT id,account_id,remote_folder_id,local_destination_id,local_folder_override,tags,folder,sender,recipient,subject,substr(body,1,180) AS preview,date,unread,starred,demo FROM messages WHERE {clause} ORDER BY {filters.order()} LIMIT 100 OFFSET ?",
                (*params, max(0, offset)),
            )
        ]
        if not summary:
            return result
        total = db.execute(f"SELECT count(*) FROM messages WHERE {clause}", params).fetchone()[0]
        return {"messages": result, "total": total}


@app.get("/api/counts")
def counts():
    return rows(
        "SELECT folder,count(*) AS total,sum(unread) AS unread FROM messages GROUP BY folder"
    )


@app.get("/api/messages/{message_id}")
def message(message_id: int):
    result = rows("SELECT * FROM messages WHERE id=?", (message_id,))
    if not result:
        raise HTTPException(404, "Message not found")
    return result[0]


@app.get("/api/tags")
def tags():
    return tag_store.catalog()


class MessagePatch(BaseModel):
    folder: str | None = Field(default=None, pattern=r"^(inbox|archive|trash|local-[1-9][0-9]*)$")
    unread: bool | None = None
    starred: bool | None = None
    tags: list[str] | None = Field(default=None, max_length=12)

    @field_validator("tags")
    @classmethod
    def valid_tags(cls, value):
        if value is None:
            return value
        return tag_store.names(value)


@app.patch("/api/messages/{message_id}")
def patch_message(message_id: int, data: MessagePatch):
    fields = data.model_dump(exclude_none=True)
    if "folder" in fields:
        fields["local_folder_override"] = 1
    if fields:
        with store.db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            if (
                fields.get("folder", "").startswith("local-")
                and not conn.execute(
                    "SELECT id FROM local_folders WHERE id=?", (int(fields["folder"][6:]),)
                ).fetchone()
            ):
                raise HTTPException(422, "Local folder not found")
            if "tags" in fields:
                fields["tags"] = json.dumps(tag_store.canonical(conn, fields["tags"]))
            if "folder" in fields:
                row = conn.execute(
                    "SELECT folder,local_destination_id FROM messages WHERE id=?", (message_id,)
                ).fetchone()
                if not row:
                    raise HTTPException(404, "Message not found")
                if fields["folder"] == "trash" and row["folder"] != "trash":
                    fields["restore_folder"] = row["folder"]
                    fields["restore_destination_id"] = row["local_destination_id"]
                fields["local_destination_id"] = None
            require_change(
                conn.execute(
                    f"UPDATE messages SET {','.join(k + '=?' for k in fields)} WHERE id=?",
                    (*fields.values(), message_id),
                )
            )
    return {"ok": True}


@app.delete("/api/messages/{message_id}")
def delete_message(message_id: int):
    with store.db() as conn:
        require_change(
            conn.execute(
                "DELETE FROM messages WHERE id=? AND folder IN ('trash','drafts')", (message_id,)
            )
        )
    return {"ok": True}


class Compose(BaseModel):
    account_id: int | None = None
    recipient: str = Field(default="", max_length=8192)
    cc: str = Field(default="", max_length=8192)
    bcc: str = Field(default="", max_length=8192)
    subject: str = Field(default="", max_length=998, pattern=r"^[^\r\n]*$")
    body: str = Field(default="", max_length=500_000)
    draft_id: int | None = None
    draft_key: str | None = Field(default=None, pattern=r"^[a-f0-9-]{36}$")
    draft_revision: int | None = Field(default=None, ge=0)


def save_composed(data, folder, sender, demo=False):
    with store.db() as conn:
        cursor = conn.execute(
            """INSERT INTO messages
            (account_id,folder,sender,recipient,subject,body,date,unread,demo,cc,bcc)
            VALUES (?,?,?,?,?,?,?,0,?,?,?)""",
            (
                data.account_id,
                folder,
                sender,
                data.recipient,
                data.subject,
                data.body,
                datetime.now(timezone.utc).isoformat(),
                demo,
                data.cc,
                data.bcc,
            ),
        )
        addresses.remember(conn, sender, data.recipient, data.cc, data.bcc)
        if data.draft_id:
            conn.execute(
                "DELETE FROM messages WHERE id=? AND folder='drafts' AND (? IS NULL OR draft_revision=?)",
                (data.draft_id, data.draft_revision, data.draft_revision),
            )
        return {"id": cursor.lastrowid}


@app.post("/api/drafts")
def save_draft(data: Compose):
    with store.db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if (
            data.account_id
            and not conn.execute("SELECT 1 FROM accounts WHERE id=?", (data.account_id,)).fetchone()
        ):
            data.account_id = None
        row = (
            conn.execute("SELECT * FROM messages WHERE id=?", (data.draft_id,)).fetchone()
            if data.draft_id
            else (
                conn.execute(
                    "SELECT * FROM messages WHERE draft_key=?", (data.draft_key,)
                ).fetchone()
                if data.draft_key
                else None
            )
        )
        if data.draft_id and not row:
            raise HTTPException(409, "Draft no longer exists; your editor has been kept open")
        addresses.remember(conn, data.recipient, data.cc, data.bcc)
        if row:
            if row["folder"] != "drafts":
                raise HTTPException(409, "Draft was sent or moved; your editor has been kept open")
            if data.draft_revision is not None and data.draft_revision != row["draft_revision"]:
                raise HTTPException(409, "Draft changed elsewhere; your editor has been kept open")
            conn.execute(
                "UPDATE messages SET account_id=?,recipient=?,subject=?,body=?,date=?,draft_key=COALESCE(draft_key,?),draft_revision=draft_revision+1,cc=?,bcc=? WHERE id=?",
                (
                    data.account_id,
                    data.recipient,
                    data.subject,
                    data.body,
                    datetime.now(timezone.utc).isoformat(),
                    data.draft_key,
                    data.cc,
                    data.bcc,
                    row["id"],
                ),
            )
            return {"id": row["id"], "draft_revision": row["draft_revision"] + 1}
        cursor = conn.execute(
            "INSERT INTO messages(account_id,folder,sender,recipient,subject,body,date,unread,draft_key,draft_revision,cc,bcc) VALUES (?,'drafts','Me',?,?,?,?,0,?,1,?,?)",
            (
                data.account_id,
                data.recipient,
                data.subject,
                data.body,
                datetime.now(timezone.utc).isoformat(),
                data.draft_key,
                data.cc,
                data.bcc,
            ),
        )
        return {"id": cursor.lastrowid, "draft_revision": 1}


SEND_LOCK = threading.Lock()


@app.post("/api/send")
def send(data: Compose):
    with SEND_LOCK:
        return send_once(data)


def send_once(data: Compose):
    try:
        data.recipient, data.cc, data.bcc = addresses.normalize(data.recipient, data.cc, data.bcc)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    if data.account_id is None:
        raise HTTPException(400, "Connect and select a mail account before sending.")
    account = account_by_id(data.account_id)
    if data.draft_id:
        draft = rows(
            "SELECT draft_revision FROM messages WHERE id=? AND folder='drafts'", (data.draft_id,)
        )
        if not draft or (
            data.draft_revision is not None and data.draft_revision != draft[0]["draft_revision"]
        ):
            raise HTTPException(
                409,
                "Draft changed, moved or was already sent. Check Drafts and Sent before sending.",
            )
    try:
        transport = microsoft if account["provider"] == "microsoft" else mail
        if data.cc or data.bcc:
            transport.send_mail(
                account, data.recipient, data.subject, data.body, cc=data.cc, bcc=data.bcc
            )
        else:
            transport.send_mail(account, data.recipient, data.subject, data.body)
    except Exception as error:
        raise HTTPException(
            502,
            "Mail submission was not confirmed. Check Sent in your provider before retrying; delivery may be uncertain.",
        ) from error
    return save_composed(data, "sent", account["email"])


class Event(calendar_tools.CalendarFields):
    title: str = Field(min_length=1, max_length=200)
    start: datetime
    end: datetime
    location: str = Field(default="", max_length=500)
    notes: str = Field(default="", max_length=10000)

    @model_validator(mode="after")
    def validate_dates(self):
        if not self.start.tzinfo or not self.end.tzinfo:
            raise ValueError("Event times must include a timezone")
        if self.end <= self.start:
            raise ValueError("End time must be after start time")
        if not 1970 <= self.start.year <= 2100 or (self.end - self.start).days > 366:
            raise ValueError("Event start must be 1970–2100 and duration at most one year")
        if self.all_day and any(
            d.astimezone(timezone.utc).time().isoformat() != "00:00:00"
            for d in (self.start, self.end)
        ):
            raise ValueError("All-day dates must use UTC midnight and an exclusive end date")
        zone = timezone.utc if self.all_day else calendar_tools.ZoneInfo(self.timezone)
        if self.recurrence.until and self.recurrence.until < self.start.astimezone(zone).date():
            raise ValueError("Repeat end date must not precede the event")
        return self


@app.get("/api/events")
def events():
    return rows("SELECT * FROM events ORDER BY start")


@app.get("/api/events/occurrences")
def calendar_occurrences(start: datetime, end: datetime):
    if not start.tzinfo or not end.tzinfo or not 0 < (end - start).total_seconds() <= 100 * 86400:
        raise HTTPException(422, "Choose a timezone-aware date range of at most 100 days")
    try:
        return calendar_tools.occurrences(events(), start, end)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


def event_values(data):
    return (
        data.title,
        data.start.astimezone(timezone.utc).isoformat(),
        data.end.astimezone(timezone.utc).isoformat(),
        data.location,
        data.notes,
        data.all_day,
        data.timezone,
        data.recurrence.model_dump_json(),
    )


@app.post("/api/events")
def add_event(data: Event):
    with store.db() as conn:
        c = conn.execute(
            "INSERT INTO events(title,start,end,location,notes,all_day,timezone,recurrence) VALUES (?,?,?,?,?,?,?,?)",
            event_values(data),
        )
        return {"id": c.lastrowid}


@app.put("/api/events/{event_id}")
def update_event(event_id: int, data: Event):
    with store.db() as conn:
        require_change(
            conn.execute(
                "UPDATE events SET title=?,start=?,end=?,location=?,notes=?,all_day=?,timezone=?,recurrence=? WHERE id=?",
                (*event_values(data), event_id),
            )
        )
    return {"ok": True}


@app.delete("/api/events/{event_id}")
def delete_event(event_id: int):
    with store.db() as conn:
        require_change(conn.execute("DELETE FROM events WHERE id=?", (event_id,)))
    return {"ok": True}


@app.get("/api/calendar.ics")
def calendar_export():
    def escape(text):
        return (
            text.replace("\\", "\\\\")
            .replace("\r", "")
            .replace("\n", "\\n")
            .replace(",", "\\,")
            .replace(";", "\\;")
        )

    def stamp(text):
        return datetime.fromisoformat(text).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//inkwell//Calendar//EN"]
    for e in events():
        series, duration = calendar_tools.schedule(e)
        first = next(iter(series), None)
        if first is None:
            continue
        repeat_line = calendar_tools.recurrence_line(e)
        e = {
            **e,
            "start": first.astimezone(timezone.utc).isoformat(),
            "end": (first + duration).astimezone(timezone.utc).isoformat(),
        }
        lines += [
            "BEGIN:VEVENT",
            f"UID:inkwell-{e['id']}@localhost",
            "DTSTAMP:" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
            ("DTSTART;VALUE=DATE:" + e["start"][:10].replace("-", ""))
            if e["all_day"]
            else (
                "DTSTART;TZID="
                + e["timezone"]
                + ":"
                + datetime.fromisoformat(e["start"])
                .astimezone(calendar_tools.ZoneInfo(e["timezone"]))
                .strftime("%Y%m%dT%H%M%S")
            ),
            ("DTEND;VALUE=DATE:" + e["end"][:10].replace("-", ""))
            if e["all_day"]
            else (
                "DTEND;TZID="
                + e["timezone"]
                + ":"
                + datetime.fromisoformat(e["end"])
                .astimezone(calendar_tools.ZoneInfo(e["timezone"]))
                .strftime("%Y%m%dT%H%M%S")
            ),
            *([repeat_line] if repeat_line else []),
            "SUMMARY:" + escape(e["title"]),
            "LOCATION:" + escape(e["location"]),
            "DESCRIPTION:" + escape(e["notes"]),
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    folded = []
    for line in lines:
        current = ""
        for char in line:
            if len((current + char).encode()) > 75:
                folded.append(current)
                current = " "
            current += char
        folded.append(current)
    return Response(
        "\r\n".join(folded) + "\r\n",
        media_type="text/calendar",
        headers={"Content-Disposition": 'attachment; filename="inkwell.ics"'},
    )


class Contact(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: str = Field(max_length=254)
    company: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=10000)

    @field_validator("email")
    @classmethod
    def email_valid(cls, value):
        return validate_email(value)


@app.get("/api/contacts")
def contacts():
    return rows("SELECT * FROM contacts ORDER BY name COLLATE NOCASE")


@app.post("/api/contacts")
def add_contact(data: Contact):
    with store.db() as conn:
        c = conn.execute(
            "INSERT INTO contacts(name,email,company,notes) VALUES (?,?,?,?)",
            tuple(data.model_dump().values()),
        )
        addresses.remember(conn, data.email, display_name=data.name)
        return {"id": c.lastrowid}


@app.put("/api/contacts/{contact_id}")
def update_contact(contact_id: int, data: Contact):
    with store.db() as conn:
        require_change(
            conn.execute(
                "UPDATE contacts SET name=?,email=?,company=?,notes=? WHERE id=?",
                (*data.model_dump().values(), contact_id),
            )
        )
        addresses.remember(conn, data.email, display_name=data.name)
    return {"ok": True}


@app.delete("/api/contacts/{contact_id}")
def delete_contact(contact_id: int):
    with store.db() as conn:
        require_change(conn.execute("DELETE FROM contacts WHERE id=?", (contact_id,)))
    return {"ok": True}


class AIConfig(BaseModel):
    provider: str = "custom"

    @field_validator("provider")
    @classmethod
    def valid_provider(cls, value):
        if value not in ai.PROVIDERS:
            raise ValueError("Unknown AI provider")
        return value

    endpoint: str = Field(default="http://127.0.0.1:11434/v1", max_length=2000)
    model: str = Field(default="llama3.2", min_length=1, max_length=200)
    api_key: str = Field(default="", max_length=4096)
    instructions: str = Field(default="Be concise, thoughtful and professional.", max_length=5000)

    @model_validator(mode="after")
    def validate_codex(self):
        if self.provider == "codex":
            import re

            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:/-]*", self.model):
                raise ValueError("Invalid Codex model identifier")
        return self

    @field_validator("endpoint")
    @classmethod
    def valid_endpoint(cls, value):
        p = urlparse(value)
        if p.username or p.password or p.query or p.fragment or not p.hostname:
            raise ValueError("Enter a base URL without credentials, query or fragment")
        if p.scheme != "https" and not (
            p.scheme == "http" and p.hostname in ("localhost", "127.0.0.1", "::1")
        ):
            raise ValueError("Remote AI endpoints must use HTTPS")
        return value.rstrip("/")


@app.get("/api/ai/providers")
def ai_providers():
    return ai.catalog()


@app.get("/api/ai/codex/status")
def codex_status():
    return ai.codex_status()


@app.get("/api/ai/config")
def ai_config():
    import json

    data = json.loads(store.setting("ai_config", "{}"))
    data["has_key"] = bool(store.setting("ai_key"))
    return data


@app.put("/api/ai/config")
def save_ai_config(data: AIConfig):
    import json

    with store.db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT value FROM settings WHERE key='ai_config'").fetchone()
        previous = json.loads(row[0] if row else "{}")
        # Never forward a previous provider's key to a newly selected endpoint.
        same_destination = (
            previous.get("provider", "custom") == data.provider
            and previous.get("endpoint") == data.endpoint
        )
        conn.execute(
            "INSERT OR REPLACE INTO settings VALUES ('ai_config', ?)",
            (json.dumps(data.model_dump(exclude={"api_key"})),),
        )
        if data.api_key and data.provider != "codex":
            conn.execute(
                "INSERT OR REPLACE INTO settings VALUES ('ai_key', ?)", (store.seal(data.api_key),)
            )
        elif not same_destination or data.provider == "codex":
            conn.execute("DELETE FROM settings WHERE key='ai_key'")
    return {"ok": True}


@app.delete("/api/ai/config")
def clear_ai_config():
    with store.db() as conn:
        conn.execute("DELETE FROM settings WHERE key IN ('ai_config','ai_key')")
    return {"ok": True}


class AIRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=10000)
    context: str = Field(default="", max_length=30000)


@app.post("/api/ai/chat")
def ai_chat(data: AIRequest):
    import json

    with store.db() as conn:
        settings = dict(
            conn.execute(
                "SELECT key,value FROM settings WHERE key IN ('ai_config','ai_key')"
            ).fetchall()
        )
    config = json.loads(settings.get("ai_config", "{}"))
    if not config:
        raise HTTPException(400, "Configure your AI provider in Settings first.")
    try:
        secret = settings.get("ai_key", "")
        return {
            "answer": ai.answer(
                config, store.unseal(secret) if secret else "", data.prompt, data.context
            )
        }
    except Exception as error:
        raise HTTPException(
            502,
            "AI request failed. Check provider, endpoint, model and credentials. For Codex, check ChatGPT login and CLI version on the backend; for local models, start the model server.",
        ) from error


@app.post("/api/demo")
def demo():
    with store.db() as conn:
        if conn.execute("SELECT 1 FROM settings WHERE key='demo_loaded'").fetchone():
            return {"ok": True}
        now = datetime.now(timezone.utc)
        samples = [
            (
                "Maya Chen <maya@example.com>",
                "A little space for your best work",
                "Welcome to inkwell!\n\nThis is your quieter corner of the internet. A place for meaningful conversations, a clear calendar, and a little more focus.\n\nTry starring this message, drafting a reply, or asking your AI assistant to summarize it. These are sample messages — connect an account in Settings when you’re ready for real mail.\n\nMake yourself at home,\nMaya",
                1,
            ),
            (
                "Oliver Park <oliver@example.com>",
                "Design review · the next chapter",
                "Hi there,\n\nCould we meet tomorrow to review the new direction? I’m particularly excited about the typography and the simplified onboarding.\n\nPlease bring your notes on accessibility and mobile navigation. We’ll aim for 30 minutes.\n\nThanks,\nOliver",
                1,
            ),
            (
                "The Sunday Edit <hello@example.com>",
                "Things worth slowing down for",
                "This week’s reading list:\n\n1. Designing software that respects attention\n2. The quiet joy of a well-organized workspace\n3. Building a daily writing habit\n\nNo rush. These will be here when you’re ready.",
                0,
            ),
            (
                "Alex Rivera <alex@example.com>",
                "Re: Weekend plans",
                "The little coffee shop by the river sounds perfect. Saturday at 10?\n\nI’ll bring the book I mentioned. See you there!\n\nAlex",
                0,
            ),
            (
                "Sam Taylor <sam@example.com>",
                "Project notes and next steps",
                "Thanks for the productive discussion.\n\nNext steps:\n• Review the prototype by Thursday\n• Confirm the launch checklist\n• Schedule a security review before release\n\nLet me know if I missed anything.\nSam",
                0,
            ),
        ]
        for i, (sender, subject, body, unread) in enumerate(samples):
            conn.execute(
                "INSERT INTO messages(sender,recipient,subject,body,date,unread,starred,demo) VALUES (?,?,?,?,?,?,?,1)",
                (
                    sender,
                    "you@inkwell.local",
                    subject,
                    body,
                    (now - timedelta(hours=i * 3)).isoformat(),
                    unread,
                    int(i == 1),
                ),
            )
        start = (now + timedelta(days=1)).replace(hour=14, minute=0, second=0, microsecond=0)
        conn.execute(
            "INSERT INTO events(title,start,end,location,notes) VALUES (?,?,?,?,?)",
            (
                "Design review (sample)",
                start.isoformat(),
                (start + timedelta(minutes=30)).isoformat(),
                "Studio / Video call",
                "Review typography, onboarding and accessibility.",
            ),
        )
        conn.execute(
            "INSERT INTO contacts(name,email,company) VALUES (?,?,?)",
            ("Maya Chen", "maya@example.com", "inkwell · sample contact"),
        )
        conn.execute("INSERT INTO settings VALUES ('demo_loaded','1')")
    return {"ok": True}
