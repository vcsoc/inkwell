"""Rules organize local imported copies only. First matching enabled rule wins."""

import json
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import store
from .message_keys import sender_key, domain_key

router = APIRouter(prefix="/api")


class Folder(BaseModel):
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def name_valid(cls, value):
        value = value.strip()
        if not value or any(ord(c) < 32 for c in value):
            raise ValueError("Invalid folder name")
        return value


@router.get("/local-folders")
def folders():
    with store.db() as db:
        return [dict(r) for r in db.execute("SELECT * FROM local_folders ORDER BY name")]


@router.post("/local-folders")
def add_folder(data: Folder):
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        if db.execute(
            "SELECT 1 FROM local_folders WHERE name=? COLLATE NOCASE", (data.name,)
        ).fetchone():
            raise HTTPException(409, "A local folder already has that name")
        return {
            "id": db.execute("INSERT INTO local_folders(name) VALUES (?)", (data.name,)).lastrowid
        }


@router.delete("/local-folders/{id}")
def delete_folder(id: int):
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        key = "local-" + str(id)
        if (
            db.execute("SELECT 1 FROM messages WHERE folder=?", (key,)).fetchone()
            or db.execute(
                "SELECT 1 FROM mail_rules WHERE json_extract(config,'$.folder')=?", (key,)
            ).fetchone()
        ):
            raise HTTPException(
                409, "Folder is not empty or is used by a rule; nothing was deleted"
            )
        db.execute("DELETE FROM local_folders WHERE id=?", (id,))
    return {"ok": True}


class Rule(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=100)
    enabled: bool = True
    match: Literal["sender", "domain"] = "sender"
    value: str = Field(min_length=1, max_length=254)
    folder: str = Field(pattern=r"^(inbox|archive|trash|local-[1-9][0-9]*)$")
    exclude_unread: bool = False
    older_than_days: int = Field(default=0, ge=0, le=36500)

    @field_validator("value")
    @classmethod
    def no_controls(cls, value):
        if any(ord(c) < 32 for c in value):
            raise ValueError("Invalid address/domain")
        return value.strip()


def validate_rule(data, db):
    key = (
        sender_key(data.value)
        if data.match == "sender"
        else domain_key("rule@" + data.value.strip().lstrip("@"))
    )
    if not key or (data.match == "sender" and "@" not in key):
        raise HTTPException(422, "Enter a sender address or exact domain")
    if (
        data.folder.startswith("local-")
        and not db.execute(
            "SELECT 1 FROM local_folders WHERE id=?", (int(data.folder[6:]),)
        ).fetchone()
    ):
        raise HTTPException(422, "Local destination folder not found")
    data.value = key


@router.get("/rules")
def list_rules():
    with store.db() as db:
        return [
            {"id": r["id"], **json.loads(r["config"])}
            for r in db.execute("SELECT * FROM mail_rules ORDER BY id")
        ]


@router.post("/rules")
def create(data: Rule):
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        validate_rule(data, db)
        if db.execute("SELECT count(*) FROM mail_rules").fetchone()[0] >= 100:
            raise HTTPException(422, "Maximum 100 import rules")
        return {
            "id": db.execute(
                "INSERT INTO mail_rules(config) VALUES (?)", (data.model_dump_json(),)
            ).lastrowid
        }


@router.put("/rules/{id}")
def update(id: int, data: Rule):
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        validate_rule(data, db)
        if not db.execute(
            "UPDATE mail_rules SET config=? WHERE id=?", (data.model_dump_json(), id)
        ).rowcount:
            raise HTTPException(404, "Rule not found")
    return {"ok": True}


@router.delete("/rules/{id}")
def delete(id: int):
    with store.db() as db:
        db.execute("DELETE FROM mail_rules WHERE id=?", (id,))
    return {"ok": True}


def configured_rules(db):
    return [
        Rule.model_validate_json(row["config"])
        for row in db.execute("SELECT config FROM mail_rules ORDER BY id")
    ]


def apply(db, message_id, now=None, configured=None):
    m = db.execute(
        "SELECT id,folder,local_folder_override,unread,sender_key,domain_key,date FROM messages WHERE id=?",
        (message_id,),
    ).fetchone()
    if not m or m["local_folder_override"] or m["folder"] in ("drafts", "sent", "trash"):
        return False
    now = now or datetime.now(timezone.utc)
    for r in configured if configured is not None else configured_rules(db):
        if not r.enabled or (r.exclude_unread and m["unread"]):
            continue
        key = m["sender_key"] if r.match == "sender" else m["domain_key"]
        if key != r.value:
            continue
        if r.older_than_days:
            try:
                date = datetime.fromisoformat(m["date"])
            except ValueError:
                continue
            if not date.tzinfo or date >= now - timedelta(days=r.older_than_days):
                continue
        if r.folder == "trash":
            db.execute(
                "UPDATE messages SET restore_folder=folder,restore_destination_id=local_destination_id WHERE id=?",
                (message_id,),
            )
        db.execute(
            "UPDATE messages SET folder=?,local_folder_override=1 WHERE id=?",
            (r.folder, message_id),
        )
        return True
    return False


@router.post("/rules/apply")
def apply_existing():
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        configured = configured_rules(db)
        now = datetime.now(timezone.utc)
        ids = [
            r[0]
            for r in db.execute(
                "SELECT id FROM messages WHERE remote_key IS NOT NULL AND local_folder_override=0"
            )
        ]
        count = sum(apply(db, id, now, configured) for id in ids)
    return {"moved": count}
