"""Explicit local calendar imports; never RSVP, fetch calendar URLs, or alter providers."""

import hashlib
import json
import re
from datetime import date, datetime, time, timedelta, timezone
from email import policy
from email.parser import BytesParser
from urllib.parse import quote
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException
from icalendar import Calendar
from icalendar.timezone.windows_to_olson import WINDOWS_TO_OLSON
from pydantic import BaseModel, Field

from . import microsoft, store

LIMIT = 2_000_000


class Source(BaseModel):
    content: str = Field(max_length=LIMIT)
    timezone: str = Field(default="UTC", max_length=100)


class Entry(BaseModel):
    uid: str = Field(min_length=1, max_length=1024)
    event: dict


class Selection(BaseModel):
    entries: list[Entry] = Field(min_length=1, max_length=100)


def parse(content, zone_name, model):
    if len(content.encode("utf-8")) > LIMIT:
        raise ValueError("Calendar file is too large (2 MB / 100 events maximum)")
    zone = ZoneInfo(zone_name)
    # Resolve only installed IANA/known Windows zones, never evaluate untrusted
    # VTIMEZONE recurrence programs (which can expand into millions of transitions).
    content = re.sub(r"\r?\n[ \t]", "", content.lstrip("\ufeff"))
    if content.upper().count("BEGIN:") > 400:
        raise ValueError("Too many calendar components")
    cleaned = []
    in_zone = False
    for line in content.splitlines(keepends=True):
        marker = line.strip().upper()
        if marker == "BEGIN:VTIMEZONE":
            if in_zone:
                raise ValueError("Nested timezone definitions are invalid")
            in_zone = True
        elif marker == "END:VTIMEZONE":
            if not in_zone:
                raise ValueError("Invalid timezone definition")
            in_zone = False
        elif not in_zone:
            cleaned.append(line)
    if in_zone:
        raise ValueError("Unterminated timezone definition")
    calendar = Calendar.from_ical("".join(cleaned))
    if calendar.name != "VCALENDAR":
        raise ValueError("Choose a valid .ics calendar file")
    if str(calendar.get("METHOD", "")).upper() == "CANCEL":
        raise ValueError(
            "This is a cancellation. Review and remove the existing local event manually."
        )
    entries = []
    for item in calendar.walk("VEVENT"):
        if len(entries) >= 100:
            raise ValueError("Import at most 100 events at a time")
        if any(item.get(k) is not None for k in ("RECURRENCE-ID", "EXDATE", "RDATE", "EXRULE")):
            raise ValueError(
                "Recurrence exceptions are not supported; import a single occurrence instead."
            )
        if str(item.get("STATUS", "")).upper() == "CANCELLED":
            raise ValueError(
                "Cancelled events are not imported. Review the existing local event manually."
            )
        if not item.get("DTSTART"):
            raise ValueError("An event is missing its start time")
        start = item.decoded("DTSTART")
        all_day = isinstance(start, date) and not isinstance(start, datetime)
        tzid = str(item["DTSTART"].params.get("TZID", ""))
        if tzid:
            zone = ZoneInfo(WINDOWS_TO_OLSON.get(tzid, tzid))
        else:
            zone = ZoneInfo(zone_name)
        if isinstance(start, datetime) and tzid and start.tzinfo is None:
            raise ValueError("The invitation timezone could not be decoded")
        end = (
            item.decoded("DTEND")
            if item.get("DTEND")
            else start
            + (
                item.decoded("DURATION")
                if item.get("DURATION")
                else timedelta(days=1)
                if all_day
                else timedelta(hours=1)
            )
        )
        if all_day != (isinstance(end, date) and not isinstance(end, datetime)):
            raise ValueError("Start and end must both be dates or both be times")
        if all_day:
            start = datetime.combine(start, time(), timezone.utc)
            end = datetime.combine(end, time(), timezone.utc)
            zone = timezone.utc
        else:
            start = start if start.tzinfo else start.replace(tzinfo=zone)
            end = end if end.tzinfo else end.replace(tzinfo=zone)
            if not tzid and item["DTSTART"].to_ical().endswith(b"Z"):
                zone = timezone.utc
        for instant in (start, end):
            if instant.astimezone(timezone.utc).astimezone(instant.tzinfo).replace(
                tzinfo=None
            ) != instant.replace(tzinfo=None):
                raise ValueError("An event time falls in a daylight-saving gap")
        recurrence = {}
        rule = item.get("RRULE")
        if rule:
            allowed = {"FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "WKST"}
            if set(rule) - allowed or any(len(rule[k]) != 1 for k in rule if k != "BYDAY"):
                raise ValueError("This repeating pattern is not supported by the local calendar")
            if rule.get("WKST", ["MO"])[0] != "MO":
                raise ValueError("Repeats with a non-Monday week start are not supported")
            frequency = str(rule["FREQ"][0]).lower()
            weekdays = list(map(str, rule.get("BYDAY", [])))
            if weekdays and frequency != "weekly":
                raise ValueError("BYDAY is supported only for weekly repeats")
            recurrence = {
                "frequency": frequency,
                "interval": int(rule.get("INTERVAL", [1])[0]),
                "count": int(rule.get("COUNT", [1000])[0]),
                "weekdays": weekdays,
            }
            if rule.get("UNTIL"):
                until = rule["UNTIL"][0]
                if isinstance(until, datetime):
                    if not until.tzinfo:
                        until = until.replace(tzinfo=zone)
                    until = until.astimezone(zone)
                    # The local model has inclusive day bounds, not arbitrary stop instants.
                    day = until.date() - (
                        timedelta(days=1)
                        if until.time() < start.astimezone(zone).time()
                        else timedelta()
                    )
                else:
                    day = until
                recurrence["until"] = day.isoformat()
        event = model.model_validate(
            {
                "title": str(item.get("SUMMARY", "Untitled meeting")),
                "start": start,
                "end": end,
                "all_day": all_day,
                "timezone": getattr(zone, "key", "UTC"),
                "location": str(item.get("LOCATION", "")),
                "notes": str(item.get("DESCRIPTION", "")),
                "recurrence": recurrence,
            }
        )
        uid = str(item.get("UID", "")) or hashlib.sha256(item.to_ical()).hexdigest()
        entries.append(Entry(uid=uid, event=event.model_dump(mode="json")).model_dump())
    if not entries:
        raise ValueError("No calendar events were found")
    return entries


def message_calendars(message_id):
    with store.db() as db:
        message = db.execute("SELECT * FROM messages WHERE id=?", (message_id,)).fetchone()
        if not message:
            raise HTTPException(404, "Message no longer exists")
        a = db.execute("SELECT * FROM accounts WHERE id=?", (message["account_id"],)).fetchone()
        if not a or a["provider"] != "microsoft":
            raise HTTPException(
                422,
                "For this account, save the .ics file from your provider and use Calendar → Import .ics.",
            )
        account = dict(a)
        prefix = f"{account['id']}:graph:"
        key = message["remote_key"] or ""
        if not key.startswith(prefix):
            raise HTTPException(422, "This cached copy has no Outlook message reference")
    chunks = bytearray()
    with microsoft.client() as client:
        with client.stream(
            "GET",
            "https://graph.microsoft.com/v1.0/me/messages/"
            + quote(key[len(prefix) :], safe="")
            + "/$value",
            headers={
                "Authorization": "Bearer " + microsoft.access_token(account),
                "Prefer": 'IdType="ImmutableId"',
            },
        ) as response:
            response.raise_for_status()
            for chunk in response.iter_bytes(chunk_size=65536):
                chunks.extend(chunk)
                if len(chunks) > 8_000_000:
                    raise HTTPException(
                        422,
                        "Invitation email exceeds the 8 MB import limit. Save and import its .ics file instead.",
                    )
    with store.db() as db:
        if not db.execute(
            "SELECT 1 FROM accounts WHERE id=? AND email=? AND provider='microsoft'",
            (account["id"], account["email"]),
        ).fetchone():
            raise HTTPException(409, "Account disconnected while reading invitation")
    mail = BytesParser(policy=policy.default).parsebytes(bytes(chunks))
    calendars = []
    for part in mail.walk():
        if part.get_content_type() == "text/calendar" or (
            part.get_filename() or ""
        ).lower().endswith(".ics"):
            raw = part.get_payload(decode=True)
            if raw:
                if len(raw) > LIMIT or len(calendars) >= 20:
                    raise HTTPException(422, "Too many or oversized calendar attachments")
                calendars.append(raw.decode(part.get_content_charset() or "utf-8"))
    if not calendars:
        raise HTTPException(422, "No ICS meeting invitation was found in this email.")
    return calendars


def router(model, values):
    routes = APIRouter()

    @routes.post("/api/calendar/import/preview")
    def preview(source: Source):
        try:
            return {"entries": parse(source.content, source.timezone, model)}
        except (ValueError, KeyError, TypeError, OverflowError, RecursionError) as error:
            raise HTTPException(422, "Cannot import calendar: " + str(error)[:300]) from error

    @routes.get("/api/messages/{message_id}/calendar-invites")
    def invites(message_id: int, timezone: str = "UTC"):
        try:
            entries = [
                entry
                for content in message_calendars(message_id)
                for entry in parse(content, timezone, model)
            ]
            return Selection(entries=entries).model_dump()
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(
                422,
                "Could not read this invitation. Try saving and importing its .ics file; unsupported recurrence patterns and timezones cannot be imported.",
            ) from error

    @routes.post("/api/calendar/import")
    def commit(selection: Selection):
        try:
            validated = [
                (entry.uid, model.model_validate(entry.event)) for entry in selection.entries
            ]
        except ValueError as error:
            raise HTTPException(422, "Invalid calendar event") from error
        added = skipped = 0
        with store.db() as db:
            db.execute("BEGIN IMMEDIATE")
            for uid, event in validated:
                key = "calendar-import:" + hashlib.sha256(uid.encode()).hexdigest()
                if db.execute("SELECT 1 FROM settings WHERE key=?", (key,)).fetchone():
                    skipped += 1
                    continue
                id = db.execute(
                    "INSERT INTO events(title,start,end,location,notes,all_day,timezone,recurrence) VALUES (?,?,?,?,?,?,?,?)",
                    values(event),
                ).lastrowid
                db.execute(
                    "INSERT INTO settings(key,value) VALUES (?,?)",
                    (key, json.dumps({"event_id": id})),
                )
                added += 1
        return {"added": added, "skipped": skipped}

    return routes
