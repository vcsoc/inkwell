"""Indexed, cross-folder email collections. No remote mailbox changes."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import Field

from . import store, mail_filters

router = APIRouter(prefix="/api/collections")
Kind = Literal["sender", "organisation", "subject"]
COLUMNS = {"sender": "sender_key", "organisation": "domain_key", "subject": "subject_key"}
LABELS = {"sender": "Sender", "organisation": "Organisation", "subject": "Subject"}


@router.get("/from-message/{message_id}")
def descriptor(message_id: int, kind: Kind):
    with store.db() as db:
        row = db.execute(
            "SELECT sender_key,domain_key,subject_key FROM messages WHERE id=?", (message_id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Message not found")
    key = row[COLUMNS[kind]]
    if not key and kind != "subject":
        raise HTTPException(422, "This message has no usable sender email address.")
    return {"kind": kind, "key": key, "label": LABELS[kind] + ": " + (key or "(No subject)")}


class Query(mail_filters.Filters):
    kind: Kind
    key: str = Field(max_length=2000)
    q: str = Field(default="", max_length=200)
    offset: int = Field(default=0, ge=0)


@router.post("/query")
def query(data: Query):
    column = COLUMNS[data.kind]
    clause = column + "=?"
    params = [data.key]
    if data.q:
        clause += " AND (subject LIKE ? OR sender LIKE ? OR body LIKE ? OR EXISTS (SELECT 1 FROM json_each(messages.tags) WHERE value LIKE ?))"
        params += [f"%{data.q}%"] * 4
    extra, values = data.sql()
    clause = "(" + clause + ")" + extra
    params += values
    with store.db() as db:
        # Keep summary and page results consistent while other clients modify mail.
        db.execute("BEGIN")
        total = db.execute(f"SELECT count(*) FROM messages WHERE {clause}", params).fetchone()[0]
        folders = [
            dict(row)
            for row in db.execute(
                f"SELECT folder,count(*) AS total FROM messages WHERE {clause} GROUP BY folder ORDER BY folder",
                params,
            )
        ]
        messages = [
            dict(row)
            for row in db.execute(
                f"""SELECT id,account_id,remote_folder_id,local_destination_id,local_folder_override,tags,folder,sender,recipient,subject,substr(body,1,180) AS preview,date,unread,starred,demo
            FROM messages WHERE {clause} ORDER BY {data.order()} LIMIT 100 OFFSET ?""",
                (*params, data.offset),
            )
        ]
    return {"total": total, "folders": folders, "messages": messages}
