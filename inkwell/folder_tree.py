"""Transactional hierarchy changes for local folders; no provider operations."""

import re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal
from . import store

router = APIRouter()


def parent_depth(db, parent, exclude=None):
    depth = 0
    seen = set()
    while re.fullmatch(r"local-[1-9][0-9]*", parent):
        identifier = int(parent[6:])
        if identifier >= 2**63:
            raise HTTPException(422, "Invalid parent folder")
        if identifier == exclude or identifier in seen:
            raise HTTPException(422, "A folder cannot be placed inside itself or its descendants")
        seen.add(identifier)
        row = db.execute("SELECT parent FROM local_folders WHERE id=?", (identifier,)).fetchone()
        if not row:
            raise HTTPException(404, "Parent folder no longer exists")
        depth += 1
        if depth >= 32:
            raise HTTPException(422, "Maximum folder nesting reached")
        parent = row["parent"]
        # An existing local branch can outlive its original remote parent.
        if parent.startswith("remote:"):
            return depth
    if parent in ("", "inbox", "archive", "sent", "drafts", "trash"):
        return depth
    if re.fullmatch(r"remote:[1-9][0-9]*", parent) and int(parent[7:]) < 2**63:
        if not db.execute("SELECT 1 FROM remote_folders WHERE id=?", (int(parent[7:]),)).fetchone():
            raise HTTPException(404, "Parent folder no longer exists")
        return depth
    raise HTTPException(422, "Invalid parent folder")


class MoveFolder(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: int = Field(gt=0, lt=2**63)
    target: str = Field(default="", max_length=80)
    placement: Literal["inside", "before", "after"] = "inside"


@router.post("/local-folders/move")
def move(data: MoveFolder):
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        source = db.execute("SELECT * FROM local_folders WHERE id=?", (data.id,)).fetchone()
        if not source:
            raise HTTPException(404, "Folder no longer exists")
        entries = list(db.execute("SELECT * FROM local_folders ORDER BY position,name,id"))
        available = (
            {"", "inbox", "archive", "sent", "drafts", "trash"}
            | {"local-" + str(r["id"]) for r in entries}
            | {"remote:" + str(r["id"]) for r in db.execute("SELECT id FROM remote_folders")}
        )

        def effective(parent):
            return parent if parent in available else ""

        anchor = None
        if data.placement != "inside":
            if not re.fullmatch(r"local-[1-9][0-9]*", data.target) or int(data.target[6:]) >= 2**63:
                raise HTTPException(422, "Only local folders can be reordered")
            anchor = db.execute(
                "SELECT * FROM local_folders WHERE id=?", (int(data.target[6:]),)
            ).fetchone()
            if not anchor:
                raise HTTPException(404, "Target folder no longer exists")
            if anchor["id"] == data.id:
                return {"ok": True}
            parent = effective(anchor["parent"])
        else:
            parent = data.target
        depth = parent_depth(db, parent, data.id)
        subtree = db.execute(
            """WITH RECURSIVE children(id,depth) AS (
            SELECT ?,1 UNION ALL SELECT f.id,c.depth+1 FROM local_folders f JOIN children c
            ON f.parent='local-'||c.id WHERE c.depth<33
        ) SELECT max(depth) FROM children""",
            (data.id,),
        ).fetchone()[0]
        if depth + subtree > 32:
            raise HTTPException(422, "Maximum folder nesting reached")
        old_parent = effective(source["parent"])
        if old_parent != parent and any(
            effective(r["parent"]) == parent
            for r in db.execute(
                "SELECT parent FROM local_folders WHERE name=? COLLATE NOCASE AND id!=?",
                (source["name"], data.id),
            )
        ):
            raise HTTPException(409, "A folder in this location already has that name")
        siblings = [
            r["id"] for r in entries if effective(r["parent"]) == parent and r["id"] != data.id
        ]
        index = (
            len(siblings)
            if anchor is None
            else siblings.index(anchor["id"]) + (data.placement == "after")
        )
        siblings.insert(index, data.id)
        db.execute("UPDATE local_folders SET parent=? WHERE id=?", (parent, data.id))
        for index, identifier in enumerate(siblings):
            db.execute("UPDATE local_folders SET position=? WHERE id=?", (index, identifier))
        if old_parent != parent:
            old = [
                r["id"]
                for r in entries
                if effective(r["parent"]) == old_parent and r["id"] != data.id
            ]
            for index, identifier in enumerate(old):
                db.execute("UPDATE local_folders SET position=? WHERE id=?", (index, identifier))
    return {"ok": True}
