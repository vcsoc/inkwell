"""Multi-condition, multi-action rules for local imported copies only."""

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from . import store, message_moves, tag_store, folder_tree
from .message_keys import sender_key, domain_key

router = APIRouter(prefix="/api")
router.include_router(folder_tree.router)


class Folder(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    parent: str = Field(default="", max_length=80)

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
        result = [
            dict(r) for r in db.execute("SELECT * FROM local_folders ORDER BY position,name,id")
        ]
        labels = {key: key.title() for key in ("inbox", "archive", "sent", "drafts", "trash")}
        labels.update(
            {
                "remote:" + str(r["id"]): r["path"]
                for r in db.execute("SELECT id,path FROM remote_folders")
            }
        )
        by_key = {"local-" + str(r["id"]): r for r in result}
        for row in result:
            parts = [row["name"]]
            parent = row["parent"]
            seen = set()
            while parent in by_key and parent not in seen:
                seen.add(parent)
                ancestor = by_key[parent]
                parts.insert(0, ancestor["name"])
                parent = ancestor["parent"]
            if parent in labels:
                parts.insert(0, labels[parent])
            row["path"] = " / ".join(parts)
        return result


@router.post("/local-folders")
def add_folder(data: Folder):
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        parent = data.parent
        folder_tree.parent_depth(db, parent)
        if db.execute(
            "SELECT 1 FROM local_folders WHERE name=? COLLATE NOCASE AND parent=?",
            (data.name, parent),
        ).fetchone():
            raise HTTPException(409, "A folder in this location already has that name")
        return {
            "id": db.execute(
                "INSERT INTO local_folders(name,parent,position) VALUES (?,?,(SELECT COALESCE(MAX(position),-1)+1 FROM local_folders))",
                (data.name, parent),
            ).lastrowid
        }


@router.delete("/local-folders/{id}")
def delete_folder(id: int):
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        key = "local-" + str(id)
        referenced = any(
            any(a.type == "move" and a.value == key for a in r.actions)
            for r in configured_rules(db)
        )
        if db.execute("SELECT 1 FROM local_folders WHERE parent=?", (key,)).fetchone():
            raise HTTPException(409, "Folder has subfolders; nothing was deleted")
        if db.execute("SELECT 1 FROM messages WHERE folder=?", (key,)).fetchone() or referenced:
            raise HTTPException(
                409, "Folder is not empty or is used by a rule; nothing was deleted"
            )
        db.execute("DELETE FROM local_folders WHERE id=?", (id,))
    return {"ok": True}


class Condition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field: Literal[
        "sender",
        "domain",
        "tld",
        "subject",
        "recipient",
        "body",
        "tag",
        "unread",
        "starred",
        "age_days",
    ]
    operator: Literal[
        "is", "not_is", "contains", "not_contains", "starts_with", "ends_with", "gt", "lt"
    ] = "contains"
    value: str = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def valid(self):
        self.value = self.value.strip()
        if not self.value or any(ord(c) < 32 for c in self.value):
            raise ValueError("Condition needs a value without control characters")
        allowed = {
            "tld": {"is", "not_is"},
            "tag": {"is", "not_is"},
            "unread": {"is", "not_is"},
            "starred": {"is", "not_is"},
            "age_days": {"gt", "lt"},
        }.get(self.field, {"is", "not_is", "contains", "not_contains", "starts_with", "ends_with"})
        if self.operator not in allowed:
            raise ValueError("Operator is not supported for this condition")
        if self.field in {"sender", "domain"} and self.operator in {"is", "not_is"}:
            self.value = (
                sender_key(self.value)
                if self.field == "sender"
                else domain_key("rule@" + self.value.lstrip("@"))
            )
            if not self.value:
                raise ValueError("Enter an exact sender address or domain")
        if self.field == "tld":
            try:
                self.value = self.value.lstrip(".").encode("idna").decode("ascii").lower()
            except UnicodeError:
                raise ValueError("Enter a single TLD such as .com or .ca")
            if not re.fullmatch(r"[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?", self.value):
                raise ValueError("Enter a single TLD such as .com or .ca, not co.uk")
        if self.field in {"unread", "starred"} and self.value not in {"true", "false"}:
            raise ValueError("Choose true or false")
        if self.field == "age_days" and (
            not self.value.isdecimal() or not 0 <= int(self.value) <= 36500
        ):
            raise ValueError("Age must be 0–36500 days")
        if self.field == "tag" and (not self.value.isdecimal() or int(self.value) < 1):
            raise ValueError("Choose a tag")
        return self


class Action(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["move", "mark_read", "mark_unread", "star", "unstar", "add_tag", "remove_tag"]
    value: str = Field(default="", max_length=100)


class Rule(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=100)
    enabled: bool = True
    stop_processing: bool = True
    mode: Literal["all", "any"] = "all"
    conditions: list[Condition] = Field(default_factory=list, max_length=20)
    actions: list[Action] = Field(default_factory=list, max_length=20)
    # Legacy input remains accepted; GET exposes both legacy values and the builder.
    match: Literal["sender", "domain"] = "sender"
    value: str = Field(default="", max_length=254)
    folder: str = Field(default="archive", pattern=r"^(inbox|archive|trash|local-[1-9][0-9]*)$")
    exclude_unread: bool = False
    older_than_days: int = Field(default=0, ge=0, le=36500)

    @model_validator(mode="after")
    def valid(self):
        self.name = self.name.strip()
        if not self.name or any(ord(c) < 32 for c in self.name):
            raise ValueError("Rule needs a name without control characters")
        if any(ord(c) < 32 for c in self.value):
            raise ValueError("Invalid address/domain")
        if not self.conditions:
            key = (
                sender_key(self.value)
                if self.match == "sender"
                else domain_key("rule@" + self.value.strip().lstrip("@"))
            )
            if not key or (self.match == "sender" and "@" not in key):
                raise ValueError("Enter a sender address or exact domain, or add conditions")
            self.value = key
            self.conditions = [Condition(field=self.match, operator="is", value=key)]
            if not self.actions:
                self.actions = [Action(type="move", value=self.folder)]
        if not self.actions:
            raise ValueError("Add at least one action")
        if sum(a.type == "move" for a in self.actions) > 1:
            raise ValueError("Use at most one move action per rule")
        return self


def validate_rule(data, db, resources=True):
    for condition in data.conditions:
        if condition.field == "tag":
            condition.value = str(int(condition.value))
            if resources:
                tag_store.selected(db, [int(condition.value)])
    for action in data.actions:
        if action.type == "move":
            import re

            if not re.fullmatch(
                r"(inbox|archive|trash|local-[1-9][0-9]*|remote:[1-9][0-9]*)", action.value
            ):
                raise HTTPException(422, "Choose a destination folder")
            if resources:
                message_moves.destination(db, action.value)
        elif action.type in {"add_tag", "remove_tag"}:
            if not action.value.isdecimal() or int(action.value) < 1:
                raise HTTPException(422, "Choose an existing tag")
            action.value = str(int(action.value))
            if resources:
                tag_store.selected(db, [int(action.value)])
        elif action.value:
            raise HTTPException(422, "This action does not take a value")


@router.get("/rules")
def list_rules():
    with store.db() as db:
        result = []
        for row in db.execute("SELECT * FROM mail_rules ORDER BY position,id"):
            rule = Rule.model_validate_json(row["config"])
            problem = ""
            try:
                validate_rule(rule, db)
            except HTTPException as error:
                problem = str(error.detail)
            result.append({"id": row["id"], **rule.model_dump(), "problem": problem})
        return result


@router.post("/rules")
def create(data: Rule):
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        validate_rule(data, db, resources=data.enabled)
        if db.execute("SELECT count(*) FROM mail_rules").fetchone()[0] >= 100:
            raise HTTPException(422, "Maximum 100 import rules")
        return {
            "id": db.execute(
                "INSERT INTO mail_rules(config,position) VALUES (?,(SELECT COALESCE(MAX(position),-1)+1 FROM mail_rules))",
                (data.model_dump_json(),),
            ).lastrowid
        }


@router.put("/rules/{id}")
def update(id: int, data: Rule):
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        validate_rule(data, db, resources=data.enabled)
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
        for row in db.execute("SELECT config FROM mail_rules ORDER BY position,id")
    ]


class ReorderRules(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: int = Field(gt=0, lt=2**63, strict=True)
    target_id: int = Field(gt=0, lt=2**63, strict=True)
    placement: Literal["before", "after"] = "before"


@router.post("/rules/reorder")
def reorder_rules(data: ReorderRules):
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        ids = [r["id"] for r in db.execute("SELECT id FROM mail_rules ORDER BY position,id")]
        if data.id not in ids or data.target_id not in ids:
            raise HTTPException(404, "Rule no longer exists; refresh the rule list")
        if data.id != data.target_id:
            ids.remove(data.id)
            index = ids.index(data.target_id) + (data.placement == "after")
            ids.insert(index, data.id)
            for position, id in enumerate(ids):
                db.execute("UPDATE mail_rules SET position=? WHERE id=?", (position, id))
    return {"ids": ids}


class RunRules(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rule_id: int | None = Field(default=None, gt=0, lt=2**63, strict=True)
    scope: Literal["message", "folder", "all"] = "all"
    message_id: int | None = Field(default=None, gt=0, lt=2**63, strict=True)
    folder: str = Field(default="inbox", max_length=80)


@router.post("/rules/run")
def run_rules(data: RunRules):
    from . import not_junk

    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        if data.rule_id is not None:
            row = db.execute("SELECT config FROM mail_rules WHERE id=?", (data.rule_id,)).fetchone()
            if not row:
                raise HTTPException(404, "Rule not found")
            configured = [Rule.model_validate_json(row["config"])]
            if not configured[0].enabled:
                raise HTTPException(422, "Enable this rule before running it")
            validate_rule(configured[0], db)
        else:
            configured = configured_rules(db)
        if data.scope == "message":
            if data.message_id is None:
                raise HTTPException(422, "Choose a current message")
            candidates = list(db.execute("SELECT id FROM messages WHERE id=?", (data.message_id,)))
            if not candidates:
                raise HTTPException(404, "Message not found")
        elif data.scope == "folder":
            if (
                re.fullmatch(r"(local-|remote:)[0-9]+", data.folder)
                and int(re.split("[-:]", data.folder)[1]) >= 2**63
            ):
                raise HTTPException(422, "Invalid folder identifier")
            if data.folder in ("inbox", "archive", "trash", "sent", "drafts"):
                candidates = list(
                    db.execute("SELECT id FROM messages WHERE folder=?", (data.folder,))
                )
            elif re.fullmatch(r"local-[1-9][0-9]*", data.folder):
                message_moves.destination(db, data.folder)
                candidates = list(
                    db.execute("SELECT id FROM messages WHERE folder=?", (data.folder,))
                )
            elif re.fullmatch(r"remote:[1-9][0-9]*", data.folder):
                _, remote = message_moves.destination(db, data.folder)
                candidates = list(
                    db.execute(
                        "SELECT id FROM messages WHERE folder IN ('inbox','remote') AND CASE WHEN local_folder_override=1 THEN local_destination_id ELSE remote_folder_id END=?",
                        (remote,),
                    )
                )
            else:
                raise HTTPException(422, "Choose a cached folder")
        else:
            candidates = list(db.execute("SELECT id FROM messages ORDER BY id"))
        eligible = matched = 0
        now = datetime.now(timezone.utc)
        for candidate in candidates:
            m = db.execute("SELECT * FROM messages WHERE id=?", (candidate["id"],)).fetchone()
            if not not_junk.incoming(db, m):
                continue
            eligible += 1
            matched += apply(
                db, m["id"], now, configured, force=True, safe_sender=not_junk.remembered(db, m)
            )
    return {
        "matched": matched,
        "scanned": len(candidates),
        "eligible": eligible,
        "skipped": len(candidates) - eligible,
    }


def sender_tld(domain):
    label = domain.rsplit(".", 1)[-1]
    return (
        label if "." in domain and re.fullmatch(r"[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?", label) else ""
    )


@router.get("/rules/from-message/{id}")
def from_message(id: int):
    from . import not_junk

    with store.db() as db:
        m = db.execute("SELECT * FROM messages WHERE id=?", (id,)).fetchone()
        if not m:
            raise HTTPException(404, "Message not found")
        sender = sender_key(m["sender"])
        domain = domain_key(m["sender"])
        values = {
            "sender": sender,
            "domain": domain,
            "subject": m["subject"][:500],
            "tld": sender_tld(domain),
        }
        field = "sender" if sender else "subject"
        return {
            "message_id": id,
            "subject": m["subject"],
            "can_apply": not_junk.incoming(db, m),
            "values": values,
            "rule": {
                "name": ("Rule for " + (sender or m["subject"]))[:100],
                "conditions": [
                    {
                        "field": field,
                        "operator": "is" if sender else "contains",
                        "value": values[field],
                    }
                ],
                "actions": [{"type": "add_tag", "value": ""}],
            },
        }


class ApplyMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message_id: int = Field(gt=0)


@router.post("/rules/{id}/apply-message")
def apply_message(id: int, data: ApplyMessage):
    from . import not_junk

    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT config FROM mail_rules WHERE id=?", (id,)).fetchone()
        if not row:
            raise HTTPException(404, "Rule not found")
        rule = Rule.model_validate_json(row["config"])
        validate_rule(rule, db)
        m = db.execute("SELECT * FROM messages WHERE id=?", (data.message_id,)).fetchone()
        if not m:
            raise HTTPException(404, "Message not found")
        if not not_junk.incoming(db, m):
            raise HTTPException(422, "Rules cannot be applied to drafts or sent copies")
        return {
            "applied": apply(
                db, m["id"], configured=[rule], force=True, safe_sender=not_junk.remembered(db, m)
            )
        }


def matches(condition, m, now, db, cache):
    field, op, value = condition.field, condition.operator, condition.value
    if field == "age_days":
        try:
            date = datetime.fromisoformat(m["date"])
            if not date.tzinfo:
                return False
        except ValueError:
            return False
        age = (now - date).total_seconds() / 86400
        return age > int(value) if op == "gt" else age < int(value)
    if field in {"unread", "starred"}:
        equal = bool(m[field]) == (value == "true")
        return equal if op == "is" else not equal
    if field == "tag":
        tag = tag_store.selected(db, [int(value)])[0]
        equal = any(t.casefold() == tag["key"] for t in json.loads(m["tags"]))
        return equal if op == "is" else not equal
    if field == "tld":
        text = sender_tld(m["domain_key"])
        return bool(text) and (text == value if op == "is" else text != value)
    column = {"sender": "sender_key", "domain": "domain_key"}.get(field, field)
    if column not in cache:
        cache[column] = m[column].casefold()
    text, value = cache[column], value.casefold()
    return {
        "is": lambda: text == value,
        "not_is": lambda: text != value,
        "contains": lambda: value in text,
        "not_contains": lambda: value not in text,
        "starts_with": lambda: text.startswith(value),
        "ends_with": lambda: text.endswith(value),
    }[op]()


def apply(db, message_id, now=None, configured=None, force=False, safe_sender=False):
    from . import not_junk

    m = db.execute("SELECT * FROM messages WHERE id=?", (message_id,)).fetchone()
    if not m or not not_junk.incoming(db, m):
        return False
    if not force and not_junk.remembered(db, m):
        if not not_junk.incoming(db, m):
            return False
        return not_junk.file_copy(db, m, configured)
    configured = configured if configured is not None else configured_rules(db)
    if not configured:
        return False
    if not force and (m["local_folder_override"] or m["folder"] in ("drafts", "sent", "trash")):
        return False
    now = now or datetime.now(timezone.utc)
    cache = {}
    applied = False
    for rule in configured:
        if not rule.enabled or (rule.exclude_unread and m["unread"]):
            continue
        if rule.older_than_days:
            try:
                date = datetime.fromisoformat(m["date"])
                if not date.tzinfo or date >= now - timedelta(days=rule.older_than_days):
                    continue
            except ValueError:
                continue
        try:
            validate_rule(rule, db)
            if safe_sender and any(
                a.type == "move" and not_junk.blocked_destination(db, a.value) for a in rule.actions
            ):
                continue
            results = (matches(c, m, now, db, cache) for c in rule.conditions)
            if not (all(results) if rule.mode == "all" else any(results)):
                continue
            # Plan all actions first: missing resources or tag overflow cannot cause partial filing.
            tags = json.loads(m["tags"])
            unread = m["unread"]
            starred = m["starred"]
            destination = None
            for action in rule.actions:
                if action.type == "move":
                    destination = message_moves.destination(db, action.value)
                elif action.type == "mark_read":
                    unread = 0
                elif action.type == "mark_unread":
                    unread = 1
                elif action.type == "star":
                    starred = 1
                elif action.type == "unstar":
                    starred = 0
                else:
                    tag = tag_store.selected(db, [int(action.value)])[0]
                    if action.type == "remove_tag":
                        tags = [t for t in tags if t.casefold() != tag["key"]]
                    elif not any(t.casefold() == tag["key"] for t in tags):
                        tags.append(tag["name"])
            if len(tags) > 12:
                continue
        except HTTPException:
            continue
        if destination:
            message_moves.file_message(db, m, *destination)
        db.execute(
            "UPDATE messages SET tags=?,unread=?,starred=?,local_destination_id=CASE WHEN local_folder_override=0 THEN remote_folder_id ELSE local_destination_id END,local_folder_override=1 WHERE id=?",
            (json.dumps(tags), unread, starred, message_id),
        )
        applied = True
        if rule.stop_processing:
            break
        m = db.execute("SELECT * FROM messages WHERE id=?", (message_id,)).fetchone()
        cache = {}
    return applied


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
    return {"moved": count, "matched": count}
