"""Local recipient parsing/history. Never submitted to a remote suggestion service."""

import re
from email.utils import getaddresses
from email.header import decode_header, make_header
from email.headerregistry import Address
from fastapi import APIRouter, Query
from . import store

router = APIRouter(prefix="/api/addresses")


def parse(value, strict=True):
    if any(ord(c) < 32 for c in value):
        if strict:
            raise ValueError("Recipient fields must not contain control characters")
        value = " ".join(value.splitlines())
    # Outlook-style semicolons, but preserve punctuation inside quoted display names.
    quoted = False
    escaped = False
    chars = []
    for c in value:
        if c == '"' and not escaped:
            quoted = not quoted
        chars.append("," if c == ";" and not quoted else c)
        escaped = c == "\\" and not escaped
    value = "".join(chars).strip()
    if not value:
        return []
    try:
        parsed = getaddresses([value], strict=strict)
    except TypeError:
        parsed = getaddresses([value])  # Python 3.11/3.12 compatibility
    result = []
    seen = set()
    for name, address in parsed:
        if (
            not re.fullmatch(
                r"[^\s@<>,;\x00-\x1f]+@[^\s@<>,;\x00-\x1f]+\.[^\s@<>,;\x00-\x1f]+", address
            )
            or len(address) > 254
        ):
            if strict:
                raise ValueError("Enter valid email addresses, separated by commas or semicolons")
            continue
        if address.casefold() not in seen:
            try:
                name = str(make_header(decode_header(name)))
            except (LookupError, UnicodeError):
                pass
            name = " ".join(name.split())
            result.append((name[:200], address))
            seen.add(address.casefold())
    if strict and (not result or len(result) > 100):
        raise ValueError("Enter between 1 and 100 recipients")
    return result


def normalize(*fields):
    result = []
    seen = set()
    for field in fields:
        group = []
        for name, address in parse(field):
            if address.casefold() not in seen:
                group.append(str(Address(display_name=name, addr_spec=address)))
                seen.add(address.casefold())
        result.append(", ".join(group))
    if not seen or len(seen) > 100:
        raise ValueError("Enter between 1 and 100 recipients across To, Cc and Bcc")
    return result


def remember(db, *values, display_name=None):
    for value in values:
        for name, address in parse(value or "", strict=False):
            if display_name is not None:
                name = " ".join(display_name.split())[:200]
            db.execute(
                "INSERT INTO address_history(address,name,last_used) VALUES (?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(address) DO UPDATE SET address=excluded.address,name=CASE WHEN excluded.name!='' THEN excluded.name ELSE address_history.name END,last_used=excluded.last_used",
                (address, name),
            )


def migrate(db):
    for row in db.execute("SELECT sender,recipient,cc,bcc FROM messages"):
        remember(db, *row)
    for table in ("contacts", "accounts"):
        for row in db.execute("SELECT name,email FROM " + table):
            remember(db, row["email"], display_name=row["name"])


@router.get("")
def suggestions(q: str = Query(default="", max_length=254)):
    # Current contacts/accounts remain available even if remembered history was cleared.
    with store.db() as db:
        key = q.casefold().strip()
        entries = {
            r["address"].casefold(): dict(r)
            for r in db.execute(
                "SELECT address,name,last_used FROM address_history WHERE instr(inkwell_tag_key(address),?)>0 OR instr(inkwell_tag_key(name),?)>0 ORDER BY last_used DESC,address LIMIT 60",
                (key, key),
            )
        }
        for table in ("contacts", "accounts"):
            for row in db.execute(
                "SELECT name,email FROM "
                + table
                + " WHERE instr(inkwell_tag_key(name),?)>0 OR instr(inkwell_tag_key(email),?)>0 ORDER BY name LIMIT 30",
                (key, key),
            ):
                for _, address in parse(row["email"], strict=False):
                    entries.setdefault(
                        address.casefold(),
                        {"address": address, "name": row["name"], "last_used": ""},
                    )
        return [
            r
            for r in entries.values()
            if key in r["address"].casefold() or key in r["name"].casefold()
        ][:30]


@router.delete("")
def clear():
    with store.db() as db:
        db.execute("DELETE FROM address_history")
    return {"ok": True}
