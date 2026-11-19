"""Explicit local sender choices; discovery never grants send-as permission."""

import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from . import store, addresses

router = APIRouter(prefix="/api/accounts")


def account(id):
    with store.db() as db:
        row = db.execute("SELECT * FROM accounts WHERE id=?", (id,)).fetchone()
    if not row:
        raise HTTPException(404, "Account no longer exists")
    return dict(row)


def address(value):
    try:
        parsed = addresses.parse(value)
        if len(parsed) != 1 or parsed[0][1] != value.strip():
            raise ValueError()
        return parsed[0][1]
    except (ValueError, TypeError):
        raise HTTPException(422, "Use one plain email address per sender") from None


def key(a):
    return f"sending-identities:{a['id']}:{a['provider']}:{a['email']}"


def load(db, a):
    row = db.execute("SELECT value FROM settings WHERE key=?", (key(a),)).fetchone()
    return (
        json.loads(row["value"]) if row else {"manual": [], "provider": [], "default": a["email"]}
    )


def view(a, data):
    found = {}
    for kind, values in [
        ("account", [a["email"]]),
        ("provider", data.get("provider", [])),
        ("configured", data.get("manual", [])),
    ]:
        for value in values:
            found.setdefault(value.casefold(), {"address": value, "source": kind})
    return {
        "account_id": a["id"],
        "addresses": list(found.values()),
        "default_from": data.get("default", a["email"]),
        "additional_addresses": data.get("manual", []),
        "note": "Provider-listed and configured addresses are not a guarantee of send-as permission. Outlook.com may not expose its complete alias list. No fallback sender is used by inkwell.",
    }


def choices(a):
    with store.db() as db:
        return view(a, load(db, a))


def resolve(a, requested=None):
    data = choices(a)
    chosen = requested if requested is not None else data["default_from"]
    for item in data["addresses"]:
        if item["address"].casefold() == chosen.casefold():
            return address(item["address"])
    raise HTTPException(
        422,
        "Selected From address is no longer configured for this account. Choose a sender; nothing was sent.",
    )


class Configuration(BaseModel):
    model_config = ConfigDict(extra="forbid")
    default_from: str = Field(max_length=254)
    additional_addresses: list[str] = Field(default_factory=list, max_length=50)


@router.get("/{id}/senders")
def get(id: int):
    return choices(account(id))


@router.put("/{id}/senders")
def configure(id: int, value: Configuration):
    a = account(id)
    manual = list(dict.fromkeys(address(v) for v in value.additional_addresses))
    default = address(value.default_from)
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        current = db.execute("SELECT email,provider FROM accounts WHERE id=?", (id,)).fetchone()
        if not current or current["email"] != a["email"] or current["provider"] != a["provider"]:
            raise HTTPException(409, "Account changed; refresh sender settings")
        data = {**load(db, a), "manual": manual, "default": default}
        if default.casefold() not in {v["address"].casefold() for v in view(a, data)["addresses"]}:
            raise HTTPException(422, "Choose a configured default From address")
        db.execute(
            "INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key(a), json.dumps(data)),
        )
    return view(a, data)


@router.post("/{id}/senders/refresh")
def refresh(id: int):
    a = account(id)
    if a["provider"] != "microsoft":
        return choices(a)
    from . import microsoft

    try:
        with microsoft.client() as http:
            r = http.get(
                microsoft.GRAPH + "/me?$select=mail,proxyAddresses",
                headers={"Authorization": "Bearer " + microsoft.access_token(a)},
            )
            r.raise_for_status()
            profile = r.json()
    except Exception:
        raise HTTPException(
            502, "Sender discovery failed; existing choices were preserved"
        ) from None
    candidates = [profile.get("mail")] + [
        v[5:]
        for v in (profile.get("proxyAddresses") or [])
        if isinstance(v, str) and v.lower().startswith("smtp:")
    ]
    discovered = []
    for value in candidates:
        if not isinstance(value, str):
            continue
        try:
            discovered.append(address(value))
        except HTTPException:
            continue
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        current = db.execute("SELECT email,provider FROM accounts WHERE id=?", (id,)).fetchone()
        if not current or current["email"] != a["email"] or current["provider"] != a["provider"]:
            raise HTTPException(409, "Account changed; refresh sender settings")
        data = {**load(db, a), "provider": list(dict.fromkeys(discovered))}
        db.execute(
            "INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key(a), json.dumps(data)),
        )
    return view(a, data)
