"""Bounded, timezone-aware local recurrence; no invitations or provider writes."""

import json
from datetime import datetime, date, time, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from typing import Literal
from dateutil import rrule
from pydantic import BaseModel, Field, field_validator


class Recurrence(BaseModel):
    frequency: Literal["none", "daily", "weekly", "monthly", "yearly"] = "none"
    interval: int = Field(default=1, ge=1, le=365)
    count: int = Field(default=10, ge=1, le=1000)
    until: date | None = None
    weekdays: list[Literal["MO", "TU", "WE", "TH", "FR", "SA", "SU"]] = Field(
        default_factory=list, max_length=7
    )


class CalendarFields(BaseModel):
    all_day: bool = False
    timezone: str = Field(default="UTC", max_length=100)
    recurrence: Recurrence = Field(default_factory=Recurrence)

    @field_validator("timezone")
    @classmethod
    def valid_zone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Choose a valid IANA timezone")
        return value


def schedule(event):
    rec = Recurrence.model_validate(json.loads(event["recurrence"]))
    zone = timezone.utc if event["all_day"] else ZoneInfo(event["timezone"])
    start = datetime.fromisoformat(event["start"]).astimezone(zone)
    end = datetime.fromisoformat(event["end"]).astimezone(zone)
    if rec.frequency == "none":
        return [start], end - start
    freq = {
        "daily": rrule.DAILY,
        "weekly": rrule.WEEKLY,
        "monthly": rrule.MONTHLY,
        "yearly": rrule.YEARLY,
    }[rec.frequency]
    until = datetime.combine(rec.until, time.max, zone) if rec.until else None
    weekdays = (
        tuple(getattr(rrule, w) for w in rec.weekdays)
        if rec.frequency == "weekly" and rec.weekdays
        else None
    )
    series = rrule.rrule(
        freq, dtstart=start, interval=rec.interval, count=rec.count, byweekday=weekdays
    )

    def bounded():
        for when in series:
            if until and when > until:
                break
            # Skip non-existent spring-forward wall times instead of shifting them.
            if when.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None) == when.replace(
                tzinfo=None
            ):
                yield when

    return bounded(), end - start


def occurrences(events, start, end):
    output = []
    for event in events:
        series, duration = schedule(event)
        for when in series:
            if when >= end:
                break
            finish = when + duration
            if finish <= start:
                continue
            output.append(
                {
                    **event,
                    "series_start": event["start"],
                    "series_end": event["end"],
                    "start": when.astimezone(timezone.utc).isoformat(),
                    "end": finish.astimezone(timezone.utc).isoformat(),
                }
            )
            if len(output) > 5000:
                raise ValueError("Too many calendar occurrences; choose a smaller date range")
    return sorted(output, key=lambda e: e["start"])


def recurrence_line(event):
    rec = Recurrence.model_validate(json.loads(event["recurrence"]))
    if rec.frequency == "none":
        return None
    series, _ = schedule(event)
    count = sum(1 for _ in series)
    if count == 0:
        return None
    line = f"RRULE:FREQ={rec.frequency.upper()};INTERVAL={rec.interval};COUNT={count}"
    if rec.frequency == "weekly" and rec.weekdays:
        line += ";BYDAY=" + ",".join(dict.fromkeys(rec.weekdays))
    return line
