"""Canonical collection keys, shared by migration and SQLite insert/update triggers."""

import re
import unicodedata
from email.utils import parseaddr

_PREFIX = re.compile(r"^\s*(?:re|fw|fwd)(?:\[\d+\])?\s*:\s*", re.IGNORECASE)


def sender_key(value):
    try:
        address = parseaddr(value or "")[1]
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
