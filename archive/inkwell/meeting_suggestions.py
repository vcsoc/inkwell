"""Tentative calendar items inferred only from dated cached mail, never provider RSVP."""

import hashlib
import re
from datetime import datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import calendar_import, store

ZONE_NAMES = {
    "eastern time (us & canada)": "America/New_York",
    "central time (us & canada)": "America/Chicago",
    "mountain time (us & canada)": "America/Denver",
    "pacific time (us & canada)": "America/Los_Angeles",
    "greenwich mean time": "Europe/London",
}
DATE = re.compile(r"^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+[A-Za-z]+\s+\d{1,2},?\s+20\d{2}$", re.I)
TIMES = re.compile(r"^(\d{1,2}:\d{2}\s*[AP]M)\s*[-–]\s*(\d{1,2}:\d{2}\s*[AP]M)$", re.I)
OFFSET = re.compile(r"^\(UTC([+-])(\d{2}):(\d{2})\)\s*(.*)$", re.I)


def proposals(row, model):
    body = row["body"] or ""
    if re.search(r"\b(cancelled|canceled|cancellation|rescheduled)\b", row["subject"] or "", re.I):
        return []
    results = []
    if "Upcoming booking for" in body and "Powered by Microsoft Bookings" in body:
        lines = [" ".join(line.replace("\xa0", " ").split()) for line in body.splitlines()]
        lines = [line for line in lines if line]
        try:
            start_index = next(i for i, line in enumerate(lines) if line == "Upcoming booking for")
            # Bookings puts the attendee's name, event title, date, time and zone in that order.
            attendee, title, day, hours, zone_label = lines[start_index + 1:start_index + 6]
            match = TIMES.fullmatch(hours)
            offset = OFFSET.fullmatch(zone_label)
            if not attendee or not title or not DATE.fullmatch(day) or not match or not offset:
                raise ValueError("Booking has no unambiguous date and time")
            if len(title) > 200 or len(attendee) > 200:
                raise ValueError("Booking fields too long")
            date = datetime.strptime(day.replace(",", ""), "%A %B %d %Y").date()
            offset_hours, offset_minutes = int(offset[2]), int(offset[3])
            if offset_hours > 14 or offset_minutes > 59:
                raise ValueError("Invalid time offset")
            zone_name = ZONE_NAMES.get(offset[4].strip().casefold(), "UTC")
            zone = ZoneInfo(zone_name) if zone_name != "UTC" else timezone(
                (1 if offset[1] == "+" else -1) * timedelta(hours=offset_hours, minutes=offset_minutes)
            )
            first = datetime.combine(date, datetime.strptime(match[1].replace(" ", ""), "%I:%M%p").time(), zone)
            last = datetime.combine(date, datetime.strptime(match[2].replace(" ", ""), "%I:%M%p").time(), zone)
            if last <= first:
                last += timedelta(days=1)
            if not timedelta(minutes=1) <= last - first <= timedelta(days=1):
                raise ValueError("Invalid booking duration")
            event = model.model_validate({
                "title": title, "start": first, "end": last,
                "timezone": zone_name, "notes": "Suggested from an unverified Microsoft Bookings reminder. Check the original email before accepting. No provider RSVP is sent.",
            }).model_dump(mode="json")
            identifier = f"booking:{row['account_id']}:{title.casefold()}:{first.astimezone(timezone.utc).isoformat()}"
            results.append({"uid": hashlib.sha256(identifier.encode()).hexdigest(), "event": event})
        except (ValueError, IndexError, StopIteration, ZoneInfoNotFoundError):
            pass
    if "BEGIN:VCALENDAR" in body.upper() and "END:VCALENDAR" in body.upper():
        start = body.upper().find("BEGIN:VCALENDAR")
        end = body.upper().find("END:VCALENDAR", start)
        if 0 <= start < end and end + 13 - start <= calendar_import.LIMIT:
            try:
                for item in calendar_import.parse(body[start:end + 13], "UTC", model)[:20]:
                    item["uid"] = hashlib.sha256(f"ics:{row['account_id']}:{item['uid']}".encode()).hexdigest()
                    results.append(item)
            except (ValueError, KeyError, TypeError, OverflowError, RecursionError):
                pass
    return results


def router_for(model, values):
    routes = APIRouter()

    def candidates():
        with store.db() as db:
            return db.execute("""SELECT id, account_id, subject, body FROM messages
                WHERE folder NOT IN ('trash','sent','drafts') AND
                (body LIKE '%Upcoming booking for%' OR body LIKE '%BEGIN:VCALENDAR%')
                ORDER BY date DESC LIMIT 500""").fetchall()

    @routes.get("/api/calendar/pending")
    def pending(start: datetime, end: datetime):
        if not start.tzinfo or not end.tzinfo or not timedelta(0) < end - start <= timedelta(days=100):
            raise HTTPException(422, "Choose a timezone-aware calendar range of at most 100 days")
        records = []
        with store.db() as db:
            statuses = {r["uid"]: r["status"] for r in db.execute("SELECT uid,status FROM meeting_choices")}
        seen = set()
        for row in candidates():
            for item in proposals(row, model):
                uid, event = item["uid"], item["event"]
                if uid in seen or statuses.get(uid) in ("accepted", "ignored"):
                    continue
                seen.add(uid)
                first, last = datetime.fromisoformat(event["start"]), datetime.fromisoformat(event["end"])
                if first < end and last > start:
                    records.append({"uid": uid, "message_id": row["id"], "status": statuses.get(uid, "pending"), "event": event})
        return records[:200]

    class Decision(BaseModel):
        uid: str
        action: Literal["accept", "reject", "ignore"]

    @routes.post("/api/calendar/pending/{message_id}")
    def decide(message_id: int, decision: Decision):
        with store.db() as db:
            row = db.execute("SELECT id,account_id,subject,body FROM messages WHERE id=? AND folder NOT IN ('trash','sent','drafts')", (message_id,)).fetchone()
            if not row:
                raise HTTPException(404, "Invitation message no longer exists")
            event_data = next((item["event"] for item in proposals(row, model) if item["uid"] == decision.uid), None)
            if event_data is None:
                raise HTTPException(404, "Meeting invitation no longer exists")
            db.execute("BEGIN IMMEDIATE")
            previous = db.execute("SELECT status,event_id FROM meeting_choices WHERE uid=?", (decision.uid,)).fetchone()
            if previous and previous["status"] == "accepted":
                raise HTTPException(409, "This meeting was already added to the local calendar")
            event_id = None
            if decision.action == "accept":
                event = model.model_validate(event_data)
                event_id = db.execute("INSERT INTO events(title,start,end,location,notes,all_day,timezone,recurrence) VALUES (?,?,?,?,?,?,?,?)", values(event)).lastrowid
            db.execute("INSERT INTO meeting_choices(uid,status,event_id) VALUES (?,?,?) ON CONFLICT(uid) DO UPDATE SET status=excluded.status,event_id=excluded.event_id", (decision.uid, {"accept": "accepted", "reject": "rejected", "ignore": "ignored"}[decision.action], event_id))
        return {"status": decision.action, "event_id": event_id}

    return routes
