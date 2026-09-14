"""Atomic local filing and Trash restore. Never calls a mail provider."""

from typing import Annotated
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from . import store

router = APIRouter(prefix="/api/messages")


class Selection(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=500)


class Trash(Selection):
    ids: list[Annotated[int, Field(strict=True, gt=0, lt=2**63)]] = Field(
        min_length=1, max_length=500
    )
    permanent: bool = Field(default=False, strict=True)


class Move(Selection):
    folder: str = Field(pattern=r"^(inbox|archive|trash|local-[1-9][0-9]*|remote:[1-9][0-9]*)$")


def destination(db, folder):
    remote = None
    if folder.startswith("remote:"):
        remote = int(folder[7:])
        row = db.execute("SELECT well_known FROM remote_folders WHERE id=?", (remote,)).fetchone()
        if not row:
            raise HTTPException(422, "Destination folder no longer exists")
        folder = "inbox" if row["well_known"] == "inbox" else "remote"
    elif (
        folder.startswith("local-")
        and not db.execute("SELECT 1 FROM local_folders WHERE id=?", (int(folder[6:]),)).fetchone()
    ):
        raise HTTPException(422, "Destination folder no longer exists")
    return folder, remote


def file_message(db, message, folder, remote=None):
    if folder == "trash" and message["folder"] != "trash":
        db.execute(
            "UPDATE messages SET restore_folder=?,restore_destination_id=? WHERE id=?",
            (message["folder"], message["local_destination_id"], message["id"]),
        )
    db.execute(
        "UPDATE messages SET folder=?,local_destination_id=?,local_folder_override=1 WHERE id=?",
        (folder, remote, message["id"]),
    )


def selected(db, ids):
    rows = []
    for id in dict.fromkeys(ids):
        row = db.execute(
            "SELECT id,folder,restore_folder,restore_destination_id,local_destination_id,remote_folder_id FROM messages WHERE id=?",
            (id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "A selected message no longer exists; nothing moved")
        rows.append(row)
    return rows


@router.post("/move")
def move(data: Move):
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        folder, remote = destination(db, data.folder)
        rows = selected(db, data.ids)
        if folder != "trash" and any(m["folder"] == "drafts" for m in rows):
            raise HTTPException(422, "Drafts can only be moved to Trash")
        for row in rows:
            file_message(db, row, folder, remote)
    return {"moved": len(rows)}


@router.post("/trash-selection")
def trash_selection(data: Trash):
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        if any(identifier <= 0 or identifier >= 2**63 for identifier in data.ids):
            raise HTTPException(422, "Invalid message selection")
        rows = selected(db, data.ids)
        if data.permanent:
            if any(row["folder"] != "trash" for row in rows):
                raise HTTPException(
                    409,
                    "Messages changed location; select only local Trash messages to permanently delete",
                )
            for row in rows:
                db.execute("DELETE FROM messages WHERE id=?", (row["id"],))
        else:
            for row in rows:
                if row["folder"] != "trash":
                    file_message(db, row, "trash")
    return {"deleted" if data.permanent else "trashed": len(rows)}


@router.post("/restore")
def restore(data: Selection):
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        rows = selected(db, data.ids)
        if any(m["folder"] != "trash" for m in rows):
            raise HTTPException(422, "Select only messages in Trash")
        for row in rows:
            folder, remote = row["restore_folder"], row["restore_destination_id"]
            if (
                remote
                and not db.execute("SELECT 1 FROM remote_folders WHERE id=?", (remote,)).fetchone()
            ):
                folder, remote = "inbox", None
            if (
                folder.startswith("local-")
                and not db.execute(
                    "SELECT 1 FROM local_folders WHERE id=?", (int(folder[6:]),)
                ).fetchone()
            ):
                folder = "inbox"
            if folder == "remote" and remote is None:
                remote = row["remote_folder_id"]
                if (
                    not remote
                    or not db.execute(
                        "SELECT 1 FROM remote_folders WHERE id=?", (remote,)
                    ).fetchone()
                ):
                    folder, remote = "inbox", None
            file_message(db, row, folder, remote)
    return {"restored": len(rows)}
