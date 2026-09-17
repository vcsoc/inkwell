"""Small local attachment indicators; never fetch provider data for a mailbox list."""

import json


def record(db, message_id, present):
    if present is not None:
        db.execute(
            "INSERT OR REPLACE INTO message_attachment_status(message_id,present) VALUES (?,?)",
            (message_id, int(present)),
        )


def imap_hint(message):
    from email.errors import HeaderParseError

    try:
        for index, part in enumerate(message.walk()):
            if index > 2000:
                return None
            if (
                part.get_filename()
                or part.get_content_disposition() == "attachment"
                or part.get("Content-ID")
            ) and (not part.is_multipart() or part.get_content_type() == "message/rfc822"):
                return True
        return False
    except (HeaderParseError, ValueError, RecursionError):
        return None


def annotate(db, messages):
    if not messages:
        return messages
    ids = [m["id"] for m in messages]
    slots = ",".join("?" for _ in ids)
    hints = {
        r["message_id"]: bool(r["present"])
        for r in db.execute(
            f"SELECT * FROM message_attachment_status WHERE message_id IN ({slots})", ids
        )
    }
    for row in db.execute(f"SELECT * FROM attachment_views WHERE message_id IN ({slots})", ids):
        try:
            state = json.loads(row["state"])
        except (ValueError, TypeError):
            continue
        selected = [g for g in state.get("groups", []) if g.get("selected")]
        if any(g.get("files") for g in selected):
            hints[row["message_id"]] = True
        elif selected and all(g.get("checked") for g in selected):
            hints[row["message_id"]] = False
    for m in messages:
        m["has_attachments"] = hints.get(m["id"])
    return messages
