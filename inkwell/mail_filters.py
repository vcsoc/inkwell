"""Shared SQL filters and allowlisted sorting, applied before pagination."""

from typing import Literal
from pydantic import BaseModel, Field

Sort = Literal["date", "sender", "recipient", "subject", "unread", "starred", "tags", "imported"]
Order = Literal["asc", "desc"]


class Filters(BaseModel):
    unread_only: bool = False
    starred_only: bool = False
    tag_state: Literal["all", "tagged", "untagged"] = "all"
    tag_id: int | None = Field(default=None, ge=1)
    sort_by: Sort = "date"
    sort_order: Order = "desc"

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
