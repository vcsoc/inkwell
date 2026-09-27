"""Local Documents editor. File access is confined to the user's Documents directory."""

import base64
import html
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

import nh3
import pymupdf
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor
from docx.table import Table
from docx.text.paragraph import Paragraph
from docx.text.run import Run
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response
from lxml import html as lxml_html
from markdown_it import MarkdownIt
from PIL import Image
from pydantic import BaseModel, Field

from . import store

router = APIRouter(prefix="/api/documents")
TEXT_EXT = {".txt", ".md", ".mdx", ".csv", ".tsv", ".yaml", ".yml", ".json", ".xml", ".toml", ".ini", ".log", ".py", ".js", ".css"}
RICH_EXT = {".docx", ".doc", ".odt", ".rtf", ".html", ".htm"}
FORMATS = TEXT_EXT | RICH_EXT | {".pdf"}
MAX_FILE = 40_000_000
MAX_HTML = 8_000_000
MAX_IMAGE = 5_000_000
HTML_TAGS = {"p", "div", "br", "strong", "b", "em", "i", "u", "s", "strike", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "code", "ul", "ol", "li", "table", "thead", "tbody", "tr", "td", "th", "a", "img", "font", "span", "hr", "sub", "sup"}
HTML_ATTRS = {"a": {"href", "title"}, "img": {"src", "alt", "width", "height"}, "font": {"color", "size", "face"}, "td": {"colspan", "rowspan"}, "th": {"colspan", "rowspan"}, "p": {"align"}, "div": {"align"}, "h1": {"align"}, "h2": {"align"}, "h3": {"align"}}
IMAGE_URL = re.compile(r"^data:image/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$", re.I)


def root():
    override = os.getenv("INKWELL_DOCUMENTS_DIR")
    if override:
        folder = Path(override).expanduser()
    else:
        folder = Path.home() / "Documents"
        config = Path.home() / ".config" / "user-dirs.dirs"
        try:
            match = re.search(r'^XDG_DOCUMENTS_DIR="([^"\n]+)"', config.read_text(), re.M)
            if match:
                folder = Path(match.group(1).replace("$HOME", str(Path.home()), 1)).expanduser()
        except OSError:
            pass
    folder.mkdir(parents=True, exist_ok=True)
    return folder.resolve()


def resolve(path="", *, expect=None):
    if not isinstance(path, str) or len(path) > 1600 or "\\" in path or "\x00" in path:
        raise HTTPException(422, "Invalid document path")
    parts = PurePosixPath(path).parts
    if path.startswith("/") or any(part in ("..", ".") or part.startswith(".") for part in parts):
        raise HTTPException(403, "Document path is outside Documents")
    base = root()
    target = base.joinpath(*parts)
    if not target.resolve().is_relative_to(base):
        raise HTTPException(403, "Document path is outside Documents")
    current = base
    for part in parts:
        current /= part
        if current.is_symlink():
            raise HTTPException(403, "Links are not available in Documents")
    if expect and (not target.exists() or (target.is_file() if expect == "dir" else target.is_dir())):
        raise HTTPException(404, "Document or folder not found")
    return target


def relative(path):
    return path.relative_to(root()).as_posix() if path != root() else ""


def name_ok(name):
    if not isinstance(name, str) or name in ("", ".", "..") or len(name) > 160 or any(c in name for c in "/\\\x00") or name.startswith(".") or any(ord(c) < 32 for c in name):
        raise HTTPException(422, "Choose a valid document or folder name")
    return name


def check_file(path):
    file = resolve(path, expect="file")
    if file.suffix.lower() not in FORMATS:
        raise HTTPException(415, "This file type cannot be edited")
    if file.stat().st_size > MAX_FILE:
        raise HTTPException(413, "Document is larger than 40 MB")
    return file


def revision(file):
    stat = file.stat()
    return f"{stat.st_mtime_ns}:{stat.st_size}"


def recent():
    try:
        paths = json.loads(store.setting("recent_documents", "[]"))
    except ValueError:
        return []
    valid = []
    for path in paths[:30]:
        try:
            file = check_file(path)
            valid.append({"path": path, "name": file.name, "kind": file.suffix.lower()[1:]})
        except (HTTPException, OSError):
            continue
    return valid[:12]


def touch_recent(path):
    paths = [item["path"] for item in recent() if item["path"] != path]
    store.set_setting("recent_documents", json.dumps([path, *paths][:12]))


def sanitize(content):
    if len(content.encode("utf-8")) > MAX_HTML:
        raise HTTPException(413, "Document content exceeds 8 MB")
    # Reject remote images, SVG, unsafe links and CSS URLs, including unquoted attributes.
    def filter_attribute(tag, attr, value):
        if tag == "img" and attr == "src" and (not IMAGE_URL.fullmatch(value) or len(value) > MAX_IMAGE * 2):
            return None
        if tag == "a" and attr == "href" and not re.match(r"^(https://|mailto:)", value, re.I):
            return None
        if attr in ("width", "height") and (not value.isdigit() or int(value) > 2000):
            return None
        if tag == "font" and attr == "color" and not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
            return None
        if tag == "font" and attr == "size" and value not in {str(i) for i in range(1, 8)}:
            return None
        if tag == "font" and attr == "face" and value not in {"Arial", "Georgia", "Times New Roman", "Courier New"}:
            return None
        return value

    return nh3.clean(content, tags=HTML_TAGS, attributes=HTML_ATTRS, attribute_filter=filter_attribute, allowed_classes={"img": {"doc-float-left", "doc-float-right"}}, url_schemes={"https", "mailto", "data"}, clean_content_tags={"script", "style", "iframe", "object", "svg", "form", "template"})


def image_bytes(value):
    match = IMAGE_URL.fullmatch(value or "")
    if not match:
        raise HTTPException(422, "Choose a PNG, JPEG, WebP or GIF image")
    try:
        data = base64.b64decode(match.group(2), validate=True)
        if len(data) > MAX_IMAGE:
            raise ValueError("Image too large")
        with Image.open(io.BytesIO(data)) as image:
            image.verify()
        return data
    except (ValueError, OSError):
        raise HTTPException(422, "Invalid image") from None


def inline_html(paragraph, part):
    fragments = []
    for element in paragraph._p:
        if element.tag == qn("w:hyperlink"):
            relationship = part.rels.get(element.get(qn("r:id")))
            label = html.escape("".join(node.text or "" for node in element.iter(qn("w:t"))))
            if relationship and re.match(r"^(https://|mailto:)", relationship.target_ref, re.I):
                target = html.escape(relationship.target_ref, quote=True)
                fragments.append(f'<a href="{target}">{label}</a>')
            else:
                fragments.append(label)
            continue
        if element.tag != qn("w:r"):
            continue
        run = Run(element, paragraph)
        text = html.escape(run.text).replace("\n", "<br>")
        if run.bold:
            text = "<strong>" + text + "</strong>"
        if run.italic:
            text = "<em>" + text + "</em>"
        if run.underline:
            text = "<u>" + text + "</u>"
        if run.font.strike:
            text = "<s>" + text + "</s>"
        if run.font.color.rgb is not None or run.font.name or run.font.size:
            attributes = []
            if run.font.color.rgb is not None:
                attributes.append(f'color="#{run.font.color.rgb}"')
            if run.font.name:
                attributes.append(f'face="{html.escape(run.font.name, quote=True)}"')
            if run.font.size:
                size = min(range(1, 8), key=lambda option: abs((8, 10, 12, 14, 18, 24, 32)[option - 1] - run.font.size.pt))
                attributes.append(f'size="{size}"')
            text = "<font " + " ".join(attributes) + ">" + text + "</font>"
        fragments.append(text)
        for blip in run.element.xpath(".//a:blip"):
            rid = blip.get(qn("r:embed"))
            if rid not in part.related_parts:
                continue
            data = part.related_parts[rid].blob
            if len(data) > MAX_IMAGE:
                continue
            try:
                with Image.open(io.BytesIO(data)) as image:
                    media = Image.MIME.get(image.format, "")
            except OSError:
                continue
            if media in ("image/png", "image/jpeg", "image/gif", "image/webp"):
                fragments.append(f'<img src="data:{media};base64,{base64.b64encode(data).decode()}" alt="Embedded image" width="480">')
    return "".join(fragments)


def docx_to_html(file):
    document = Document(str(file))
    output = []
    for element in document.element.body.iterchildren():
        if element.tag == qn("w:p"):
            para = Paragraph(element, document)
            style = para.style.name if para.style else ""
            heading = re.fullmatch(r"Heading ([1-6])", style)
            tag = f"h{heading.group(1)}" if heading else "p"
            output.append(f"<{tag}>{inline_html(para, document.part)}</{tag}>")
        elif element.tag == qn("w:tbl"):
            table = Table(element, document)
            output.append("<table><tbody>")
            for row in table.rows:
                output.append("<tr>")
                for cell in row.cells:
                    output.append("<td>" + "".join("<p>" + inline_html(p, document.part) + "</p>" for p in cell.paragraphs) + "</td>")
                output.append("</tr>")
            output.append("</tbody></table>")
    return sanitize("".join(output))


def inline_to_docx(parent, node, bold=False, italic=False, underline=False, strike=False, font_color=None, font_face=None, font_size=None):
    tag = node.tag.lower() if isinstance(node.tag, str) else ""
    bold = bold or tag in ("b", "strong")
    italic = italic or tag in ("i", "em")
    underline = underline or tag == "u"
    strike = strike or tag in ("s", "strike")
    if tag == "font":
        font_color = node.get("color") or font_color
        font_face = node.get("face") or font_face
        font_size = node.get("size") or font_size

    def add_text(text):
        run = parent.add_run(text)
        run.bold, run.italic, run.underline = bold, italic, underline
        run.font.strike = strike
        if font_color:
            run.font.color.rgb = RGBColor.from_string(font_color[1:])
        if font_face:
            run.font.name = font_face
        if font_size:
            run.font.size = Pt((8, 10, 12, 14, 18, 24, 32)[int(font_size) - 1])

    if tag == "a" and re.match(r"^(https://|mailto:)", node.get("href", ""), re.I):
        relationship = parent.part.relate_to(node.get("href"), RT.HYPERLINK, is_external=True)
        hyperlink = OxmlElement("w:hyperlink")
        hyperlink.set(qn("r:id"), relationship)
        run = OxmlElement("w:r")
        text = OxmlElement("w:t")
        text.set(qn("xml:space"), "preserve")
        text.text = "".join(node.itertext())
        run.append(text)
        hyperlink.append(run)
        parent._p.append(hyperlink)
        return
    if tag == "img":
        data = image_bytes(node.get("src"))
        try:
            width = max(40, min(int(node.get("width", "480")), 1400))
        except ValueError:
            width = 480
        parent.add_run().add_picture(io.BytesIO(data), width=int(min(width / 96, 7.5) * 914400))
        return
    if tag == "br":
        parent.add_run().add_break()
    if node.text:
        add_text(node.text)
    for child in node:
        inline_to_docx(parent, child, bold, italic, underline, strike, font_color, font_face, font_size)
        if child.tail:
            add_text(child.tail)


def html_to_docx(content):
    parsed = lxml_html.fragment_fromstring(sanitize(content), create_parent="div")
    document = Document()
    if parsed.text and parsed.text.strip():
        document.add_paragraph(parsed.text)
    for item in parsed:
        tag = item.tag.lower() if isinstance(item.tag, str) else ""
        if tag == "table":
            rows = item.xpath("./tbody/tr|./tr|./thead/tr")
            if not rows:
                continue
            columns = max(len(row.xpath("./td|./th")) for row in rows)
            if not columns:
                continue
            table = document.add_table(rows=len(rows), cols=min(columns, 30))
            table.style = "Table Grid"
            for i, row in enumerate(rows):
                for j, cell in enumerate(row.xpath("./td|./th")[:30]):
                    inline_to_docx(table.cell(i, j).paragraphs[0], cell)
        elif tag in ("ul", "ol"):
            for child in item.xpath("./li"):
                paragraph = document.add_paragraph(style="List Bullet" if tag == "ul" else "List Number")
                inline_to_docx(paragraph, child)
        else:
            heading = re.fullmatch(r"h([1-6])", tag)
            paragraph = document.add_paragraph(style=f"Heading {heading.group(1)}" if heading else None)
            if tag == "blockquote":
                paragraph.style = "Quote"
            if item.get("align") == "center":
                paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
            elif item.get("align") == "right":
                paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            inline_to_docx(paragraph, item)
        if item.tail and item.tail.strip():
            document.add_paragraph(item.tail)
    data = io.BytesIO()
    document.save(data)
    return data.getvalue()


def office_convert(source, suffix):
    executable = shutil.which("libreoffice") or shutil.which("soffice")
    if not executable:
        raise HTTPException(503, "Install LibreOffice to edit legacy .doc, .odt or .rtf documents")
    with tempfile.TemporaryDirectory(prefix="inkwell-document-") as directory:
        profile = Path(directory) / "profile"
        output = Path(directory) / "output"
        output.mkdir()
        try:
            result = subprocess.run([executable, "-env:UserInstallation=" + profile.as_uri(), "--headless", "--convert-to", suffix.lstrip("."), "--outdir", str(output), str(source)], capture_output=True, timeout=35, cwd=directory)
            converted = output / (source.stem + suffix)
            if result.returncode or not converted.is_file() or converted.stat().st_size > MAX_FILE:
                raise HTTPException(422, "LibreOffice could not convert this document")
            return converted.read_bytes()
        except subprocess.TimeoutExpired:
            raise HTTPException(504, "Document conversion timed out") from None


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".inkwell-", delete=False) as output:
        temp = Path(output.name)
        try:
            os.chmod(temp, 0o600)
            output.write(data)
        except Exception:
            temp.unlink(missing_ok=True)
            raise
    try:
        temp.replace(path)
    finally:
        temp.unlink(missing_ok=True)


def output_path(source, label):
    base = source.with_name(source.stem + "." + label + source.suffix)
    candidate = base
    number = 2
    while candidate.exists():
        candidate = source.with_name(f"{source.stem}.{label}-{number}{source.suffix}")
        number += 1
    return candidate


@router.get("/tree")
def tree(path: str = ""):
    folder = resolve(path, expect="dir")
    children = []
    try:
        for child in folder.iterdir():
            if child.name.startswith(".") or child.is_symlink() or not (child.is_dir() or child.suffix.lower() in FORMATS):
                continue
            stat = child.stat()
            children.append({"name": child.name, "path": relative(child), "directory": child.is_dir(), "size": stat.st_size if child.is_file() else None})
            if len(children) >= 2000:
                break
    except PermissionError:
        raise HTTPException(403, "Cannot read this folder") from None
    children.sort(key=lambda item: (not item["directory"], item["name"].casefold()))
    return {"name": folder.name, "path": relative(folder), "children": children}


@router.get("/recent")
def list_recent():
    return recent()


@router.get("/open")
def open_document(path: str):
    file = check_file(path)
    kind = file.suffix.lower()
    result = {"path": relative(file), "name": file.name, "revision": revision(file), "kind": kind[1:]}
    if kind == ".pdf":
        try:
            with pymupdf.open(file) as document:
                if document.is_encrypted:
                    raise HTTPException(422, "Unlock encrypted PDFs before editing")
                result.update(mode="pdf", pages=[{"width": round(p.rect.width, 2), "height": round(p.rect.height, 2)} for p in document])
        except (pymupdf.FileDataError, pymupdf.EmptyFileError):
            raise HTTPException(422, "Invalid PDF") from None
    elif kind in RICH_EXT:
        if kind in (".html", ".htm"):
            result.update(mode="rich", content=sanitize(file.read_text(encoding="utf-8-sig")))
        else:
            if kind == ".docx":
                source = file
                result.update(mode="rich", content=docx_to_html(source))
            else:
                with tempfile.TemporaryDirectory(prefix="inkwell-document-") as directory:
                    converted = Path(directory) / (file.stem + ".docx")
                    converted.write_bytes(office_convert(file, ".docx"))
                    result.update(mode="rich", content=docx_to_html(converted))
    else:
        try:
            result.update(mode="text", content=file.read_text(encoding="utf-8-sig"))
        except UnicodeError:
            raise HTTPException(422, "This text file is not UTF-8") from None
    touch_recent(relative(file))
    return result


@router.get("/page")
def pdf_page(path: str, page: int = 0, width: int = Query(900, ge=100, le=1800)):
    file = check_file(path)
    if file.suffix.lower() != ".pdf":
        raise HTTPException(415, "Page previews require a PDF")
    try:
        with pymupdf.open(file) as document:
            if document.is_encrypted or page < 0 or page >= len(document):
                raise HTTPException(422, "Invalid or encrypted PDF page")
            target = document[page]
            if target.rect.width <= 0 or target.rect.height <= 0 or width * width * target.rect.height / target.rect.width > 8_000_000:
                raise HTTPException(413, "PDF page is too large to preview safely")
            pixmap = target.get_pixmap(matrix=pymupdf.Matrix(width / target.rect.width, width / target.rect.width), alpha=False)
            return Response(pixmap.tobytes("png"), media_type="image/png", headers={"Cache-Control": "no-store"})
    except (pymupdf.FileDataError, pymupdf.EmptyFileError):
        raise HTTPException(422, "Invalid PDF") from None


class NewItem(BaseModel):
    path: str = ""
    name: str = Field(max_length=160)


@router.post("/folder")
def create_folder(data: NewItem):
    folder = resolve(data.path, expect="dir") / name_ok(data.name)
    if folder.exists():
        raise HTTPException(409, "A file or folder already has that name")
    folder.mkdir(mode=0o700)
    return {"path": relative(folder)}


@router.post("/file")
def create_file(data: NewItem):
    folder = resolve(data.path, expect="dir")
    name = name_ok(data.name)
    file = folder / name
    if file.suffix.lower() not in FORMATS:
        raise HTTPException(415, "Choose a supported document format")
    if file.exists():
        raise HTTPException(409, "A file already has that name")
    suffix = file.suffix.lower()
    if suffix == ".pdf":
        pdf = pymupdf.open()
        pdf.new_page()
        content = pdf.tobytes()
        pdf.close()
    elif suffix == ".docx":
        content = html_to_docx("<p></p>")
    elif suffix in (".doc", ".odt", ".rtf"):
        with tempfile.TemporaryDirectory(prefix="inkwell-document-") as directory:
            source = Path(directory) / "new.docx"
            source.write_bytes(html_to_docx("<p></p>"))
            content = office_convert(source, suffix)
    else:
        content = b""
    # Exclusive create: never overwrite a file created in between the check and write.
    try:
        with file.open("xb") as output:
            os.chmod(file, 0o600)
            output.write(content)
    except FileExistsError:
        raise HTTPException(409, "A file already has that name") from None
    return {"path": relative(file)}


@router.post("/import")
async def import_file(request: Request, path: str = "", name: str = ""):
    folder = resolve(path, expect="dir")
    name = name_ok(name)
    if Path(name).suffix.lower() not in FORMATS:
        raise HTTPException(415, "Choose a supported document format")
    if request.headers.get("content-length") and int(request.headers["content-length"]) > MAX_FILE:
        raise HTTPException(413, "Document exceeds 40 MB")
    incoming = bytearray()
    async for chunk in request.stream():
        if len(incoming) + len(chunk) > MAX_FILE:
            raise HTTPException(413, "Document exceeds 40 MB")
        incoming.extend(chunk)
    if not incoming:
        raise HTTPException(422, "Choose a non-empty document")
    data = bytes(incoming)
    suffix = Path(name).suffix.lower()
    if suffix == ".pdf" and not data.startswith(b"%PDF-"):
        raise HTTPException(422, "Invalid PDF file")
    if suffix == ".docx" and not data.startswith(b"PK"):
        raise HTTPException(422, "Invalid DOCX file")
    if suffix in TEXT_EXT | {".html", ".htm"}:
        try:
            data.decode("utf-8-sig")
        except UnicodeError:
            raise HTTPException(422, "Text documents must be UTF-8") from None
    file = folder / name
    try:
        with file.open("xb") as output:
            os.chmod(file, 0o600)
            output.write(data)
    except FileExistsError:
        raise HTTPException(409, "A file already has that name") from None
    return {"path": relative(file)}


class SaveContent(BaseModel):
    path: str
    revision: str
    content: str = Field(max_length=MAX_HTML)


@router.put("/content")
def save_content(data: SaveContent):
    file = check_file(data.path)
    if revision(file) != data.revision:
        raise HTTPException(409, "Document changed on disk. Reopen it before saving")
    kind = file.suffix.lower()
    if kind == ".pdf":
        raise HTTPException(415, "Use PDF tools to edit and export a new PDF")
    if kind in TEXT_EXT:
        content = data.content.encode("utf-8")
    elif kind in (".html", ".htm"):
        content = sanitize(data.content).encode("utf-8")
    else:
        source_data = html_to_docx(data.content)
        if kind == ".docx":
            content = source_data
        else:
            with tempfile.TemporaryDirectory(prefix="inkwell-document-") as directory:
                source = Path(directory) / (file.stem + ".docx")
                source.write_bytes(source_data)
                content = office_convert(source, kind)
    if len(content) > MAX_FILE:
        raise HTTPException(413, "Document exceeds 40 MB")
    atomic_write(file, content)
    touch_recent(relative(file))
    return {"path": relative(file), "revision": revision(file)}


class PdfOperation(BaseModel):
    path: str
    action: str
    page: int = 0
    rect: list[float] | None = None
    image: str | None = None
    text: str | None = Field(default=None, max_length=5000)


def pdf_rect(page, rect):
    if not rect or len(rect) != 4 or not all(isinstance(v, (int, float)) and v == v and abs(v) < 100_000 for v in rect):
        raise HTTPException(422, "Select a valid area on the page")
    value = pymupdf.Rect(rect)
    if value.is_empty or value.is_infinite or not page.rect.contains(value) or value.width < 2 or value.height < 2:
        raise HTTPException(422, "Selected area must be inside the page")
    return value


@router.post("/pdf")
def edit_pdf(data: PdfOperation):
    file = check_file(data.path)
    if file.suffix.lower() != ".pdf":
        raise HTTPException(415, "PDF tools require a PDF document")
    if data.action not in {"redact", "image", "signature", "text", "compress"}:
        raise HTTPException(422, "Unknown PDF action")
    try:
        with pymupdf.open(file) as document:
            if document.is_encrypted:
                raise HTTPException(422, "Unlock encrypted PDFs before editing")
            if data.action == "compress":
                # Re-encode oversized images, remove unused objects and compress streams.
                document.rewrite_images(dpi_threshold=180, dpi_target=144, quality=68)
                document.subset_fonts()
            else:
                if data.page < 0 or data.page >= len(document):
                    raise HTTPException(422, "Page does not exist")
                page = document[data.page]
                rect = pdf_rect(page, data.rect)
                if data.action == "redact":
                    page.add_redact_annot(rect, fill=(0, 0, 0))
                    page.apply_redactions(images=2, graphics=1, text=0)
                elif data.action in ("image", "signature"):
                    image = image_bytes(data.image)
                    page.insert_image(rect, stream=image, keep_proportion=True)
                elif data.action == "text":
                    if not data.text or not data.text.strip():
                        raise HTTPException(422, "Enter text to place")
                    if page.insert_textbox(rect, data.text, fontsize=12, fontname="helv") < 0:
                        raise HTTPException(422, "The selected area is too small for this text")
            output = document.tobytes(garbage=4, deflate=True, deflate_images=True, deflate_fonts=True, clean=True)
    except (pymupdf.FileDataError, pymupdf.EmptyFileError):
        raise HTTPException(422, "Invalid PDF") from None
    if data.action == "compress" and len(output) >= file.stat().st_size:
        return {"path": relative(file), "saved_bytes": 0, "message": "The PDF is already as small as this compression can make it"}
    result = output_path(file, {"signature": "signed-image", "image": "image", "redact": "redacted", "text": "annotated", "compress": "compressed"}[data.action])
    atomic_write(result, output)
    touch_recent(relative(result))
    return {"path": relative(result), "saved_bytes": file.stat().st_size - len(output) if data.action == "compress" else 0}


class DigitalSignature(BaseModel):
    path: str
    certificate: str = Field(max_length=3_000_000)
    password: str = Field(default="", max_length=1024)
    page: int = 0
    rect: list[float] | None = None


@router.post("/sign")
def sign_pdf(data: DigitalSignature):
    """Sign a new PDF copy; PKCS#12 certificate and passphrase are never stored."""
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    from pyhanko.sign import fields, signers

    file = check_file(data.path)
    if file.suffix.lower() != ".pdf":
        raise HTTPException(415, "Digital signatures require a PDF")
    try:
        certificate = base64.b64decode(data.certificate, validate=True)
        if not certificate or len(certificate) > 2_000_000:
            raise ValueError("Invalid certificate")
        signer = signers.SimpleSigner.load_pkcs12_data(certificate, other_certs=(), passphrase=data.password.encode())
        if signer is None:
            raise ValueError("Cannot read certificate")
        with pymupdf.open(file) as document:
            if document.is_encrypted or data.page < 0 or data.page >= len(document):
                raise ValueError("Invalid PDF page")
            page = document[data.page]
            selected = pdf_rect(page, data.rect) if data.rect else pymupdf.Rect(page.rect.width - 220, page.rect.height - 95, page.rect.width - 20, page.rect.height - 25)
            box = (selected.x0, page.rect.height - selected.y1, selected.x1, page.rect.height - selected.y0)
        field = "InkwellSignature" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
        writer = IncrementalPdfFileWriter(io.BytesIO(file.read_bytes()))
        destination = io.BytesIO()
        signers.sign_pdf(writer, signature_meta=signers.PdfSignatureMetadata(field_name=field), signer=signer, new_field_spec=fields.SigFieldSpec(sig_field_name=field, on_page=data.page, box=box), output=destination)
        result = output_path(file, "digitally-signed")
        atomic_write(result, destination.getvalue())
        touch_recent(relative(result))
        return {"path": relative(result)}
    except HTTPException:
        raise
    except (ValueError, OSError, KeyError, TypeError) as error:
        raise HTTPException(422, "Could not sign the PDF. Check its PKCS#12 certificate and password") from error


class MarkdownPreview(BaseModel):
    content: str = Field(max_length=MAX_HTML)


@router.post("/preview")
def preview_markdown(data: MarkdownPreview):
    rendered = MarkdownIt("commonmark", {"html": False}).render(data.content)
    return {"html": sanitize(rendered)}


@router.get("/download")
def download(path: str):
    file = check_file(path)
    from fastapi.responses import FileResponse

    return FileResponse(file, filename=file.name, media_type="application/octet-stream", headers={"X-Content-Type-Options": "nosniff"})
