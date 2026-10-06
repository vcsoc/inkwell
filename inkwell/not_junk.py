"""Workspace-wide Not Junk decisions; queue server filing when authorized."""

from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from . import store, message_moves, provider_sync

router = APIRouter(prefix="/api")


def remote_ancestors(db, id):
    return db.execute(
        """WITH RECURSIVE ancestors AS (
      SELECT id,account_id,remote_id,parent_remote_id,name,well_known FROM remote_folders WHERE id=?
      UNION SELECT p.id,p.account_id,p.remote_id,p.parent_remote_id,p.name,p.well_known FROM remote_folders p
      JOIN ancestors c ON p.account_id=c.account_id AND p.remote_id=c.parent_remote_id
    ) SELECT name,well_known FROM ancestors""",
        (id,),
    ).fetchall()


def incoming(db, message):
    if (
        message["folder"] in {"drafts", "sent"}
        or message["draft_revision"]
        or message["restore_folder"] in {"drafts", "sent"}
    ):
        return False
    for row in remote_ancestors(db, message["remote_folder_id"]):
        if (row["well_known"] or "").lower() in {"sentitems", "drafts"} or row[
            "name"
        ].strip().casefold() in {"sent", "sent items", "drafts"}:
            return False
    return True


def remembered(db, message):
    return bool(
        message["sender_key"]
        and db.execute(
            "SELECT 1 FROM not_junk_senders WHERE sender_key=?", (message["sender_key"],)
        ).fetchone()
    )


def blocked_destination(db, value):
    if value == "trash":
        return True
    if value.startswith("remote:"):
        for row in remote_ancestors(db, int(value[7:])):
            if (row["well_known"] or "").lower() in {
                "junkemail",
                "deleteditems",
                "sentitems",
                "drafts",
            } or row["name"].strip().casefold() in {
                "junk",
                "junk email",
                "spam",
                "trash",
                "deleted items",
                "junk e-mail",
            }:
                return True
    if value.startswith("local-"):
        row = db.execute("SELECT name FROM local_folders WHERE id=?", (int(value[6:]),)).fetchone()
        return bool(
            row
            and row["name"].strip().casefold()
            in {"junk", "junk email", "spam", "trash", "deleted items"}
        )
    return False


def file_copy(db, message, configured=None, explicit=False):
    from . import rules

    try:
        target = provider_sync.ensure_move(db, message, "inbox")
    except HTTPException:
        if explicit:
            raise
        return False  # Missing write consent must not interrupt automatic mail import.
    # Rescue resets previous filing, but keeps provider identity and message contents.
    message_moves.file_message(db, message, "inbox")
    if target:
        provider_sync.enqueue_mail(db, message, "move", target)
    rules.apply(db, message["id"], configured=configured, force=True, safe_sender=True)
    return True


@router.post("/messages/{id}/not-junk")
def mark(id: int):
    from . import rules

    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        queued_before = db.execute("SELECT count(*) FROM provider_jobs").fetchone()[0]
        message = db.execute("SELECT * FROM messages WHERE id=?", (id,)).fetchone()
        if not message:
            raise HTTPException(404, "Message no longer exists")
        if not incoming(db, message):
            raise HTTPException(422, "Not Junk applies to incoming mail, not drafts or sent copies")
        key = message["sender_key"]
        if not key or "@" not in key or len(key) > 254 or any(ord(c) < 32 for c in key):
            raise HTTPException(422, "This message has no usable sender address")
        db.execute(
            "INSERT INTO not_junk_senders(sender_key,created_at) VALUES (?,?) ON CONFLICT(sender_key) DO NOTHING",
            (key, datetime.now(timezone.utc).isoformat()),
        )
        configured = rules.configured_rules(db)
        ids = [
            row["id"] for row in db.execute("SELECT id FROM messages WHERE sender_key=?", (key,))
        ]
        count = 0
        for message_id in ids:
            item = db.execute("SELECT * FROM messages WHERE id=?", (message_id,)).fetchone()
            if incoming(db, item):
                file_copy(db, item, configured, explicit=True)
                count += 1
        queued = db.execute("SELECT count(*) FROM provider_jobs").fetchone()[0] - queued_before
    return provider_sync.mail_result({"sender": key, "updated_messages": count}, queued)


@router.get("/not-junk-senders")
def senders():
    with store.db() as db:
        return [dict(r) for r in db.execute("SELECT * FROM not_junk_senders ORDER BY sender_key")]


@router.delete("/not-junk-senders")
def forget(sender: str):
    from .message_keys import sender_key

    with store.db() as db:
        db.execute("DELETE FROM not_junk_senders WHERE sender_key=?", (sender_key(sender),))
    return {"ok": True}
