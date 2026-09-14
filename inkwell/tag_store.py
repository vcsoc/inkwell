"""Local tag catalog and atomic, workspace-wide tag edits. No provider calls."""

import hashlib
import json
import unicodedata

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from . import store

router = APIRouter(prefix="/api/tags")
PALETTE = ["#486b54", "#2664a0", "#894ca6", "#ac4c45", "#9a6500", "#087e8b", "#bd477a", "#526379"]


def name(value):
    value = value.strip()
    if (
        not value
        or len(value) > 32
        or "," in value
        or any(unicodedata.category(c) in {"Cc", "Cs"} for c in value)
    ):
        raise ValueError("Tags must be 1–32 characters, without commas or control characters")
    return value


def names(values):
    result = {}
    for value in values:
        clean = name(value)
        result.setdefault(clean.casefold(), clean)
    if len(result) > 12:
        raise ValueError("A message can have at most 12 tags")
    return list(result.values())


def default_color(value):
    return PALETTE[
        int.from_bytes(hashlib.sha256(value.casefold().encode()).digest()[:4], "big") % len(PALETTE)
    ]


def canonical(db, values):
    result = []
    for value in names(values):
        db.execute(
            "INSERT OR IGNORE INTO tag_catalog(name,key,color) VALUES (?,?,?)",
            (value, value.casefold(), default_color(value)),
        )
        result.append(
            db.execute("SELECT name FROM tag_catalog WHERE key=?", (value.casefold(),)).fetchone()[
                0
            ]
        )
    return result


def migrate(db):
    for row in db.execute("SELECT id,tags FROM messages WHERE tags!='[]'").fetchall():
        values = canonical(db, json.loads(row["tags"]))
        db.execute("UPDATE messages SET tags=? WHERE id=?", (json.dumps(values), row["id"]))


def catalog():
    with store.db() as db:
        return [
            dict(row)
            for row in db.execute("""SELECT t.*,COALESCE(c.used,0) AS count FROM tag_catalog t
        LEFT JOIN (SELECT inkwell_tag_key(value) AS key,count(DISTINCT messages.id) AS used
        FROM messages,json_each(messages.tags) WHERE messages.tags!='[]' GROUP BY inkwell_tag_key(value)) c ON c.key=t.key ORDER BY t.key,t.id""")
        ]


class Tag(BaseModel):
    name: str
    color: str = Field(default="#486b54", pattern=r"^#[0-9a-fA-F]{6}$")
    _name = field_validator("name")(name)


class Selection(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=5000)


class Merge(Selection):
    name: str
    _name = field_validator("name")(name)


def selected(db, ids):
    rows = []
    for id in dict.fromkeys(ids):
        row = db.execute("SELECT * FROM tag_catalog WHERE id=?", (id,)).fetchone()
        if not row:
            raise HTTPException(404, "A selected tag no longer exists; nothing changed")
        rows.append(row)
    return rows


def rewrite(db, keys, replacement=None):
    changed = 0
    for row in db.execute("SELECT id,tags FROM messages WHERE tags!='[]'").fetchall():
        previous = json.loads(row["tags"])
        if not any(tag.casefold() in keys for tag in previous):
            continue
        values = []
        for tag in previous:
            if tag.casefold() in keys:
                if replacement is not None:
                    values.append(replacement)
            else:
                values.append(tag)
        db.execute("UPDATE messages SET tags=? WHERE id=?", (json.dumps(names(values)), row["id"]))
        changed += 1
    return changed


@router.post("")
def create(data: Tag):
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM tag_catalog WHERE key=?", (data.name.casefold(),)).fetchone():
            raise HTTPException(409, "Tag already exists")
        if db.execute("SELECT count(*) FROM tag_catalog").fetchone()[0] >= 5000:
            raise HTTPException(409, "Tag catalog limit reached")
        id = db.execute(
            "INSERT INTO tag_catalog(name,key,color) VALUES (?,?,?)",
            (data.name, data.name.casefold(), data.color.lower()),
        ).lastrowid
    return {"id": id}


@router.put("/{tag_id}")
def update(tag_id: int, data: Tag):
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        row = selected(db, [tag_id])[0]
        collision = db.execute(
            "SELECT id FROM tag_catalog WHERE key=?", (data.name.casefold(),)
        ).fetchone()
        if collision and collision["id"] != tag_id:
            raise HTTPException(
                409, "That tag already exists. Use Replace / merge selected instead."
            )
        changed = rewrite(db, {row["key"]}, data.name) if row["name"] != data.name else 0
        db.execute(
            "UPDATE tag_catalog SET name=?,key=?,color=? WHERE id=?",
            (data.name, data.name.casefold(), data.color.lower(), tag_id),
        )
    return {"updated_messages": changed}


@router.post("/delete")
def delete(data: Selection):
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        chosen = selected(db, data.ids)
        changed = rewrite(db, {row["key"] for row in chosen})
        db.executemany("DELETE FROM tag_catalog WHERE id=?", [(row["id"],) for row in chosen])
    return {"updated_messages": changed}


@router.post("/merge")
def merge(data: Merge):
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        chosen = selected(db, data.ids)
        target = db.execute(
            "SELECT * FROM tag_catalog WHERE key=?", (data.name.casefold(),)
        ).fetchone()
        if not target:
            id = db.execute(
                "INSERT INTO tag_catalog(name,key,color) VALUES (?,?,?)",
                (data.name, data.name.casefold(), chosen[0]["color"]),
            ).lastrowid
            target = db.execute("SELECT * FROM tag_catalog WHERE id=?", (id,)).fetchone()
        changed = rewrite(db, {row["key"] for row in chosen}, target["name"])
        db.executemany(
            "DELETE FROM tag_catalog WHERE id=?",
            [(row["id"],) for row in chosen if row["id"] != target["id"]],
        )
    return {"id": target["id"], "updated_messages": changed}


class Assignment(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=500)
    tag_id: int
    add: bool = True


@router.post("/assign")
def assign(data: Assignment):
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        tag = selected(db, [data.tag_id])[0]
        changed = 0
        for id in dict.fromkeys(data.ids):
            row = db.execute("SELECT tags FROM messages WHERE id=?", (id,)).fetchone()
            if not row:
                raise HTTPException(404, "A selected message no longer exists; nothing changed")
            old = json.loads(row["tags"])
            values = [v for v in old if v.casefold() != tag["key"]]
            if data.add:
                if len(values) != len(old):
                    values = old
                else:
                    values.append(tag["name"])
            if len(values) > 12:
                raise HTTPException(409, "A selected message already has 12 tags; nothing changed")
            if values != old:
                db.execute("UPDATE messages SET tags=? WHERE id=?", (json.dumps(values), id))
                changed += 1
    return {"updated_messages": changed}
