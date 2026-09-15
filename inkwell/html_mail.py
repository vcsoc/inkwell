"""Script-free isolated HTML previews. No remote requests are made by the backend."""

import html
import ipaddress
import re
from urllib.parse import urlsplit, urlunsplit

import nh3
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse

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


def text_links(body, blocked_host=""):
    links = []
    for match in re.finditer(r'https?://[^\s<>"\x27]+', body):
        text = match.group().rstrip(".,;:!?)]}")
        url = link_url(text, blocked_host)
        if url:
            links.append(
                {"start": match.start(), "end": match.start() + len(text), "text": text, "url": url}
            )
        if len(links) >= 500:
            break
    return links


def sanitize(source, allowed=(), blocked_host="", reader_colors=False, links=False):
    origins = set()
    blocked = 0

    def attribute(tag, attr, value):
        nonlocal blocked
        if attr == "style":
            if re.search(r"url|expression|image|var\s*\(|attr\s*\(|[@\\]", value, re.I):
                return None
        if tag == "a" and attr == "href":
            return link_url(value, blocked_host) if links else None
        if tag == "img" and attr == "src":
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
        source[:500000],
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
        url_schemes={"http", "https"} if links else {"https"},
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
    return {
        "has_html": bool(row["html_body"]),
        "needs_sync": row["html_body"] is None and bool(row["remote_key"]),
        "origins": origins,
        "blocked_images": blocked,
        "text_links": text_links(row["body"], request.url.hostname or ""),
    }


@router.get("/{message_id}/html")
def preview(
    message_id: int,
    request: Request,
    allow: list[str] = Query(default=[]),
    appearance: Literal["theme", "light", "dark"] = "theme",
    links: bool = False,
):
    row = message(message_id)
    if len(allow) > 50:
        raise HTTPException(422, "Too many image origins")
    host = request.url.hostname or ""
    _, origins, _ = sanitize(row["html_body"] or "", blocked_host=host)
    if any(origin not in origins for origin in allow):
        raise HTTPException(400, "Image origin is not part of this message")
    body, _, _ = sanitize(
        row["html_body"] or "",
        allowed=set(allow),
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
    if not row["html_body"]:
        body = "<pre>" + html.escape(row["body"]) + "</pre>"
    policy = (
        "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src "
        + (" ".join(allow) if allow else "'none'")
        + "; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox"
        + (" allow-popups allow-popups-to-escape-sandbox" if links else "")
    )
    return HTMLResponse(
        '<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style>body{margin:0;padding:16px;font:16px system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre{white-space:pre-wrap}table{max-width:100%}'
        + colors
        + "</style></head><body>"
        + body
        + "</body></html>",
        headers={
            "Content-Security-Policy": policy,
            "X-Frame-Options": "SAMEORIGIN",
            "Referrer-Policy": "no-referrer",
            "Cache-Control": "no-store",
        },
    )
