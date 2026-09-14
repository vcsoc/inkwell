"""Canonical collection keys, shared by migration and SQLite insert/update triggers."""

import re
import unicodedata
from email.utils import parseaddr, getaddresses

_PREFIX = re.compile(r"^\s*(?:re|fw|fwd)(?:\[\d+\])?\s*:\s*", re.IGNORECASE)


def sender_key(value):
    try:
        parsed = getaddresses([value or ""])
        address = parsed[0][1] if len(parsed) == 1 else ""
        if "@" not in address:
            # Older Graph imports left commas in display names unquoted. Recover only
            # a single trailing angle address, never choose one sender from a list.
            legacy = re.fullmatch(r"[^<>@\r\n]+<([^<>\r\n]+)>", value or "")
            if legacy and not any(ord(c) < 32 or ord(c) == 127 for c in value):
                candidate = legacy.group(1).strip()
                if parseaddr(candidate)[1] == candidate:
                    address = candidate
        local, domain = address.rsplit("@", 1)
        if not local or not domain or any(char.isspace() for char in domain):
            return ""
        domain = domain.rstrip(".").encode("idna").decode("ascii").lower()
        return unicodedata.normalize("NFC", local).casefold() + "@" + domain
    except (ValueError, UnicodeError, TypeError):
        return ""


def domain_key(value):
    address = sender_key(value)
    return address.rsplit("@", 1)[1] if address else ""


def subject_key(value):
    subject = unicodedata.normalize("NFC", value or "")
    while match := _PREFIX.match(subject):
        subject = subject[match.end() :]
    subject = " ".join(subject.split()).casefold()
    return "" if subject == "(no subject)" else subject
