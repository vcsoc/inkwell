"""Allowlisted, non-executable keyboard preferences."""

import re

DEFAULTS = {
    "sync": "F9",
    "compose": "C",
    "search": "/",
    "delete": "Delete",
    "quick_filter": "Ctrl+Shift+K",
    "up": "ArrowUp",
    "down": "ArrowDown",
    "left": "ArrowLeft",
    "right": "ArrowRight",
    "zoom_in": "Ctrl+=",
    "zoom_out": "Ctrl+-",
    "zoom_reset": "Ctrl+0",
}
RESERVED = {
    "Ctrl+C",
    "Ctrl+V",
    "Ctrl+X",
    "Ctrl+A",
    "Ctrl+Z",
    "Ctrl+Y",
    "Ctrl+Q",
    "Ctrl+W",
    "Ctrl+R",
    "Ctrl+Shift+R",
    "Alt+F4",
    "F5",
    "F11",
    "F12",
}


def validate(value):
    if not isinstance(value, dict) or set(value) - set(DEFAULTS):
        raise ValueError("Unknown shortcut action")
    result = {**DEFAULTS, **value}
    used = set()
    for action, combo in result.items():
        if not isinstance(combo, str) or len(combo) > 40:
            raise ValueError("Invalid shortcut")
        if not combo:
            continue
        if not re.fullmatch(
            r"(Ctrl\+)?(Alt\+)?(Shift\+)?(?:[A-Z0-9/=\-]|F(?:[1-9]|1[0-2])|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)",
            combo,
        ):
            raise ValueError("Use Ctrl, Alt, Shift and a letter, number, function key or arrow")
        if combo in RESERVED:
            raise ValueError(
                "This shortcut is reserved for editing, the browser or operating system"
            )
        if combo in used:
            raise ValueError("Each shortcut must be unique")
        used.add(combo)
    return result
