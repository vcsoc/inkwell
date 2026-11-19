"""Shared cached-mail search, including Unicode-aware local tags."""

import re
import unicodedata


def key(value):
    return unicodedata.normalize("NFKC", str(value or "")).casefold()


def predicate(query):
    query = query.strip()[:200]
    if not query:
        return "", []
    tag = re.match(r"^tags?:(.*)$", query, re.I)
    if tag:
        value = tag.group(1).strip()
        exact = len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}
        if exact:
            value = value[1:-1]
        if not value:
            return "0=1", []
        match = "inkwell_search_key(value)=?" if exact else "instr(inkwell_search_key(value),?)>0"
        return f"EXISTS (SELECT 1 FROM json_each(messages.tags) WHERE {match})", [key(value)]
    # Keep native SQLite text scanning; escape LIKE metacharacters so searches are literal.
    pattern = "%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    columns = ("subject", "sender", "recipient", "cc", "bcc", "body")
    text = " OR ".join(f"{column} LIKE ? ESCAPE '\\'" for column in columns)
    tag_match = "instr(inkwell_search_key(value),?)>0"
    tag_values = [key(query)]
    if query.startswith("#"):
        # Hashtag shorthand must not hide literal ticket numbers/hashtags in mail text.
        tag_match = "inkwell_search_key(value) IN (?,?)"
        tag_values = [key(query), key(query[1:])]
    return (
        "(" + text + f" OR EXISTS (SELECT 1 FROM json_each(messages.tags) WHERE {tag_match}))",
        [pattern] * len(columns) + tag_values,
    )
