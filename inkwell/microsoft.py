"""Microsoft public-client device authorization and delegated Graph mail access.

No client secret or Microsoft password is collected. Public app registration is required.
"""

import json
from contextlib import nullcontext
from email.errors import HeaderParseError
import os
import re
import secrets
import threading
import time
from datetime import datetime, timezone
from email.headerregistry import Address
from pathlib import Path
from typing import Literal
from urllib.parse import quote, urlparse

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import store

router = APIRouter(prefix="/api/microsoft")
AUTH_ROOT = "https://login.microsoftonline.com"
AUTH = AUTH_ROOT + "/common/oauth2/v2.0"
GRAPH = "https://graph.microsoft.com/v1.0"
SCOPES = "offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send"
FLOWS = {}
FLOW_LOCK = threading.Lock()
TOKEN_LOCK = threading.Lock()
OAUTH_CONFIG = Path(__file__).with_name("oauth.json")
CLIENT_ID_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"


def publisher_client_id():
    """Public publisher identifier, never a secret or another application's ID."""
    try:
        value = os.environ.get("INKWELL_MICROSOFT_CLIENT_ID")
        if value is None:
            value = json.loads(OAUTH_CONFIG.read_text())["microsoft_client_id"]
        if not isinstance(value, str):
            raise ValueError("Invalid publisher configuration")
        value = value.strip()
        if value and not re.fullmatch(CLIENT_ID_PATTERN, value):
            raise ValueError("Invalid publisher identifier")
        return value
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise HTTPException(
            503, "Microsoft publisher configuration is invalid. Contact the app publisher."
        ) from error


@router.get("/config")
def configuration():
    return {"configured": bool(publisher_client_id())}


def client():
    return httpx.Client(timeout=30, follow_redirects=False, trust_env=False)


class Begin(BaseModel):
    client_id: str | None = Field(default=None, pattern=CLIENT_ID_PATTERN)
    account_type: Literal["any", "consumer", "organization"] = "any"


def authority(account_type: str):
    tenant = {"consumer": "consumers", "organization": "organizations"}.get(account_type, "common")
    return f"{AUTH_ROOT}/{tenant}/oauth2/v2.0"


@router.post("/begin")
def begin(data: Begin):
    client_id = publisher_client_id() or data.client_id
    if not client_id:
        raise HTTPException(
            503,
            "Microsoft sign-in is not configured by the inkwell publisher yet. No password is needed; an inkwell application registration is required.",
        )
    auth = authority(data.account_type)
    with FLOW_LOCK:
        FLOWS.clear()  # Single-user workspace: a new sign-in cancels the previous flow.
        try:
            with client() as http:
                response = http.post(
                    auth + "/devicecode", data={"client_id": client_id, "scope": SCOPES}
                )
                response.raise_for_status()
                flow = response.json()
            flow_id = secrets.token_urlsafe(24)
            expires = time.time() + min(int(flow["expires_in"]), 1800)
            interval = max(5, int(flow.get("interval", 5)))
            FLOWS[flow_id] = {
                "client_id": client_id,
                "auth": auth,
                "device_code": flow["device_code"],
                "expires": expires,
                "interval": interval,
                "next_poll": time.time() + interval,
            }
            verification_uri = flow.get("verification_uri")
            if verification_uri not in {
                "https://www.microsoft.com/link",
                "https://microsoft.com/devicelogin",
                "https://www.microsoft.com/devicelogin",
            }:
                FLOWS.pop(flow_id, None)
                raise ValueError("Unexpected Microsoft verification URL")
            return {
                "id": flow_id,
                "user_code": flow["user_code"],
                "verification_uri": verification_uri,
                "expires_in": int(expires - time.time()),
                "interval": interval,
            }
        except Exception as error:
            raise HTTPException(
                502,
                "Microsoft sign-in could not start. Check the application client ID, supported account types, public-client setting and network.",
            ) from error


def credentials(token):
    return {
        "access_token": token["access_token"],
        "refresh_token": token.get("refresh_token", ""),
        "expires_at": time.time() + int(token.get("expires_in", 3600)),
    }


@router.post("/{flow_id}/poll")
def poll(flow_id: str):
    with FLOW_LOCK:
        flow = FLOWS.get(flow_id)
        if not flow or flow["expires"] <= time.time():
            FLOWS.pop(flow_id, None)
            raise HTTPException(410, "Sign-in expired or was cancelled. Start again.")
        if "completed" in flow:
            return {"status": "complete", **flow["completed"]}
        if time.time() < flow["next_poll"]:
            return {"status": "pending", "interval": flow["interval"]}
        flow["next_poll"] = time.time() + flow["interval"]
        try:
            with client() as http:
                response = http.post(
                    flow.get("auth", AUTH) + "/token",
                    data={
                        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                        "client_id": flow["client_id"],
                        "device_code": flow["device_code"],
                    },
                )
                token = response.json()
                if token.get("error") in ("authorization_pending", "slow_down"):
                    if token["error"] == "slow_down":
                        flow["interval"] += 5
                        flow["next_poll"] = time.time() + flow["interval"]
                    return {"status": "pending", "interval": flow["interval"]}
                if token.get("error"):
                    FLOWS.pop(flow_id, None)
                    raise HTTPException(
                        400,
                        "Microsoft did not authorize this connection. Check consent, application account types and public-client settings, then try again.",
                    )
                response.raise_for_status()
                if not token.get("refresh_token"):
                    raise ValueError("Missing offline authorization")
                profile = http.get(
                    GRAPH + "/me?$select=displayName,mail,userPrincipalName",
                    headers={"Authorization": "Bearer " + token["access_token"]},
                )
                profile.raise_for_status()
                profile = profile.json()
            email = profile.get("mail") or profile.get("userPrincipalName")
            if not email or "@" not in email or "\n" in email or "\r" in email:
                raise ValueError("No usable email address")
            with store.db() as db:
                cursor = db.execute(
                    """INSERT INTO accounts(name,email,imap_host,imap_port,smtp_host,smtp_port,username,secret,smtp_security,provider,client_id)
                    VALUES (?,?, '',993,'',587,?,?,'starttls','microsoft',?)""",
                    (
                        profile.get("displayName") or email,
                        email,
                        email,
                        store.seal(json.dumps(credentials(token))),
                        flow["client_id"],
                    ),
                )
                from . import addresses

                addresses.remember(db, email, display_name=profile.get("displayName") or email)
                result = {"account_id": cursor.lastrowid, "email": email}
            flow["completed"] = result
            flow.pop("device_code", None)
            return {"status": "complete", **result}
        except HTTPException:
            raise
        except Exception as error:
            FLOWS.pop(flow_id, None)
            raise HTTPException(
                502,
                "Microsoft connection could not be completed. Check your network and permission consent, then start again.",
            ) from error


@router.delete("/{flow_id}")
def cancel(flow_id: str):
    with FLOW_LOCK:
        FLOWS.pop(flow_id, None)
    return {"ok": True}


def access_token(account):
    with TOKEN_LOCK:
        with store.db() as db:
            row = db.execute(
                "SELECT secret FROM accounts WHERE id=? AND provider='microsoft' AND email=?",
                (account["id"], account["email"]),
            ).fetchone()
        if not row:
            raise ValueError("Account disconnected")
        token = json.loads(store.unseal(row["secret"]))
        if token["expires_at"] > time.time() + 120:
            return token["access_token"]
        with client() as http:
            response = http.post(
                AUTH + "/token",
                data={
                    "grant_type": "refresh_token",
                    "client_id": account["client_id"],
                    "refresh_token": token["refresh_token"],
                    "scope": SCOPES,
                },
            )
            response.raise_for_status()
            fresh = response.json()
        updated = credentials(fresh)
        updated["refresh_token"] = fresh.get("refresh_token") or token["refresh_token"]
        with store.db() as db:
            if not db.execute(
                "UPDATE accounts SET secret=? WHERE id=? AND provider='microsoft' AND email=? AND secret=?",
                (store.seal(json.dumps(updated)), account["id"], account["email"], row["secret"]),
            ).rowcount:
                raise ValueError("Account disconnected")
        return updated["access_token"]


def sync_account(
    account,
    folder=None,
    trusted_only=False,
    *,
    max_pages=2,
    on_page=None,
    cancel=None,
    start_url=None,
    delta=False,
    on_cursor=None,
    stop_when_known=False,
    http_client=None,
):
    from .mail import TextExtractor
    from .message_keys import sender_key
    from email.utils import quote as quote_display_name

    trusted = set()
    if trusted_only:
        with store.db() as db:
            trusted = {r[0] for r in db.execute("SELECT sender_key FROM not_junk_senders")}
        if not trusted:
            return 0

    headers = {
        "Authorization": "Bearer " + access_token(account),
        "Prefer": 'outlook.body-content-type="html", IdType="ImmutableId"',
    }
    count = 0
    if folder is None:
        with store.db() as db:
            folder = db.execute(
                "SELECT * FROM remote_folders WHERE account_id=? AND well_known='inbox'",
                (account["id"],),
            ).fetchone()
    remote_id = folder["remote_id"] if folder else "inbox"
    local_folder = "inbox" if not folder or folder["well_known"] == "inbox" else "remote"
    url = (
        GRAPH
        + "/me/mailFolders/"
        + quote(remote_id, safe="")
        + "/messages?$top=100&$orderby=receivedDateTime%20desc&$select=id,from,toRecipients,ccRecipients,bccRecipients,subject,body,receivedDateTime,isRead,flag"
    )
    if delta:
        url = url.replace("/messages?$top=100&", "/messages/delta?")
        headers["Prefer"] += ", odata.maxpagesize=100"
    if start_url:
        url = start_url

    def validate_url(value):
        parsed = urlparse(value)
        if (
            parsed.scheme != "https"
            or parsed.netloc != "graph.microsoft.com"
            or not parsed.path.startswith("/v1.0/me/")
        ):
            raise ValueError("Unexpected Graph pagination URL")

    validate_url(url)
    with nullcontext(http_client) if http_client is not None else client() as http:
        seen = set()
        for _ in range(max_pages):
            if cancel is not None and cancel.is_set():
                raise InterruptedError("Sync stopped")
            if url in seen:
                raise ValueError("Repeated Graph pagination URL")
            seen.add(url)
            before = count
            headers["Authorization"] = "Bearer " + access_token(account)
            response = http.get(url, headers=headers)
            response.raise_for_status()
            data = response.json()
            known = False
            for message in data.get("value", []):
                if "@removed" in message:
                    continue
                if delta and not all(
                    k in message
                    for k in (
                        "body",
                        "subject",
                        "from",
                        "toRecipients",
                        "ccRecipients",
                        "bccRecipients",
                        "receivedDateTime",
                        "isRead",
                        "flag",
                    )
                ):
                    detail = http.get(
                        GRAPH + "/me/messages/" + quote(message["id"], safe=""), headers=headers
                    )
                    if detail.status_code == 404:
                        continue
                    detail.raise_for_status()
                    message = detail.json()
                sender = (message.get("from") or {}).get("emailAddress") or {}
                try:
                    sender = str(
                        Address(
                            display_name=sender.get("name") or "",
                            addr_spec=sender.get("address") or "",
                        )
                    )
                except (ValueError, IndexError, HeaderParseError):
                    name = quote_display_name(str(sender.get("name") or ""))
                    sender = f'"{name}" <{sender.get("address", "")}>'
                if sender == "<>":
                    sender = "(Unknown sender)"
                if trusted_only and sender_key(sender) not in trusted:
                    continue
                recipient = ", ".join(
                    (r.get("emailAddress") or {}).get("address") or ""
                    for r in (message.get("toRecipients") or [])
                )
                cc = ", ".join(
                    (r.get("emailAddress") or {}).get("address") or ""
                    for r in (message.get("ccRecipients") or [])
                )
                bcc = ", ".join(
                    (r.get("emailAddress") or {}).get("address") or ""
                    for r in (message.get("bccRecipients") or [])
                )
                body = message.get("body") or {}
                text = body.get("content") or ""
                html_body = (
                    text[:500000] if (body.get("contentType") or "").lower() == "html" else ""
                )
                if (body.get("contentType") or "").lower() == "html":
                    extractor = TextExtractor()
                    extractor.feed(text)
                    text = "".join(extractor.parts)
                with store.db() as db:
                    db.execute("BEGIN IMMEDIATE")
                    if (
                        trusted_only
                        and not db.execute(
                            "SELECT 1 FROM not_junk_senders WHERE sender_key=?",
                            (sender_key(sender),),
                        ).fetchone()
                    ):
                        continue
                    # Account may have been disconnected while the network request ran.
                    if not db.execute(
                        "SELECT 1 FROM accounts WHERE id=? AND email=? AND provider='microsoft'",
                        (account["id"], account["email"]),
                    ).fetchone():
                        raise ValueError("Account disconnected")
                    cursor = db.execute(
                        """INSERT OR IGNORE INTO messages(account_id,remote_key,sender,recipient,subject,body,date,unread,starred,folder,remote_folder_id,cc,bcc)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (
                            account["id"],
                            f"{account['id']}:graph:{message['id']}",
                            sender,
                            recipient,
                            message.get("subject") or "(No subject)",
                            text[:500000],
                            message.get("receivedDateTime")
                            or datetime.now(timezone.utc).isoformat(),
                            int(not message.get("isRead", False)),
                            int((message.get("flag") or {}).get("flagStatus") == "flagged"),
                            local_folder,
                            folder["id"] if folder else None,
                            cc,
                            bcc,
                        ),
                    )
                    from . import addresses

                    if cursor.rowcount:
                        addresses.remember(db, sender, recipient, cc, bcc)
                    else:
                        known = True
                    count += cursor.rowcount
                    if cursor.rowcount:
                        from . import rules

                        rules.apply(db, cursor.lastrowid)
                    db.execute(
                        "UPDATE messages SET html_body=?,body=? WHERE account_id=? AND remote_key=? AND draft_key IS NULL AND (html_body IS NOT ? OR body IS NOT ?)",
                        (
                            html_body,
                            text[:500000],
                            account["id"],
                            f"{account['id']}:graph:{message['id']}",
                            html_body,
                            text[:500000],
                        ),
                    )
                    if delta:
                        db.execute(
                            """UPDATE messages SET sender=?,recipient=?,cc=?,bcc=?,subject=?,date=coalesce(?,date)
                          WHERE account_id=? AND remote_key=? AND draft_key IS NULL""",
                            (
                                sender,
                                recipient,
                                cc,
                                bcc,
                                message.get("subject") or "(no subject)",
                                message.get("receivedDateTime"),
                                account["id"],
                                f"{account['id']}:graph:{message['id']}",
                            ),
                        )
                    if folder:
                        db.execute(
                            """UPDATE messages SET remote_folder_id=?,folder=CASE WHEN local_folder_override=0 AND folder IN ('inbox','remote') THEN ? ELSE folder END
                            WHERE account_id=? AND remote_key=?""",
                            (
                                folder["id"],
                                local_folder,
                                account["id"],
                                f"{account['id']}:graph:{message['id']}",
                            ),
                        )
            if on_page is not None:
                on_page(count - before)
            url = data.get("@odata.nextLink")
            checkpoint = data.get("@odata.deltaLink")
            if url:
                validate_url(url)
            if checkpoint:
                validate_url(checkpoint)
            if on_cursor is not None:
                on_cursor(url, checkpoint)
            if not url or (stop_when_known and known):
                break
            # Never forward the bearer token to an arbitrary nextLink host/path.
            parsed = urlparse(url)
            if (
                parsed.scheme != "https"
                or parsed.netloc != "graph.microsoft.com"
                or not parsed.path.startswith("/v1.0/me/")
            ):
                raise ValueError("Unexpected Graph pagination URL")
        else:
            if on_page is not None and max_pages > 2 and url:
                raise ValueError("Folder pagination safety limit reached")
    return count


def send_mail(account, recipient, subject, body, cc="", bcc=""):
    from . import addresses

    def recipients(value):
        return [{"emailAddress": {"address": address}} for _, address in addresses.parse(value)]

    with client() as http:
        result = http.post(
            GRAPH + "/me/sendMail",
            headers={"Authorization": "Bearer " + access_token(account)},
            json={
                "message": {
                    "from": {
                        "emailAddress": {"address": account.get("send_from", account["email"])}
                    },
                    "subject": subject,
                    "body": {"contentType": "Text", "content": body},
                    "toRecipients": recipients(recipient),
                    "ccRecipients": recipients(cc),
                    "bccRecipients": recipients(bcc),
                },
                "saveToSentItems": True,
            },
        )
        if result.status_code == 403:
            raise HTTPException(
                403,
                "Microsoft did not authorize this sender or mail submission. Check the selected From address and mailbox permissions. No fallback sender was attempted.",
            )
        if result.status_code != 202:
            result.raise_for_status()
            raise ValueError("Graph did not accept message")
