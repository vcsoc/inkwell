"""Validated composer content, shared by local drafts and both mail transports."""

import base64
import json
import re

import nh3
from pydantic import BaseModel, Field, model_validator

MAX_BYTES = 20 * 1024 * 1024


class Attachment(BaseModel):
    name: str = Field(min_length=1, max_length=255, pattern=r"^[^\r\n/\\\x00]+$")
    content_type: str = Field(
        default="application/octet-stream", pattern=r"^[a-zA-Z0-9!#$&^_.+-]+/[a-zA-Z0-9!#$&^_.+-]+$"
    )
    content: str = Field(max_length=28_000_000)
    content_id: str = Field(pattern=r"^[a-zA-Z0-9@._-]{1,120}$")
    inline: bool = False

    @model_validator(mode="after")
    def valid_content(self):
        try:
            raw = base64.b64decode(self.content, validate=True)
        except ValueError as error:
            raise ValueError("Attachment content is not valid base64") from error
        if len(raw) > MAX_BYTES:
            raise ValueError("Attachments are limited to 20 MB combined")
        if self.inline and self.content_type not in {
            "image/png",
            "image/jpeg",
            "image/gif",
            "image/webp",
        }:
            raise ValueError("This image format cannot be embedded inline")
        if self.inline:
            import io
            from PIL import Image

            try:
                with Image.open(io.BytesIO(raw)) as image:
                    if (
                        Image.MIME.get(image.format) != self.content_type
                        or image.width * image.height > 40_000_000
                        or max(image.size) > 16384
                    ):
                        raise ValueError("Inline image format or dimensions are not supported")
                    image.verify()
            except (OSError, SyntaxError, Image.DecompressionBombError) as error:
                raise ValueError("Inline image could not be decoded") from error
        return self


def prepare(html, files):
    if sum(len(base64.b64decode(f.content)) for f in files) > MAX_BYTES:
        raise ValueError("Attachments are limited to 20 MB combined")
    ids = [f.content_id for f in files]
    if len(set(ids)) != len(ids):
        raise ValueError("Attachment content IDs must be unique")
    if html is None:
        if any(f.inline for f in files):
            raise ValueError("Inline images require an HTML message body")
        return None
    inline_ids = {f.content_id for f in files if f.inline}

    from html.parser import HTMLParser

    class Sources(HTMLParser):
        def handle_starttag(self, tag, attrs):
            if tag == "img":
                src = dict(attrs).get("src", "")
                if not src.startswith("cid:") or src[4:] not in inline_ids:
                    raise ValueError("An inline image is missing its attachment")

    Sources().feed(html)

    def attribute(tag, name, value):
        if name in {"width", "height"} and not re.fullmatch(r"[1-9][0-9]{0,4}", value):
            return None
        return value

    return nh3.clean(
        html,
        tags={
            "p",
            "div",
            "br",
            "span",
            "strong",
            "b",
            "em",
            "i",
            "u",
            "s",
            "blockquote",
            "a",
            "ul",
            "ol",
            "li",
            "img",
        },
        attributes={"img": {"src", "alt", "width", "height"}, "a": {"href", "title"}},
        attribute_filter=attribute,
        url_schemes={"cid", "https", "http", "mailto"},
    )


def save(conn, message_id, data):
    from .attachment_status import record

    record(conn, message_id, bool(data.attachments))
    conn.execute("UPDATE messages SET html_body=? WHERE id=?", (data.html_body, message_id))
    conn.execute(
        "INSERT OR REPLACE INTO outgoing_files(message_id,files) VALUES (?,?)",
        (message_id, json.dumps([f.model_dump() for f in data.attachments])),
    )


def load(message_id):
    from . import store

    with store.db() as conn:
        row = conn.execute(
            "SELECT files FROM outgoing_files WHERE message_id=?", (message_id,)
        ).fetchone()
    return json.loads(row[0]) if row else []


def add_mime(message, html, files):
    if html is not None:
        message.add_alternative(html, subtype="html")
    html_part = message.get_payload()[-1] if html is not None else None
    for f in files:
        major, minor = f.content_type.split("/", 1)
        kwargs = dict(maintype=major, subtype=minor, filename=f.name)
        if f.inline and html is not None:
            html_part.add_related(
                base64.b64decode(f.content),
                cid="<" + f.content_id + ">",
                disposition="inline",
                **kwargs,
            )
        else:
            message.add_attachment(base64.b64decode(f.content), **kwargs)


def token(file):
    import hashlib

    return hashlib.sha256(file["content_id"].encode()).hexdigest()


def local_file(message_id, file_token):
    for file in load(message_id):
        if token(file) == file_token:
            return base64.b64decode(file["content"]), file["name"]
    return None


def manifest(message_id, message):
    from . import store

    with store.db() as conn:
        row = conn.execute(
            "SELECT files FROM outgoing_files WHERE message_id=?", (message_id,)
        ).fetchone()
    if row is None:
        return None
    files = json.loads(row[0])
    return {
        "complete": True,
        "connected": True,
        "scope": "message",
        "error": "",
        "pending": 0,
        "groups": [
            {
                "key": "local",
                "subject": message["subject"],
                "sender": message["sender"],
                "date": message["date"],
                "selected": True,
                "cached_only": False,
                "checked": True,
                "files": [
                    {
                        "id": token(f),
                        "name": f["name"],
                        "size": len(base64.b64decode(f["content"])),
                        "content_type": f["content_type"],
                        "inline": f["inline"],
                        "kind": "file",
                        "cached_only": False,
                        "downloadable": True,
                    }
                    for f in files
                ],
            }
        ],
    }
