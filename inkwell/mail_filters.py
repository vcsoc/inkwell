"""Shared SQL filters and allowlisted sorting, applied before pagination."""

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import HTTPException
from typing import Literal
from pydantic import BaseModel, Field


def timestamp(value):
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        delta = dt.replace(tzinfo=None) - datetime(1970, 1, 1) - (dt.utcoffset() or timedelta())
        return (delta.days * 86400 + delta.seconds) * 1000000 + delta.microseconds
    except (ValueError, TypeError, AttributeError, OverflowError):
        return None


Sort = Literal["date", "sender", "recipient", "subject", "unread", "starred", "tags", "imported"]
Order = Literal["asc", "desc"]


class Filters(BaseModel):
    unread_only: bool = False
    starred_only: bool = False
    tag_state: Literal["all", "tagged", "untagged"] = "all"
    tag_id: int | None = Field(default=None, ge=1)
    sort_by: Sort = "date"
    sort_order: Order = "desc"
    date_from: date | None = None
    date_to: date | None = None
    date_timezone: str = Field(default="UTC", max_length=100)

    def sql(self):
        clause = ""
        params = []
        if self.unread_only:
            clause += " AND unread=1"
        if self.starred_only:
            clause += " AND starred=1"
        if self.tag_state != "all":
            clause += " AND json_array_length(tags)" + (
                ">0" if self.tag_state == "tagged" else "=0"
            )
        if self.tag_id is not None:
            clause += " AND EXISTS (SELECT 1 FROM json_each(messages.tags) WHERE inkwell_tag_key(value)=(SELECT key FROM tag_catalog WHERE id=?))"
            params.append(self.tag_id)
        if self.date_from or self.date_to:
            if self.date_from and self.date_to and self.date_from > self.date_to:
                raise HTTPException(422, "From date must not be after To date")
            try:
                zone = ZoneInfo(self.date_timezone)
            except (ZoneInfoNotFoundError, ValueError):
                raise HTTPException(422, "Invalid date filter timezone") from None
            if self.date_from:
                clause += " AND inkwell_timestamp(date)>=?"
                params.append(timestamp(datetime.combine(self.date_from, time(), zone).isoformat()))
            if self.date_to:
                if self.date_to == date.max:
                    clause += " AND inkwell_timestamp(date)<?+86400000000"
                    end = self.date_to
                else:
                    clause += " AND inkwell_timestamp(date)<?"
                    end = self.date_to + timedelta(days=1)
                params.append(timestamp(datetime.combine(end, time(), zone).isoformat()))
        return clause, params

    def order(self):
        column = {
            "date": "julianday(date)",
            "sender": "sender COLLATE NOCASE",
            "recipient": "recipient COLLATE NOCASE",
            "subject": "subject COLLATE NOCASE",
            "unread": "unread",
            "starred": "starred",
            "tags": "tags COLLATE NOCASE",
            "imported": "id",
        }[self.sort_by]
        return column + " " + self.sort_order + ",id " + self.sort_order
