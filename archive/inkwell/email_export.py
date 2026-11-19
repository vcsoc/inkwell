"""Explicit export of cached mail, not original MIME or a provider operation."""

import re
from datetime import datetime
from email.message import EmailMessage
from email.policy import SMTP
from email.utils import format_datetime
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from . import store

router = APIRouter(prefix="/api/messages")


def header(value):
    return re.sub(r"[\x00-\x1f\x7f]+", " ", value or "").strip()


@router.get("/{id}/eml")
def export_message(id: int):
    if not 0 < id < 2**63:
        raise HTTPException(422, "Invalid message identifier")
    with store.db() as db:
        row = db.execute("SELECT * FROM messages WHERE id=?", (id,)).fetchone()
        if not row:
            raise HTTPException(404, "Message not found")
    message = EmailMessage(policy=SMTP)
    for field, column in [
        ("Subject", "subject"),
        ("From", "sender"),
        ("To", "recipient"),
        ("Cc", "cc"),
        ("Bcc", "bcc"),
    ]:
        value = header(row[column])
        if value:
            message[field] = value
    try:
        message["Date"] = format_datetime(datetime.fromisoformat(row["date"]))
    except (ValueError, TypeError):
        pass
    message["X-Inkwell-Export"] = (
        "Cached reconstruction; original headers and attachments unavailable"
    )
    message.set_content(row["body"] or "")
    if row["html_body"]:
        message.add_alternative(row["html_body"], subtype="html")
    name = re.sub(r"[^a-zA-Z0-9 _.-]", "", row["subject"])[:70].strip(" .") or "message"
    return Response(
        message.as_bytes(),
        media_type="message/rfc822",
        headers={
            "Content-Disposition": f'attachment; filename="{name}-{id}.eml"',
            "Cache-Control": "no-store",
        },
    )
