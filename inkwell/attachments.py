"""Read-only provider attachment discovery; opaque, anchor-bound download identifiers."""

import hashlib
import json
import re
import tempfile
import threading
import time
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from email.utils import parsedate_to_datetime
from urllib.parse import quote, unquote, urlencode, urlsplit

import httpx
from fastapi import APIRouter, HTTPException
from starlette.background import BackgroundTask
from starlette.responses import StreamingResponse

from . import mail, microsoft, store

router = APIRouter()
LOCKS = [threading.Lock() for _ in range(64)]
MAX_FILE = 50_000_000
MAX_IMAP = 10_000_000
SELECT_MESSAGE = "id,conversationId,subject,from,receivedDateTime"
SELECT_ATTACHMENT = "id,name,contentType,size,isInline"


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def context(id):
    with store.db() as db:
        m = db.execute("SELECT * FROM messages WHERE id=?", (id,)).fetchone()
        if not m:
            raise HTTPException(404, "Message no longer exists")
        a = db.execute("SELECT * FROM accounts WHERE id=?", (m["account_id"],)).fetchone()
        row = db.execute("SELECT state FROM attachment_views WHERE message_id=?", (id,)).fetchone()
    return dict(m), dict(a) if a else None, json.loads(row["state"]) if row else None


def owner(a):
    a = dict(a)
    return digest(
        json.dumps(
            [
                a["id"],
                a["provider"],
                a["email"].casefold(),
                a.get("username"),
                a.get("imap_host"),
                a.get("imap_port"),
            ]
        )
    )


def current(id, state):
    m, a, _ = context(id)
    if not a or owner(a) != state["owner"] or m["remote_key"] != state["root_key"]:
        raise HTTPException(409, "Account or message changed; reload the attachment list")
    return m, a


def save(id, state):
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        m = db.execute("SELECT account_id,remote_key FROM messages WHERE id=?", (id,)).fetchone()
        a = (
            db.execute("SELECT * FROM accounts WHERE id=?", (m["account_id"],)).fetchone()
            if m
            else None
        )
        if not a or owner(a) != state["owner"] or m["remote_key"] != state["root_key"]:
            raise HTTPException(409, "Account disconnected or message changed")
        db.execute(
            "INSERT INTO attachment_views(message_id,state) VALUES (?,?) ON CONFLICT(message_id) DO UPDATE SET state=excluded.state",
            (id, json.dumps(state)),
        )


def public(state, connected):
    if not state:
        return {
            "groups": [],
            "complete": False,
            "scope": "unknown",
            "connected": connected,
            "error": "",
            "pending": 0,
        }
    groups = []
    for group in state["groups"]:
        files = [
            {
                k: f[k]
                for k in ("id", "name", "size", "content_type", "inline", "kind", "cached_only")
            }
            | {
                "downloadable": connected
                and f["kind"] == "file"
                and not f["cached_only"]
                and f["size"] <= MAX_FILE
            }
            for f in group["files"]
        ]
        groups.append(
            {
                k: group[k]
                for k in ("key", "subject", "sender", "date", "selected", "cached_only", "checked")
            }
            | {"files": files}
        )
    return {
        "groups": groups,
        "complete": state["complete"],
        "scope": state["scope"],
        "connected": connected,
        "error": state.get("error", "")
        if connected
        else "This copy is offline; showing cached attachment metadata only.",
        "warning": state.get("warning", ""),
        "pending": len(state.get("queue", [])),
        "updated": state.get("updated"),
        "retry_at": state.get("retry_at", 0),
    }


def graph_url(path, params=None):
    return microsoft.GRAPH + "/me/" + path + ("?" + urlencode(params) if params else "")


def valid_url(url):
    p = urlsplit(url)
    path = unquote(p.path)
    if (
        p.scheme != "https"
        or p.netloc != "graph.microsoft.com"
        or not (path == "/v1.0/me/messages" or path.startswith("/v1.0/me/messages/"))
        or any(part in (".", "..") for part in path.split("/"))
        or p.fragment
    ):
        raise ValueError("Unexpected attachment pagination URL")


def graph(client, url, headers):
    valid_url(url)
    raw = bytearray()
    with client.stream("GET", url, headers=headers) as response:
        response.raise_for_status()
        for chunk in response.iter_bytes(chunk_size=65536):
            raw.extend(chunk)
            if len(raw) > 4_000_000:
                raise ValueError("Attachment metadata page exceeds the safe display limit")
    result = json.loads(raw)
    if not isinstance(result, dict):
        raise ValueError("Unexpected attachment metadata")
    return result


def group_for(state, remote):
    return next(g for g in state["groups"] if g["remote"] == remote)


def add_group(state, item):
    remote = str(item["id"])
    existing = next((g for g in state["groups"] if g["remote"] == remote), None)
    if not existing:
        existing = {"remote": remote, "key": digest(remote), "files": [], "checked": False}
        state["groups"].append(existing)
    address = (item.get("from") or {}).get("emailAddress") or {}
    existing.update(
        subject=str(item.get("subject") or "(No subject)")[:1000],
        sender=str(address.get("address") or address.get("name") or "Unknown sender")[:500],
        date=str(item.get("receivedDateTime") or "")[:100],
        selected=remote == state["root_remote"],
        cached_only=False,
    )
    return existing


def file_job(remote):
    return {
        "kind": "files",
        "remote": remote,
        "url": graph_url(
            "messages/" + quote(remote, safe="") + "/attachments", {"$select": SELECT_ATTACHMENT}
        ),
        "seen": [],
    }


def continuation(job, result):
    url = result.get("@odata.nextLink")
    if not url:
        return None
    valid_url(url)
    if unquote(urlsplit(url).path) != unquote(urlsplit(job["url"]).path):
        raise ValueError("Attachment pagination changed resource; list is incomplete")
    hashes = job.get("seen", []) + [digest(job["url"])]
    if digest(url) in hashes:
        raise ValueError("Repeated attachment pagination checkpoint; list is incomplete")
    return {**job, "url": url, "seen": hashes}


def advance_graph(id, a, state):
    job = state["queue"][0]
    with microsoft.client() as client:
        result = graph(
            client,
            job["url"],
            {
                "Authorization": "Bearer " + microsoft.access_token(a),
                "Prefer": 'IdType="ImmutableId"',
            },
        )
    current(id, state)
    if job["kind"] != "root" and not isinstance(result.get("value"), list):
        raise ValueError("Invalid attachment metadata page; the list is incomplete")
    rest = state["queue"][1:]
    if job["kind"] == "root":
        add_group(state, result)
        state["root_remote"] = str(result["id"])
        state["discovered"] = [state["root_remote"]]
        group_for(state, state["root_remote"])["selected"] = True
        conversation = str(result.get("conversationId") or "")
        if state.get("conversation") and state["conversation"] != conversation:
            state["groups"] = [g for g in state["groups"] if g["remote"] == state["root_remote"]]
        state["conversation"] = conversation
        state["scope"] = "thread" if conversation else "message"
        if conversation:
            # Keep known metadata for cached members no longer returned by the server.
            with store.db() as db:
                previous = db.execute(
                    "SELECT state FROM attachment_views WHERE message_id<>? AND json_extract(state,'$.owner')=? AND json_extract(state,'$.conversation')=?",
                    (id, state["owner"], conversation),
                ).fetchall()
            known = {g["remote"] for g in state["groups"]}
            for row in previous:
                for g in json.loads(row["state"])["groups"]:
                    if g["remote"] not in known:
                        g.update(selected=False, cached_only=True, checked=False)
                        for f in g["files"]:
                            f["cached_only"] = True
                        state["groups"].append(g)
                        known.add(g["remote"])
        rest = [file_job(state["root_remote"])]
        if conversation:
            rest.append(
                {
                    "kind": "thread",
                    "url": graph_url(
                        "messages",
                        {
                            "$select": SELECT_MESSAGE,
                            "$top": "50",
                            "$filter": "conversationId eq '"
                            + conversation.replace("'", "''")
                            + "'",
                        },
                    ),
                    "seen": [],
                }
            )
    elif job["kind"] == "thread":
        more = continuation(job, result)
        jobs = []
        for item in result.get("value", []):
            remote = str(item["id"])
            # Never infer a thread from subject lines or mix provider conversations.
            if str(item.get("conversationId") or "") != state["conversation"]:
                raise ValueError("Provider returned a different conversation; list is incomplete")
            seen = remote in state["discovered"]
            add_group(state, item)
            if not seen:
                state["discovered"].append(remote)
                jobs.append(file_job(remote))
        rest = jobs + ([more] if more else []) + rest
    else:
        more = continuation(job, result)
        group = group_for(state, job["remote"])
        for item in result.get("value", []):
            remote = str(item["id"])
            token = digest(state["owner"] + ":" + group["remote"] + ":" + remote)
            kind = {
                "#microsoft.graph.fileAttachment": "file",
                "#microsoft.graph.itemAttachment": "item",
                "#microsoft.graph.referenceAttachment": "cloud",
            }.get(item.get("@odata.type"), "unknown")
            file = {
                "id": token,
                "remote": remote,
                "name": str(item.get("name") or "Unnamed attachment")[:1024],
                "size": max(0, int(item.get("size") or 0)),
                "content_type": str(item.get("contentType") or "application/octet-stream")[:200],
                "inline": bool(item.get("isInline")),
                "kind": kind,
                "cached_only": False,
            }
            old = next((f for f in group["files"] if f["id"] == token), None)
            if old:
                old.update(file)
            else:
                group["files"].append(file)
        group["checked"] = not more
        if more:
            rest = [more] + rest
    state["queue"] = rest
    state["complete"] = not rest
    state["updated"] = datetime.now(timezone.utc).isoformat()


def imap_message(a, key):
    match = re.fullmatch(re.escape(str(a["id"])) + r":INBOX:(\d+):(\d+)", key or "")
    if not match:
        raise ValueError("This message has no current IMAP reference")
    validity, uid = match.groups()
    with mail.imaplib.IMAP4_SSL(
        a["imap_host"], a["imap_port"], ssl_context=mail.ssl.create_default_context(), timeout=25
    ) as client:
        client.login(a["username"], store.unseal(a["secret"]))
        status, _ = client.select("INBOX", readonly=True)
        if status != "OK" or client.response("UIDVALIDITY")[1][0] != validity.encode():
            raise ValueError("IMAP mailbox identity changed; resync before downloading")
        status, meta = client.uid("fetch", uid, "(RFC822.SIZE)")
        sizes = re.findall(
            rb"RFC822.SIZE (\d+)", b" ".join(x for x in meta if isinstance(x, bytes))
        )
        if status != "OK" or not sizes or int(sizes[0]) > MAX_IMAP:
            raise ValueError("IMAP attachment inspection is limited to messages under 10 MB")
        status, raw = client.uid("fetch", uid, "(BODY.PEEK[]<0.10000001>)")
        payload = next((x[1] for x in raw if isinstance(x, tuple)), None)
        if status != "OK" or payload is None or len(payload) > MAX_IMAP:
            raise ValueError("Could not safely read the IMAP message")
    return BytesParser(policy=policy.default).parsebytes(payload)


def mime_files(message):
    output = []
    total = 0
    for index, part in enumerate(message.walk()):
        if index > 2000:
            raise ValueError("Too many MIME parts to inspect safely")
        kind = part.get_content_type()
        name = part.get_filename()
        disposition = part.get_content_disposition()
        if not (name or disposition == "attachment" or part.get("Content-ID")):
            continue
        if part.is_multipart() and kind != "message/rfc822":
            continue
        data = part.get_payload(decode=True)
        if kind == "message/rfc822" and isinstance(part.get_payload(), list):
            data = b"\r\n".join(
                child.as_bytes(policy=policy.SMTP.clone(max_line_length=0, refold_source="none"))
                for child in part.get_payload()
            )
        if data is None:
            continue
        total += len(data)
        if total > 2 * MAX_IMAP:
            raise ValueError("Nested attachment contents exceed the inspection limit")
        output.append(
            (
                index,
                name or ("attached-email.eml" if kind == "message/rfc822" else "inline-attachment"),
                kind,
                disposition != "attachment"
                and bool(part.get("Content-ID") or disposition == "inline"),
                data,
            )
        )
    return output


def advance_imap(id, m, a, state):
    parts = mime_files(imap_message(a, m["remote_key"]))
    current(id, state)
    files = [
        {
            "id": digest(state["owner"] + ":" + m["remote_key"] + ":" + str(index)),
            "remote": str(index),
            "name": name[:1024],
            "size": len(data),
            "content_type": kind,
            "inline": inline,
            "kind": "file",
            "cached_only": False,
        }
        for index, name, kind, inline, data in parts
    ]
    state["groups"] = [
        {
            "key": digest(m["remote_key"]),
            "remote": m["remote_key"],
            "subject": m["subject"],
            "sender": m["sender"],
            "date": m["date"],
            "selected": True,
            "cached_only": False,
            "checked": True,
            "files": files,
        }
    ]
    state.update(
        queue=[], complete=True, scope="message", updated=datetime.now(timezone.utc).isoformat()
    )


def failure(state, error):
    if isinstance(error, httpx.HTTPStatusError) and error.response.status_code in (429, 503):
        value = error.response.headers.get("Retry-After", "60")
        try:
            delay = float(value)
        except ValueError:
            try:
                delay = parsedate_to_datetime(value).timestamp() - time.time()
            except (ValueError, TypeError, OverflowError):
                delay = 60
        state["retry_at"] = time.time() + min(3600, max(1, delay))
        state["error"] = (
            "Provider requested a pause. Retry after the indicated time; the list may be incomplete."
        )
    elif isinstance(error, ValueError):
        state["error"] = str(error)[:300]
    else:
        state["error"] = (
            "Could not finish checking attachments. The cached list may be incomplete; check your connection/account and retry."
        )


@router.get("/api/messages/{id}/attachments")
def cached(id: int):
    m, a, state = context(id)
    connected = bool(a and m["remote_key"])
    if state and a and (state["owner"] != owner(a) or state["root_key"] != m["remote_key"]):
        state = None
    result = public(state, connected)
    if not connected:
        result["error"] = (
            "This copy has no connected provider reference. Only previously discovered attachment metadata is available; files require the connected account."
        )
    return result


def work(id, reset):
    lock = LOCKS[id % len(LOCKS)]
    if not lock.acquire(blocking=False):
        raise HTTPException(409, "An attachment check is already running; retry shortly")
    try:
        m, a, state = context(id)
        if not a or not m["remote_key"]:
            return cached(id)
        if state and state.get("retry_at", 0) > time.time():
            return public(state, True)
        if reset or not state:
            old = (
                state
                if state and state["owner"] == owner(a) and state["root_key"] == m["remote_key"]
                else None
            )
            remote = (
                m["remote_key"].removeprefix(f"{a['id']}:graph:")
                if a["provider"] == "microsoft"
                else m["remote_key"]
            )
            if a["provider"] == "microsoft" and not m["remote_key"].startswith(f"{a['id']}:graph:"):
                raise HTTPException(422, "This message has no Outlook reference")
            state = {
                "owner": owner(a),
                "root_key": m["remote_key"],
                "root_remote": remote,
                "groups": old["groups"] if old else [],
                "scope": old["scope"] if old else "unknown",
                "conversation": old.get("conversation", "") if old else "",
                "complete": False,
                "discovered": [remote],
                "queue": [
                    {
                        "kind": "root",
                        "url": graph_url(
                            "messages/" + quote(remote, safe=""), {"$select": SELECT_MESSAGE}
                        ),
                    }
                ],
            }
            for g in state["groups"]:
                g.update(cached_only=True, checked=False)
                for f in g["files"]:
                    f["cached_only"] = True
        current(id, state)
        state["error"] = ""
        if state["queue"]:
            try:
                if a["provider"] == "microsoft":
                    advance_graph(id, a, state)
                else:
                    advance_imap(id, m, a, state)
            except HTTPException:
                raise
            except Exception as error:
                if (
                    isinstance(error, httpx.HTTPStatusError)
                    and error.response.status_code == 404
                    and state["queue"][0].get("kind") == "files"
                ):
                    group = group_for(state, state["queue"][0]["remote"])
                    group.update(cached_only=True, checked=False)
                    for f in group["files"]:
                        f["cached_only"] = True
                    state["queue"] = state["queue"][1:]
                    state["complete"] = not state["queue"]
                    state["warning"] = (
                        "A conversation message is no longer available on the server. Other messages were checked, but this attachment list may be incomplete."
                    )
                else:
                    failure(state, error)
        save(id, state)
        return public(state, True)
    finally:
        lock.release()


@router.post("/api/messages/{id}/attachments/refresh")
def refresh(id: int):
    return work(id, True)


@router.post("/api/messages/{id}/attachments/continue")
def resume(id: int):
    return work(id, False)


def filename(value):
    name = (
        re.sub(r"[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069/\\]", "_", value).strip(" .")
        or "attachment"
    )
    if len(name.encode("utf-8")) > 240:
        match = re.search(r"\.[a-zA-Z0-9]{1,12}$", name)
        extension = match.group() if match else ""
        prefix = name[: -len(extension)] if extension else name
        name = (
            prefix.encode("utf-8")[: 240 - len(extension)].decode("utf-8", errors="ignore")
            + extension
        )
    return name


@router.get("/api/messages/{id}/attachments/{token}/download")
def download(id: int, token: str):
    m, a, state = context(id)
    if not state or not re.fullmatch(r"[a-f0-9]{64}", token):
        raise HTTPException(404, "Attachment not found in this message view")
    m, a = current(id, state)
    found = [(g, f) for g in state["groups"] for f in g["files"] if f["id"] == token]
    if not found:
        raise HTTPException(404, "Attachment not found in this message view")
    group, file = found[0]
    if file["kind"] != "file" or file["cached_only"]:
        raise HTTPException(
            422, "This attachment needs a fresh listing or must be opened in your provider"
        )
    if file["size"] > MAX_FILE:
        raise HTTPException(413, "Downloads are limited to 50 MB per attachment")
    temp = tempfile.TemporaryFile(dir=store.DATA)
    try:
        if a["provider"] == "microsoft":
            url = graph_url(
                "messages/"
                + quote(group["remote"], safe="")
                + "/attachments/"
                + quote(file["remote"], safe="")
                + "/$value"
            )
            with microsoft.client() as client:
                with client.stream(
                    "GET",
                    url,
                    headers={
                        "Authorization": "Bearer " + microsoft.access_token(a),
                        "Prefer": 'IdType="ImmutableId"',
                    },
                ) as response:
                    response.raise_for_status()
                    for chunk in response.iter_bytes(chunk_size=65536):
                        if temp.tell() + len(chunk) > MAX_FILE:
                            raise HTTPException(413, "Attachment exceeds the 50 MB download limit")
                        temp.write(chunk)
        else:
            parts = mime_files(imap_message(a, m["remote_key"]))
            part = next((p for p in parts if str(p[0]) == file["remote"]), None)
            if part is None:
                raise HTTPException(404, "Attachment is no longer available")
            temp.write(part[4])
        current(id, state)
        size = temp.tell()
        temp.seek(0)
        name = filename(file["name"])
        fallback = re.sub(r"[^a-zA-Z0-9._ -]", "_", name) or "attachment"
        return StreamingResponse(
            iter(lambda: temp.read(65536), b""),
            media_type="application/octet-stream",
            headers={
                "Content-Length": str(size),
                "Content-Disposition": f"attachment; filename=\"{fallback}\"; filename*=UTF-8''"
                + quote(name, safe=""),
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "sandbox; default-src 'none'",
                "Cache-Control": "no-store",
            },
            background=BackgroundTask(temp.close),
        )
    except HTTPException:
        temp.close()
        raise
    except Exception as error:
        temp.close()
        raise HTTPException(
            502,
            "Attachment download failed. It may be unavailable on the server; check your connection/account and retry.",
        ) from error
