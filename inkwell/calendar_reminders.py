"""Local, persistent occurrence deduplication for native calendar reminders."""

import hashlib
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import calendar_tools, store

router = APIRouter()


def key(event):
    return hashlib.sha256(f"{event['id']}:{event['start']}".encode()).hexdigest()


def due(now=None):
    now = now or datetime.now(timezone.utc)
    with store.db() as db:
        events = [dict(row) for row in db.execute("SELECT * FROM events WHERE all_day=0")]
        upcoming = calendar_tools.occurrences(events, now, now + timedelta(minutes=15, seconds=30))
        result = []
        for event in upcoming:
            start = datetime.fromisoformat(event["start"])
            if not now < start <= now + timedelta(minutes=15, seconds=30):
                continue
            token = key(event)
            if not db.execute(
                "SELECT 1 FROM settings WHERE key=?", ("calendar-reminder:" + token,)
            ).fetchone():
                result.append(
                    {
                        "key": token,
                        "event_id": event["id"],
                        "title": event["title"],
                        "start": event["start"],
                        "location": event["location"],
                    }
                )
            if len(result) == 20:
                break
        return result


@router.get("/api/calendar/reminders")
def reminders():
    try:
        return {"reminders": due(), "lead_minutes": 15}
    except ValueError as error:
        raise HTTPException(422, "Too many reminders to expand") from error


class Acknowledgement(BaseModel):
    key: str = Field(pattern=r"^[a-f0-9]{64}$")
    event_id: int = Field(gt=0)


@router.post("/api/calendar/reminders/ack")
def acknowledge(data: Acknowledgement):
    # Only acknowledge a currently due occurrence belonging to this event.
    if not any(item["key"] == data.key and item["event_id"] == data.event_id for item in due()):
        return {"ok": True}
    with store.db() as db:
        db.execute(
            "INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)",
            (
                "calendar-reminder:" + data.key,
                json.dumps(
                    {"event_id": data.event_id, "shown_at": datetime.now(timezone.utc).isoformat()}
                ),
            ),
        )
    return {"ok": True}
