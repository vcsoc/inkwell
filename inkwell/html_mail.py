"""Script-free isolated HTML previews. No remote requests are made by the backend."""

import base64
import hashlib
import html
import io
import ipaddress
import json
import re
import secrets
from pathlib import Path
from functools import lru_cache
from urllib.parse import parse_qs, urlsplit, urlunsplit

import nh3
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from PIL import Image, UnidentifiedImageError

from . import store, preferences
from typing import Literal

router = APIRouter(prefix="/api/messages")
TAGS = {
    "p",
    "div",
    "span",
    "br",
    "hr",
    "b",
    "strong",
    "i",
    "em",
    "u",
    "s",
    "small",
    "big",
    "sub",
    "sup",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "pre",
    "code",
    "ul",
    "ol",
    "li",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "td",
    "th",
    "caption",
    "colgroup",
    "col",
    "a",
    "img",
    "center",
}
STYLES = {
    "color",
    "background-color",
    "font-size",
    "font-family",
    "font-weight",
    "font-style",
    "text-align",
    "text-decoration",
    "line-height",
    "padding",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "margin",
    "margin-top",
    "margin-bottom",
    "border",
    "border-color",
    "border-width",
    "border-style",
    "border-collapse",
    "width",
    "max-width",
    "height",
    "vertical-align",
    "white-space",
}


def image_url(value, blocked_host="", schemes=("https",), preserve_fragment=False):
    if re.search(r"[\s\\\x00-\x1f\x7f]", value):
        return None
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or "").encode("idna").decode().lower().rstrip(".")
        if (
            parsed.scheme not in schemes
            or parsed.username
            or parsed.password
            or parsed.port not in (None, 443 if parsed.scheme == "https" else 80)
        ):
            return None
        if (
            host == blocked_host.lower().rstrip(".")
            or host == "localhost"
            or host.endswith((".localhost", ".local", ".internal"))
        ):
            return None
        try:
            if not ipaddress.ip_address(host).is_global:
                return None
        except ValueError:
            if (
                "." not in host
                or not re.fullmatch(r"[a-z0-9.-]+", host)
                or not re.fullmatch(r"(?:[a-z]{2,}|xn--[a-z0-9-]+)", host.rsplit(".", 1)[-1])
            ):
                return None
        netloc = "[" + host + "]" if ":" in host else host
        return urlunsplit(
            (
                parsed.scheme,
                netloc,
                parsed.path,
                parsed.query,
                parsed.fragment if preserve_fragment else "",
            )
        )
    except (ValueError, UnicodeError):
        return None


def reader_link_color(background):
    def luminance(color):
        values = [int(color[i : i + 2], 16) / 255 for i in (1, 3, 5)]
        values = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in values]
        return sum(v * w for v, w in zip(values, (0.2126, 0.7152, 0.0722)))

    bg = luminance(background)

    def contrast(color):
        fg = luminance(color)
        return (max(bg, fg) + 0.05) / (min(bg, fg) + 0.05)

    colors = ["#005ac6", "#75bcff"]
    best = max(colors, key=contrast)
    return best if contrast(best) >= 4.5 else max(["#000000", "#ffffff"], key=contrast)


def link_url(value, blocked_host=""):
    if len(value) > 8192:
        return None
    url = image_url(value, blocked_host, ("http", "https"), True)
    if url:
        try:
            ipaddress.ip_address(urlsplit(url).hostname)
        except ValueError:
            return url
    return None


def outlook_target(value, blocked_host=""):
    """Extract a display label only; retain Microsoft's actual Safe Links href."""
    if not link_url(value, blocked_host):
        return None
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not re.fullmatch(
            r"(?:[a-z0-9-]+\.)?safelinks\.protection\.outlook\.com",
            (parsed.hostname or "").lower(),
        )
        or parsed.path not in ("", "/")
        or parsed.fragment
    ):
        return None
    try:
        targets = parse_qs(parsed.query, max_num_fields=12).get("url", [])
    except ValueError:
        return None
    return link_url(targets[0], blocked_host) if len(targets) == 1 else None


def readable_outlook_links(source, blocked_host=""):
    # Exchange wraps plain-text URLs in simple anchor tags. Only rewrite their
    # *visible text* when it exactly matches the protected href. The original
    # href is kept so Microsoft's reputation/redirect service still applies.
    anchor = re.compile(
        r"(<a\b[^>]*?\bhref\s*=\s*([\"'])([^\"']+)\2[^>]*>)([^<>]*)(</a\s*>)",
        re.IGNORECASE,
    )

    def replace(match):
        href = html.unescape(match.group(3))
        if html.unescape(match.group(4)).strip() != href:
            return match.group(0)
        target = outlook_target(href, blocked_host)
        if not target:
            return match.group(0)
        display = target if len(target) <= 220 else target[:217] + "…"
        return match.group(1) + html.escape(display, quote=False) + match.group(5)

    return anchor.sub(replace, source[:500000])


def text_links(body, blocked_host=""):
    links = []
    for match in re.finditer(r'https?://[^\s<>"\x27]+', body):
        text = match.group().rstrip(".,;:!?)]}")
        url = link_url(text, blocked_host)
        if url:
            item = {"start": match.start(), "end": match.start() + len(text), "text": text, "url": url}
            if display := outlook_target(url, blocked_host):
                item["display"] = display if len(display) <= 220 else display[:217] + "…"
            links.append(item)
        if len(links) >= 500:
            break
    return links


def sanitize(source, allowed=(), blocked_host="", reader_colors=False, links=False, inline_images=None):
    origins = set()
    blocked = 0

    def attribute(tag, attr, value):
        nonlocal blocked
        if attr == "style":
            if links and tag == "a":
                value = re.sub(
                    r"(?:^|;)\s*text-decoration(?:-[a-z]+)?\s*:[^;]*", "", value, flags=re.I
                )
            if re.search(r"url|expression|image|var\s*\(|attr\s*\(|[@\\]", value, re.I):
                return None
        if tag == "a" and attr == "href":
            return link_url(value, blocked_host) if links else None
        if tag == "img" and attr == "src":
            if inline_images and value.lower().startswith("cid:"):
                return inline_images.get(value[4:].strip("<>").casefold())
            url = image_url(value, blocked_host)
            if url:
                origin = "https://" + urlsplit(url).netloc
                origins.add(origin)
                if origin in allowed:
                    return url
            blocked += 1
            return None
        return value

    result = nh3.clean(
        readable_outlook_links(source, blocked_host),
        tags=TAGS,
        clean_content_tags={
            "script",
            "style",
            "iframe",
            "object",
            "embed",
            "svg",
            "math",
            "form",
            "template",
            "noscript",
        },
        attributes={
            "*": {"style", "title", "align"},
            "img": {"src", "alt", "width", "height"},
            "a": {"href"} if links else set(),
            "table": {"width", "cellpadding", "cellspacing", "border"},
            "td": {"colspan", "rowspan", "width", "height", "valign"},
            "th": {"colspan", "rowspan"},
            "ol": {"start"},
        },
        attribute_filter=attribute,
        filter_style_properties=STYLES - {"color", "background-color", "border-color"}
        if reader_colors
        else STYLES,
        url_schemes={"http", "https", "cid", "data"} if inline_images else {"http", "https"} if links else {"https"},
        link_rel="noopener noreferrer",
        set_tag_attribute_values={"a": {"target": "_blank"}} if links else {},
        url_relative="deny",
    )
    return result, sorted(origins), blocked


def message(id):
    with store.db() as db:
        row = db.execute(
            "SELECT html_body,body,remote_key FROM messages WHERE id=?", (id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Message not found")
    return row


@router.get("/{message_id}/preview-info")
def preview_info(message_id: int, request: Request):
    row = message(message_id)
    _, origins, blocked = sanitize(row["html_body"] or "", blocked_host=request.url.hostname or "")
    with store.db() as db:
        saved = db.execute("SELECT origins FROM message_remote_content WHERE message_id=?", (message_id,)).fetchone()
    return {
        "saved_origins": json.loads(saved[0]) if saved else [],
        "has_html": bool(row["html_body"]),
        "needs_sync": row["html_body"] is None and bool(row["remote_key"]),
        "origins": origins,
        "blocked_images": blocked,
        "text_links": text_links(row["body"], request.url.hostname or ""),
    }


class RemoteContentChoice(BaseModel):
    origins: list[str] = Field(max_length=50)


@router.put("/{message_id}/remote-content")
def remember_remote_content(message_id: int, choice: RemoteContentChoice, request: Request):
    row = message(message_id)
    _, origins, _ = sanitize(row["html_body"] or "", blocked_host=request.url.hostname or "")
    selected = choice.origins
    if len(selected) != len(set(selected)) or any(origin not in origins for origin in selected if origin != "*") or ("*" in selected and selected != ["*"]):
        raise HTTPException(422, "Choose only image origins listed in this message")
    with store.db() as db:
        db.execute("INSERT INTO message_remote_content(message_id,origins) VALUES (?,?) ON CONFLICT(message_id) DO UPDATE SET origins=excluded.origins", (message_id, json.dumps(selected)))
    return {"origins": selected}


@lru_cache(maxsize=12)
def embedded_images(message_id, revision):
    """Re-encode explicitly requested Outlook CID images as inert inline PNGs."""
    from . import calendar_import

    mail = calendar_import.message_mime(message_id)
    images = {}
    total = 0
    for index, part in enumerate(mail.walk()):
        if index >= 300 or len(images) >= 30 or total >= 3_000_000:
            break
        cid = (part.get("Content-ID") or "").strip("<>").casefold()
        if not cid or part.get_content_type() not in {"image/png", "image/jpeg", "image/webp", "image/gif"}:
            continue
        payload = part.get_payload(decode=True)
        if not payload or len(payload) > 1_000_000:
            continue
        try:
            with Image.open(io.BytesIO(payload)) as image:
                if image.width * image.height > 4_000_000 or image.width < 1 or image.height < 1:
                    continue
                output = io.BytesIO()
                image.convert("RGBA" if "A" in image.getbands() else "RGB").save(output, format="PNG")
                data = output.getvalue()
        except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError):
            continue
        if len(data) > 1_000_000 or total + len(data) > 3_000_000:
            continue
        images[cid] = "data:image/png;base64," + base64.b64encode(data).decode("ascii")
        total += len(data)
    return images


@router.get("/{message_id}/html")
def preview(
    message_id: int,
    request: Request,
    allow: list[str] = Query(default=[]),
    appearance: Literal["theme", "light", "dark"] = "theme",
    links: bool = False,
    inline: bool = False,
    q: str = Query(default="", max_length=200),
    translation: str = Query(default="", pattern=r"^(?:[a-f0-9]{32})?$"),
):
    row = message(message_id)
    if len(allow) > 50:
        raise HTTPException(422, "Too many image origins")
    host = request.url.hostname or ""
    _, origins, _ = sanitize(row["html_body"] or "", blocked_host=host)
    if any(origin not in origins for origin in allow):
        raise HTTPException(400, "Image origin is not part of this message")
    images = {}
    if inline and "cid:" in (row["html_body"] or "").lower():
        try:
            images = embedded_images(message_id, hashlib.sha256((row["html_body"] or "").encode()).hexdigest())
        except HTTPException:
            # A disconnected account can still display ordinary safe HTML.
            pass
    body, _, _ = sanitize(
        row["html_body"] or "",
        allowed=set(allow),
        inline_images=images,
        blocked_host=host,
        reader_colors=True,
        links=links,
    )
    theme = preferences.get_preferences()["theme"]
    bg, fg, line = theme["surface"], theme["text"], theme["border"]
    if appearance == "dark" and not theme["dark"]:
        bg, fg, line = "#202731", "#edf1f7", "#394452"
    if appearance == "light" and theme["dark"]:
        bg, fg, line = "#ffffff", "#292e2b", "#e7e8e1"
    colors = f"html,body{{background:{bg};color:{fg};color-scheme:{'dark' if appearance == 'dark' or (appearance == 'theme' and theme['dark']) else 'light'}}}body *{{color:{fg}!important;background-color:transparent!important;border-color:{line}!important}}body{{font-size:{theme['font_size']}px}}"
    link_color = reader_link_color(bg)
    colors += f"body a[href],body a[href] *{{color:{link_color}!important}}body a[href]{{text-decoration:underline!important;text-decoration-thickness:2px!important;text-underline-offset:.18em!important;cursor:pointer}}body a[href]:hover{{text-decoration-thickness:3px!important}}body a[href]:focus-visible{{outline:2px solid {link_color};outline-offset:3px;border-radius:2px}}"
    if not row["html_body"]:
        body = "<pre>" + html.escape(row["body"]) + "</pre>"
    from .search_highlights import highlight

    body = highlight(body, q)
    colors += "body mark[data-search-hit],body a[href] mark[data-search-hit]{background-color:#ffdf68!important;color:#17212b!important;border-radius:2px}"
    bridge = ''
    nonce = secrets.token_urlsafe(24) if translation else ''
    if translation:
        static = Path(__file__).with_name('static')
        code = (static / 'translation-core.js').read_text() + '\n' + (static / 'translation-frame.js').read_text()
        bridge = f'<script nonce="{nonce}" data-translation-token="{translation}">{code}</script>'
        body = '<div id="inkwell-mail-body">' + body + '</div>'
        colors += (static / 'translation.css').read_text()
    script_policy = f"'nonce-{nonce}'" if translation else "'none'"
    policy = (
        f"default-src 'none'; script-src {script_policy}; style-src 'unsafe-inline'; img-src "
        + (" ".join([*allow, *(["data:"] if images else [])]) if allow or images else "'none'")
        + "; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox"
        + (" allow-scripts" if translation else "")
        + (" allow-popups allow-popups-to-escape-sandbox" if links else "")
    )
    return HTMLResponse(
        '<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style>body{margin:0;padding:16px;font:16px system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre{white-space:pre-wrap}table{max-width:100%}'
        + colors
        + "</style></head><body>"
        + body
        + bridge
        + "</body></html>",
        headers={
            "Content-Security-Policy": policy,
            "X-Frame-Options": "SAMEORIGIN",
            "Referrer-Policy": "no-referrer",
            "Cache-Control": "no-store",
        },
    )
