"""TLS-only mail transport. Synchronization never mutates the remote mailbox."""

import imaplib
import smtplib
import ssl
from datetime import datetime, timezone
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser

from .store import db, unseal
from . import rules, addresses


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1
        if tag in ("br", "p", "div", "tr", "li"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def body_text(message):
    part = message.get_body(preferencelist=("plain", "html"))
    if part is None:
        return "[This message has no readable text body.]"
    try:
        text = part.get_content()
    except (LookupError, UnicodeError):
        text = part.get_payload(decode=True).decode("utf-8", errors="replace")
    if part.get_content_type() == "text/html":
        parser = TextExtractor()
        parser.feed(text)
        return "".join(parser.parts).strip()
    return text


def body_html(message):
    part = message.get_body(preferencelist=("html",))
    if part is None or part.get_content_type() != "text/html":
        return ""
    try:
        return part.get_content()[:500000]
    except (LookupError, UnicodeError):
        return (part.get_payload(decode=True) or b"").decode("utf-8", errors="replace")[:500000]


def sync_account(account):
    count = 0
    with imaplib.IMAP4_SSL(
        account["imap_host"],
        account["imap_port"],
        ssl_context=ssl.create_default_context(),
        timeout=25,
    ) as client:
        client.login(account["username"], unseal(account["secret"]))
        status, _ = client.select("INBOX", readonly=True)
        if status != "OK":
            raise ValueError("Unable to open INBOX")
        validity = client.response("UIDVALIDITY")[1][0]
        if not validity:
            raise ValueError("Server did not provide UIDVALIDITY")
        status, data = client.uid("search", None, "ALL")
        if status != "OK":
            raise ValueError("Unable to search INBOX")
        for uid in data[0].split()[-200:]:
            key = f"{account['id']}:INBOX:{validity.decode()}:{uid.decode()}"
            with db() as conn:
                cached = conn.execute(
                    "SELECT html_body FROM messages WHERE remote_key=?", (key,)
                ).fetchone()
                if cached and cached["html_body"] is not None:
                    continue
            status, meta = client.uid("fetch", uid, "(RFC822.SIZE)")
            if status != "OK":
                continue
            import re

            sizes = re.findall(
                rb"RFC822.SIZE (\d+)", b" ".join(x for x in meta if isinstance(x, bytes))
            )
            if not sizes or int(sizes[0]) > 10_000_000:
                continue
            status, raw = client.uid("fetch", uid, "(BODY.PEEK[] FLAGS)")
            if status != "OK":
                continue
            payload = next((x for x in raw if isinstance(x, tuple)), None)
            if payload is None:
                continue
            msg = BytesParser(policy=policy.default).parsebytes(payload[1])
            try:
                date = parsedate_to_datetime(msg.get("Date", ""))
                if date.tzinfo is None:
                    date = date.replace(tzinfo=timezone.utc)
                date = date.astimezone(timezone.utc).isoformat()
            except (ValueError, TypeError, OverflowError):
                date = datetime.now(timezone.utc).isoformat()
            metadata = b" ".join(x[0] if isinstance(x, tuple) else x for x in raw if x)
            with db() as conn:
                cursor = conn.execute(
                    """INSERT OR IGNORE INTO messages
                    (account_id,remote_key,sender,recipient,subject,body,date,unread,html_body,cc,bcc)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        account["id"],
                        key,
                        str(msg.get("From", "Unknown")),
                        str(msg.get("To", "")),
                        str(msg.get("Subject", "(No subject)")),
                        body_text(msg)[:500_000],
                        date,
                        int(b"\\Seen" not in metadata),
                        body_html(msg),
                        str(msg.get("Cc", "")),
                        str(msg.get("Bcc", "")),
                    ),
                )
                from .attachment_status import record, imap_hint

                row = conn.execute("SELECT id FROM messages WHERE remote_key=?", (key,)).fetchone()
                if row:
                    record(conn, row["id"], imap_hint(msg))
                addresses.remember(
                    conn, *[str(msg.get(key, "")) for key in ("From", "To", "Cc", "Bcc")]
                )
                count += cursor.rowcount
                if cursor.rowcount:
                    rules.apply(conn, cursor.lastrowid)
                conn.execute(
                    "UPDATE messages SET html_body=? WHERE remote_key=? AND html_body IS NULL",
                    (body_html(msg), key),
                )
    return count


def send_mail(account, recipient, subject, body, cc="", bcc=""):
    message = EmailMessage()
    message["From"] = account["email"]
    if recipient:
        message["To"] = recipient
    if cc:
        message["Cc"] = cc
    message["Subject"] = subject
    from email.utils import formatdate, make_msgid

    message["Date"] = formatdate(localtime=True)
    # Avoid getfqdn() / reverse-DNS delays on desktop hosts without DNS records.
    message["Message-ID"] = make_msgid(domain=account["email"].rsplit("@", 1)[-1])
    message.set_content(body)
    context = ssl.create_default_context()
    if account["smtp_security"] == "tls":
        client = smtplib.SMTP_SSL(
            account["smtp_host"], account["smtp_port"], timeout=25, context=context
        )
    else:
        client = smtplib.SMTP(account["smtp_host"], account["smtp_port"], timeout=25)
    with client:
        if account["smtp_security"] == "starttls":
            client.ehlo()
            client.starttls(context=context)
            client.ehlo()
        client.login(account["username"], unseal(account["secret"]))
        if bcc:
            envelope = [
                address for field in (recipient, cc, bcc) for _, address in addresses.parse(field)
            ]
            client.send_message(message, to_addrs=list(dict.fromkeys(envelope)))
        else:
            client.send_message(message)
