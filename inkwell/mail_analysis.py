"""Local, review-only mail classification. The model cannot mutate the mailbox."""

import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import threading
import time
import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from . import store, tag_store, provider_sync

router = APIRouter(prefix="/api/mail-analysis")
KEY = "mail_analysis"
DEFAULT_TAGS = [
    ("Invoice", "Does this email request payment of an invoice or an outstanding bill?"),
    ("Receipt", "Does this email confirm a payment already received or a completed purchase?"),
    ("Action required", "Does this email ask the recipient to complete a specific task or reply?"),
    (
        "Meeting",
        "Is this email about a meeting invitation, scheduling, an agenda, or meeting follow-up?",
    ),
    ("Delivery", "Is this email about shipment, parcel tracking, a courier, or delivery status?"),
    ("Newsletter", "Is this a subscription newsletter, editorial digest, or mass marketing email?"),
    (
        "Project",
        "Does this email discuss progress, deliverables, coordination, or issues on a work project?",
    ),
    (
        "Customer",
        "Is this from an established customer discussing their existing account or requesting support?",
    ),
    (
        "Cold lead",
        "Is this unsolicited sales outreach to someone who has not expressed buying interest?",
    ),
    (
        "Hot lead",
        "Does this sender express genuine interest in buying, request a quote, or ask for a product demo?",
    ),
]

ELIGIBLE = "demo=0 AND folder NOT IN ('drafts','sent','trash')"


class Category(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    description: str = Field(min_length=10, max_length=1000)
    threshold: float = Field(default=0.8, ge=0.5, le=1, allow_inf_nan=False)
    enabled: bool = True
    _name = field_validator("name")(tag_store.name)


class Config(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = False
    model: Literal["english", "multilingual"] = "english"
    categories: list[Category] = Field(
        default_factory=lambda: [Category(name=n, description=d) for n, d in DEFAULT_TAGS],
        min_length=0,
        max_length=50,
    )

    @model_validator(mode="after")
    def active_category(self):
        if self.enabled and not any(c.enabled for c in self.categories):
            raise ValueError("Enable at least one analysis category")
        return self

    @field_validator("categories")
    @classmethod
    def distinct(cls, values):
        if len({c.name.casefold() for c in values}) != len(values):
            raise ValueError("Analysis tag names must be unique")
        return values


def migrate(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS mail_analysis_jobs(
        message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
        state TEXT NOT NULL DEFAULT 'pending', origin TEXT NOT NULL DEFAULT 'incoming', claim TEXT NOT NULL DEFAULT '',
        fingerprint TEXT NOT NULL DEFAULT '', catalog TEXT NOT NULL DEFAULT '',
        scores TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '',
        updated REAL NOT NULL DEFAULT 0, provider_job_id INTEGER,
        outcome TEXT NOT NULL DEFAULT '', truncated INTEGER NOT NULL DEFAULT 0)""")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS mail_analysis_state ON mail_analysis_jobs(state,message_id)"
    )
    enabled = "COALESCE((SELECT json_extract(value,'$.enabled') FROM settings WHERE key='mail_analysis'),0)=1"
    eligible = "NEW.demo=0 AND NEW.folder NOT IN ('drafts','sent','trash')"
    conn.execute(f"""CREATE TRIGGER IF NOT EXISTS mail_analysis_insert AFTER INSERT ON messages
        WHEN {enabled} AND {eligible} BEGIN
        INSERT OR IGNORE INTO mail_analysis_jobs(message_id) VALUES(NEW.id); END""")
    conn.execute(f"""CREATE TRIGGER IF NOT EXISTS mail_analysis_content AFTER UPDATE OF body,subject,sender ON messages
        WHEN {enabled} AND {eligible} AND (OLD.body!=NEW.body OR OLD.subject!=NEW.subject OR OLD.sender!=NEW.sender) BEGIN
        INSERT INTO mail_analysis_jobs(message_id) VALUES(NEW.id) ON CONFLICT(message_id)
        DO UPDATE SET state='pending',origin='incoming',claim='',scores='{{}}',error='',updated=0; END""")


def config(conn=None):
    if conn is None:
        return Config.model_validate_json(store.setting(KEY, Config().model_dump_json()))
    row = conn.execute("SELECT value FROM settings WHERE key=?", (KEY,)).fetchone()
    return Config.model_validate_json(row[0]) if row else Config()


def catalog_key(cfg):
    return hashlib.sha256(
        json.dumps(
            {"model": cfg.model, "categories": [c.model_dump() for c in cfg.categories]},
            sort_keys=True,
        ).encode()
    ).hexdigest()


def fingerprint(message):
    return hashlib.sha256(
        json.dumps(
            [message[k] for k in ("account_id", "remote_key", "sender", "subject", "body")],
            ensure_ascii=True,
        ).encode()
    ).hexdigest()


def cleaned(message):
    lines = message["body"].replace("\r", "").split("\n")
    kept = []
    for line in lines:
        if re.match(r"^On .{1,300}wrote:\s*$", line) and any(s.strip() for s in kept):
            break
        if not line.lstrip().startswith(">"):
            kept.append(line)
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()
    truncated = len(text) > 24000
    if truncated:
        text = text[:18000] + "\n[Middle omitted]\n" + text[-6000:]
    return "Subject: " + message["subject"][:1000] + "\nSender: " + message["sender"][
        :500
    ] + "\nMessage:\n" + text, truncated


def runtime_python():
    base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
    return base / "inkwell/laya-runtime/bin/python"


@router.get("")
def status():
    with store.db() as conn:
        counts = {
            r["state"]: r["n"]
            for r in conn.execute("SELECT state,count(*) n FROM mail_analysis_jobs GROUP BY state")
        }
        backfill_pending = conn.execute(
            "SELECT count(*) FROM mail_analysis_jobs WHERE origin='backfill' AND state IN ('pending','running')"
        ).fetchone()[0]
        cfg = config(conn)
        row = conn.execute(
            "SELECT value FROM settings WHERE key='mail_analysis_backfill'"
        ).fetchone()
        scan = json.loads(row[0]) if row else {}
        progress = {
            "total": 0,
            "completed": 0,
            "remaining": 0,
            "queued": 0,
            "running": 0,
            "failed": 0,
            "unqueued": 0,
            "percent": 0,
        }
        if "through" in scan:
            grouped = {
                r["state"] or "unqueued": r["n"]
                for r in conn.execute(
                    f"SELECT j.state,count(*) n FROM messages m LEFT JOIN mail_analysis_jobs j ON j.message_id=m.id WHERE m.id<=? AND {ELIGIBLE} GROUP BY j.state",
                    (scan["through"],),
                )
            }
            progress["total"] = sum(grouped.values())
            progress["completed"] = sum(
                grouped.get(key, 0) for key in ("review", "applied", "rejected", "no_match")
            )
            progress["remaining"] = progress["total"] - progress["completed"]
            for key, state in (
                ("queued", "pending"),
                ("running", "running"),
                ("failed", "failed"),
                ("unqueued", "unqueued"),
            ):
                progress[key] = grouped.get(state, 0)
            progress["percent"] = (
                round(100 * progress["completed"] / progress["total"], 1)
                if progress["total"]
                else 100
            )
        used = {
            r["key"]: r["n"]
            for r in conn.execute(
                "SELECT inkwell_tag_key(value) key,count(DISTINCT messages.id) n FROM messages,json_each(messages.tags) WHERE messages.tags!='[]' GROUP BY inkwell_tag_key(value)"
            )
        }
        usage = [{"name": c.name, "count": used.get(c.name.casefold(), 0)} for c in cfg.categories]

    return {
        "backfill_pending": backfill_pending,
        "progress": progress,
        "tag_usage": usage,
        "config": config().model_dump(),
        "mode": "review",
        "runtime_ready": runtime_python().is_file(),
        "runtime_path": str(runtime_python()),
        "counts": counts,
        "backfill": json.loads(store.setting("mail_analysis_backfill", "{}")),
        "worker_active": WORKER.active,
        "last_error": store.setting("mail_analysis_error"),
        "model_policy": "Local CPU, one model at a time, bounded batch; process exits after every batch.",
    }


@router.put("")
def configure(data: Config):
    with store.db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        old = config(conn)
        if catalog_key(old) != catalog_key(data):
            conn.execute(
                "UPDATE mail_analysis_jobs SET state='pending',claim='',error='',scores='{}' WHERE state IN ('review','no_match','running','failed')"
            )
        if data.enabled:
            for category in data.categories:
                tag_store.canonical(conn, [category.name])
        conn.execute("INSERT OR REPLACE INTO settings VALUES (?,?)", (KEY, data.model_dump_json()))
    if not data.enabled:
        WORKER.stop()
        WORKER.start()
    WORKER.wake.set()
    return status()


class Backfill(BaseModel):
    action: str = Field(pattern="^(start|pause|resume)$")


@router.post("/backfill")
def backfill(data: Backfill):
    with store.db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if data.action != "pause" and not config(conn).enabled:
            raise HTTPException(409, "Enable mail analysis before starting or resuming a backfill")
        row = conn.execute(
            "SELECT value FROM settings WHERE key='mail_analysis_backfill'"
        ).fetchone()
        value = json.loads(row[0]) if row else {}
        if data.action == "start":
            if (
                value.get("active")
                or conn.execute(
                    "SELECT 1 FROM mail_analysis_jobs WHERE origin='backfill' AND state IN ('pending','running') LIMIT 1"
                ).fetchone()
            ):
                raise HTTPException(409, "A backfill is already active or paused; resume it first")
            value = {
                "active": True,
                "paused": False,
                "cursor": 0,
                "started": time.time(),
                "through": conn.execute("SELECT COALESCE(max(id),0) FROM messages").fetchone()[0],
            }
        elif data.action == "resume":
            if "through" not in value:
                raise HTTPException(409, "Start a backfill first")
            value["active"] = value["cursor"] < value["through"]
            value["paused"] = False
        else:
            value["active"] = False
            value["paused"] = True
        conn.execute(
            "INSERT OR REPLACE INTO settings VALUES ('mail_analysis_backfill',?)",
            (json.dumps(value),),
        )
    WORKER.wake.set()
    return value


def fill_page(conn):
    row = conn.execute("SELECT value FROM settings WHERE key='mail_analysis_backfill'").fetchone()
    value = json.loads(row[0]) if row else {}
    if not value.get("active"):
        return
    rows = conn.execute(
        f"SELECT id FROM messages WHERE id>? AND id<=? AND {ELIGIBLE} ORDER BY id LIMIT 50",
        (value["cursor"], value["through"]),
    ).fetchall()
    for row in rows:
        conn.execute(
            "INSERT OR IGNORE INTO mail_analysis_jobs(message_id,origin) VALUES (?,'backfill')",
            (row[0],),
        )
    value["cursor"] = rows[-1][0] if rows else value["through"]
    if value["cursor"] >= value["through"]:
        value["active"] = False
    conn.execute(
        "INSERT OR REPLACE INTO settings VALUES ('mail_analysis_backfill',?)", (json.dumps(value),)
    )


@router.get("/results")
def results(state: str = "review", before: int = 0):
    if state not in {"review", "failed", "applied", "rejected", "no_match"}:
        raise HTTPException(422, "Choose a valid analysis state")
    with store.db() as conn:
        rows = conn.execute(
            """SELECT j.*,m.subject,m.sender,m.date,m.tags,
            p.state AS sync_state,p.error AS sync_error FROM mail_analysis_jobs j
            JOIN messages m ON m.id=j.message_id LEFT JOIN provider_jobs p ON p.id=j.provider_job_id
            WHERE j.state=? AND (?=0 OR j.message_id<?) ORDER BY j.message_id DESC LIMIT 50""",
            (state, before, before),
        ).fetchall()
        return [
            {**dict(r), "scores": json.loads(r["scores"]), "tags": json.loads(r["tags"])}
            for r in rows
        ]


class Approval(BaseModel):
    tags: list[str] = Field(min_length=1, max_length=12)
    _tags = field_validator("tags")(tag_store.names)


@router.post("/{message_id}/approve")
def approve(message_id: int, data: Approval):
    try:
        with store.db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            job = conn.execute(
                "SELECT * FROM mail_analysis_jobs WHERE message_id=?", (message_id,)
            ).fetchone()
            message = conn.execute("SELECT * FROM messages WHERE id=?", (message_id,)).fetchone()
            if not job or not message:
                raise HTTPException(404, "Message or analysis no longer exists")
            if job["state"] not in {"review", "no_match"}:
                raise HTTPException(409, "This analysis is no longer awaiting review")
            cfg = config(conn)
            if message["demo"] or message["folder"] in {"drafts", "sent", "trash"}:
                raise HTTPException(409, "This message is no longer eligible for analysis tags")
            if fingerprint(message) != job["fingerprint"] or catalog_key(cfg) != job["catalog"]:
                raise HTTPException(
                    409, "Analysis settings or message changed; reanalyze before applying"
                )
            scores = json.loads(job["scores"])
            allowed = {c.name for c in cfg.categories if c.enabled and c.name in scores}
            if not set(data.tags) <= allowed:
                raise HTTPException(422, "Choose only configured tags scored by this analysis")
            previous = json.loads(message["tags"])
            values = tag_store.canonical(conn, tag_store.names(previous + data.tags))
            queued = provider_sync.enqueue_tags(conn, message, values)
            provider_id = (
                conn.execute("SELECT max(id) FROM provider_jobs").fetchone()[0] if queued else None
            )
            conn.execute("UPDATE messages SET tags=? WHERE id=?", (json.dumps(values), message_id))
            conn.execute(
                "UPDATE mail_analysis_jobs SET state='applied',provider_job_id=?,outcome=?,error='' WHERE message_id=?",
                (
                    provider_id,
                    "Provider change queued"
                    if queued
                    else "Already tagged"
                    if previous == values
                    else "Local message (not provider-backed)",
                    message_id,
                ),
            )
    except (HTTPException, ValueError) as exc:
        detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
        with store.db() as conn:
            conn.execute(
                "UPDATE mail_analysis_jobs SET error=? WHERE message_id=? AND state IN ('review','no_match')",
                (str(detail)[:1000], message_id),
            )
        raise HTTPException(
            exc.status_code if isinstance(exc, HTTPException) else 422, detail
        ) from exc
    return {"applied": True, "provider_queued": queued}


@router.post("/{message_id}/reject")
def reject(message_id: int):
    with store.db() as conn:
        changed = conn.execute(
            "UPDATE mail_analysis_jobs SET state='rejected',error='' WHERE message_id=? AND state IN ('review','no_match')",
            (message_id,),
        ).rowcount
    if not changed:
        raise HTTPException(409, "This analysis is no longer awaiting review")
    return {"rejected": True}


@router.post("/retry")
def retry():
    with store.db() as conn:
        conn.execute(
            "UPDATE mail_analysis_jobs SET state='pending',error='',claim='' WHERE state='failed'"
        )
        conn.execute("DELETE FROM settings WHERE key='mail_analysis_error'")
    WORKER.wake.set()
    return {"queued": True}


def predict_batch(messages, cfg, cancel):
    python = runtime_python()
    if not python.is_file():
        raise RuntimeError(
            "Local Laya runtime is not installed. See Settings > Mail analysis for setup instructions."
        )
    payload = {
        "model": cfg.model,
        "categories": [c.model_dump() for c in cfg.categories if c.enabled],
        "messages": [{"id": m["id"], "text": cleaned(m)[0]} for m in messages],
    }
    inherited = {
        "HOME",
        "PATH",
        "LANG",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "NO_PROXY",
        "https_proxy",
        "http_proxy",
        "no_proxy",
        "HF_HUB_OFFLINE",
    }
    env = {
        **{
            key: value
            for key, value in os.environ.items()
            if key in inherited or key.startswith("LC_")
        },
        "HF_HOME": str(
            Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "inkwell/laya"
        ),
        "HF_HUB_DISABLE_TELEMETRY": "1",
        "DO_NOT_TRACK": "1",
        "OMP_NUM_THREADS": "2",
        "OPENBLAS_NUM_THREADS": "2",
        "MKL_NUM_THREADS": "2",
        "TOKENIZERS_PARALLELISM": "false",
    }
    # No shell, no model tools, no shared-server lifecycle changes. Bound output on disk.
    import tempfile

    with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
        child = subprocess.Popen(
            [str(python), "-I", str(Path(__file__).with_name("laya_runner.py"))],
            stdin=subprocess.PIPE,
            stdout=output,
            stderr=errors,
            env=env,
        )
        try:
            child.stdin.write(json.dumps(payload).encode())
            child.stdin.close()
            deadline = time.monotonic() + 600
            while child.poll() is None:
                if cancel.wait(0.25) or time.monotonic() > deadline:
                    raise RuntimeError("Local analysis stopped or timed out; retry the batch")
            if child.returncode:
                raise RuntimeError(
                    "Local Laya analysis failed. Check the runtime installation and available disk/memory; retry when ready."
                )
            if output.tell() > 65536:
                raise ValueError("Laya returned an oversized result")
            output.seek(0)
            return json.loads(output.read(65537))
        finally:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()


def validated(result, messages, cfg):
    categories = {c.name for c in cfg.categories if c.enabled}
    if not isinstance(result, dict) or set(result) != {str(m["id"]) for m in messages}:
        raise ValueError("Invalid analysis message identities")
    for scores in result.values():
        if not isinstance(scores, dict) or set(scores) != categories:
            raise ValueError("Invalid analysis categories")
        if any(
            type(s) not in (int, float) or not math.isfinite(s) or not 0 <= s <= 1
            for s in scores.values()
        ):
            raise ValueError("Invalid analysis score")
    return result


class Worker:
    def __init__(self):
        self.cancel = threading.Event()
        self.wake = threading.Event()
        self.thread = None
        self.active = False

    def start(self):
        if self.thread and self.thread.is_alive():
            return
        self.cancel.clear()
        self.thread = threading.Thread(target=self.run, name="inkwell-mail-analysis", daemon=True)
        self.thread.start()

    def stop(self):
        self.cancel.set()
        self.wake.set()
        if self.thread:
            self.thread.join(timeout=5)

    def once(self):
        with store.db() as conn:
            if not config(conn).enabled:
                return False
            conn.execute("BEGIN IMMEDIATE")
            cfg = config(conn)
            if (
                not cfg.enabled
                or not any(c.enabled for c in cfg.categories)
                or conn.execute("SELECT 1 FROM settings WHERE key='mail_analysis_error'").fetchone()
            ):
                return False
            conn.execute(
                "UPDATE mail_analysis_jobs SET state='no_match',outcome='Message no longer eligible' WHERE state='pending' AND EXISTS (SELECT 1 FROM messages m WHERE m.id=mail_analysis_jobs.message_id AND NOT ("
                + ELIGIBLE
                + "))"
            )
            fill_page(conn)
            conn.execute(
                "UPDATE mail_analysis_jobs SET state='pending',claim='' WHERE state='running' AND updated<?",
                (time.time() - 900,),
            )
            backfill_row = conn.execute(
                "SELECT value FROM settings WHERE key='mail_analysis_backfill'"
            ).fetchone()
            paused = bool(backfill_row and json.loads(backfill_row[0]).get("paused"))
            rows = conn.execute(
                f"SELECT m.* FROM mail_analysis_jobs j JOIN messages m ON m.id=j.message_id WHERE j.state='pending' AND {ELIGIBLE} AND (?=0 OR j.origin!='backfill') ORDER BY CASE j.origin WHEN 'incoming' THEN 0 ELSE 1 END,j.message_id LIMIT 4",
                (int(paused),),
            ).fetchall()
            if not rows:
                return False
            messages = [dict(r) for r in rows]
            claim = uuid.uuid4().hex
            for m in messages:
                conn.execute(
                    "UPDATE mail_analysis_jobs SET state='running',claim=?,updated=? WHERE message_id=?",
                    (claim, time.time(), m["id"]),
                )
        self.active = True
        try:
            output = validated(predict_batch(messages, cfg, self.cancel), messages, cfg)
            with store.db() as conn:
                conn.execute("BEGIN IMMEDIATE")
                if catalog_key(config(conn)) != catalog_key(cfg) or not config(conn).enabled:
                    conn.execute(
                        "UPDATE mail_analysis_jobs SET state='pending',claim='' WHERE claim=?",
                        (claim,),
                    )
                    return False
                for m in messages:
                    current = conn.execute(
                        f"SELECT * FROM messages WHERE id=? AND {ELIGIBLE}", (m["id"],)
                    ).fetchone()
                    if not current or fingerprint(current) != fingerprint(m):
                        conn.execute(
                            "UPDATE mail_analysis_jobs SET state='pending',claim='' WHERE message_id=? AND claim=?",
                            (m["id"], claim),
                        )
                        continue
                    scores = output[str(m["id"])]
                    state = (
                        "review"
                        if any(scores[c.name] >= c.threshold for c in cfg.categories if c.enabled)
                        else "no_match"
                    )
                    conn.execute(
                        "UPDATE mail_analysis_jobs SET state=?,fingerprint=?,catalog=?,scores=?,error='',truncated=?,updated=? WHERE message_id=? AND claim=?",
                        (
                            state,
                            fingerprint(m),
                            catalog_key(cfg),
                            json.dumps(scores),
                            int(cleaned(m)[1]),
                            time.time(),
                            m["id"],
                            claim,
                        ),
                    )
                conn.execute("DELETE FROM settings WHERE key='mail_analysis_error'")
        except Exception as exc:
            # Never persist message content or model stderr in diagnostics.
            detail = (
                str(exc)[:500]
                if isinstance(exc, (RuntimeError, ValueError))
                else "Local analysis failed; retry the batch"
            )
            with store.db() as conn:
                if self.cancel.is_set():
                    conn.execute(
                        "UPDATE mail_analysis_jobs SET state='pending',claim='',error='' WHERE claim=? AND state='running'",
                        (claim,),
                    )
                else:
                    conn.execute(
                        "UPDATE mail_analysis_jobs SET state='failed',error=?,updated=? WHERE claim=? AND state='running'",
                        (detail, time.time(), claim),
                    )
                    conn.execute(
                        "INSERT OR REPLACE INTO settings VALUES ('mail_analysis_error',?)",
                        (detail,),
                    )
        finally:
            self.active = False
        return True

    def run(self):
        while not self.cancel.is_set():
            try:
                self.once()
            except Exception:
                try:
                    store.set_setting(
                        "mail_analysis_error",
                        "Analysis queue could not be read or updated. Retry analysis after checking the local database.",
                    )
                except Exception:
                    pass
            self.wake.wait(5)
            self.wake.clear()


WORKER = Worker()
