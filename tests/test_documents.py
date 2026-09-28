import base64
import io
import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pymupdf
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization.pkcs12 import serialize_key_and_certificates
from cryptography.x509.oid import NameOID
from docx import Document
from PIL import Image
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.validation import validate_pdf_signature

from inkwell import documents


@pytest.fixture
def docs(client, tmp_path, monkeypatch):
    folder = tmp_path / "Documents"
    folder.mkdir()
    monkeypatch.setenv("INKWELL_DOCUMENTS_DIR", str(folder))
    return client, folder


def test_document_tree_recent_text_and_safe_paths(docs):
    client, folder = docs
    assert client.post("/api/documents/folder", json={"name": "Letters"}).json() == {"path": "Letters"}
    assert client.post("/api/documents/folder", json={"path": "Letters", "name": "2026"}).status_code == 200
    result = client.post("/api/documents/file", json={"path": "Letters/2026", "name": "notes.md"})
    assert result.json() == {"path": "Letters/2026/notes.md"}
    assert client.get("/api/documents/tree", params={"path": "Letters"}).json()["children"][0]["directory"]
    opened = client.get("/api/documents/open", params={"path": "Letters/2026/notes.md"}).json()
    assert opened["mode"] == "text"
    response = client.put("/api/documents/content", json={"path": opened["path"], "revision": opened["revision"], "content": "# Hello\nTwo lines"})
    assert response.status_code == 200
    assert client.get("/api/documents/open", params={"path": opened["path"]}).json()["content"] == "# Hello\nTwo lines"
    assert client.put("/api/documents/content", json={"path": opened["path"], "revision": opened["revision"], "content": "stale"}).status_code == 409
    assert client.get("/api/documents/recent").json()[0]["path"] == opened["path"]
    assert client.post("/api/documents/preview", json={"content": "**strong** <img src=x onerror=alert(1)>"}).json()["html"].startswith("<p><strong>strong</strong>")
    assert client.get("/api/documents/tree", params={"path": "../"}).status_code == 403
    assert client.get("/api/documents/open", params={"path": "../../etc/passwd"}).status_code == 403
    (folder / "outside").symlink_to(folder.parent, target_is_directory=True)
    assert client.get("/api/documents/tree", params={"path": "outside"}).status_code == 403
    assert "outside" not in str(client.get("/api/documents/tree").json()["children"])
    imported = client.post("/api/documents/import", params={"name": "imported.md"}, content=b"# Imported")
    assert imported.status_code == 200, imported.text
    assert (folder / "imported.md").read_text() == "# Imported"
    assert client.post("/api/documents/import", params={"name": "large.txt"}, content=b"a" * 40_000_001).status_code == 413


def test_pdf_redaction_is_permanent_and_outputs_a_new_file(docs):
    client, folder = docs
    pdf = pymupdf.open()
    page = pdf.new_page()
    page.insert_text((60, 80), "SECRET-REDACT-ME")
    (folder / "source.pdf").write_bytes(pdf.tobytes())
    pdf.close()
    opened = client.get("/api/documents/open", params={"path": "source.pdf"}).json()
    assert opened["mode"] == "pdf" and len(opened["pages"]) == 1
    assert client.get("/api/documents/page", params={"path": "source.pdf", "page": 0}).content.startswith(b"\x89PNG")
    request = {"path": "source.pdf", "action": "redact", "page": 0, "rect": [55, 60, 250, 95]}
    changed = client.post("/api/documents/pdf", json=request)
    assert changed.status_code == 200, changed.text
    result = folder / changed.json()["path"]
    assert result.exists() and result != folder / "source.pdf"
    assert b"SECRET-REDACT-ME" not in result.read_bytes()
    with pymupdf.open(result) as pdf:
        assert "SECRET-REDACT-ME" not in pdf[0].get_text()
    with pymupdf.open(folder / "source.pdf") as pdf:
        assert "SECRET-REDACT-ME" in pdf[0].get_text()
    assert client.post("/api/documents/pdf", json={**request, "rect": [-10, 0, 30, 30]}).status_code == 422


def test_pdf_image_signature_placement_and_compression(docs):
    client, folder = docs
    pdf = pymupdf.open()
    pdf.new_page()
    (folder / "original.pdf").write_bytes(pdf.tobytes())
    pdf.close()
    picture = Image.new("RGB", (180, 70), "white")
    image = io.BytesIO()
    picture.save(image, format="PNG")
    payload = "data:image/png;base64," + base64.b64encode(image.getvalue()).decode()
    for action in ("signature", "image"):
        result = client.post("/api/documents/pdf", json={"path": "original.pdf", "action": action, "page": 0, "rect": [30, 30, 230, 130], "image": payload})
        assert result.status_code == 200, result.text
        with pymupdf.open(folder / result.json()["path"]) as saved:
            assert saved[0].get_images()
    result = client.post("/api/documents/pdf", json={"path": "original.pdf", "action": "compress"})
    assert result.status_code == 200
    assert result.json()["path"] == "original.pdf" or result.json()["path"].endswith(".compressed.pdf")
    assert client.post("/api/documents/pdf", json={"path": "original.pdf", "action": "image", "rect": [0, 0, 100, 100], "image": "data:image/svg+xml;base64,PHN2Zz4="}).status_code == 422


def test_docx_table_and_text_formatting_round_trip(docs):
    client, folder = docs
    created = client.post("/api/documents/file", json={"name": "letter.docx"})
    assert created.status_code == 200, created.text
    opened = client.get("/api/documents/open", params={"path": "letter.docx"}).json()
    assert opened["mode"] == "rich"
    content = '<h1>Heading</h1><p><strong>Bold</strong> and <em>italic</em> <a href="https://example.com/path">Reference</a></p><table><tr><td>One</td><td>Two</td></tr></table><script>alert(1)</script>'
    saved = client.put("/api/documents/content", json={"path": "letter.docx", "revision": opened["revision"], "content": content})
    assert saved.status_code == 200, saved.text
    read = client.get("/api/documents/open", params={"path": "letter.docx"}).json()["content"]
    assert "Heading" in read and "<strong>Bold</strong>" in read and "<table>" in read
    assert '<a href="https://example.com/path"' in read and 'Reference</a>' in read
    assert "alert(1)" not in read
    assert (folder / "letter.docx").stat().st_size > 0


def test_rich_image_font_and_unsafe_html_attributes(docs):
    client, folder = docs
    image = io.BytesIO()
    Image.new("RGB", (16, 12), "blue").save(image, format="PNG")
    data = "data:image/png;base64," + base64.b64encode(image.getvalue()).decode()
    created = client.post("/api/documents/file", json={"name": "image.docx"})
    assert created.status_code == 200
    opened = client.get("/api/documents/open", params={"path": "image.docx"}).json()
    content = f'<p>Start <font face="Georgia" color="#345678" size="4"><s>Styled</s></font></p><p><img src="{data}" width="200" class="doc-float-left"></p>'
    result = client.put("/api/documents/content", json={"path": "image.docx", "revision": opened["revision"], "content": content})
    assert result.status_code == 200, result.text
    reopened = client.get("/api/documents/open", params={"path": "image.docx"}).json()["content"]
    assert "Styled" in reopened and "<s>" in reopened and "data:image/png;base64" in reopened
    assert "color=\"#345678\"" in reopened and "face=\"Georgia\"" in reopened
    assert (folder / "image.docx").stat().st_size > 0
    insecure = client.post("/api/documents/preview", json={"content": "<img src=\"https://evil.test/i.png\"><a href='javascript:alert(1)'>Bad</a><script>alert(1)</script>"})
    assert insecure.status_code == 200
    assert '<img src="https://' not in insecure.json()["html"] and 'href="javascript:' not in insecure.json()["html"]


def test_move_search_and_recent_paths_stay_inside_documents(docs):
    client, folder = docs
    for name in ("Letters", "Archive"):
        assert client.post("/api/documents/folder", json={"name": name}).status_code == 200
    assert client.post("/api/documents/file", json={"path": "Letters", "name": "Contract.md"}).status_code == 200
    assert client.post("/api/documents/folder", json={"path": "Letters", "name": "Nested"}).status_code == 200
    assert client.get("/api/documents/open", params={"path": "Letters/Contract.md"}).status_code == 200
    matches = client.get("/api/documents/search", params={"q": "contract"}).json()
    assert [entry["path"] for entry in matches] == ["Letters/Contract.md"]
    assert matches[0]["modified"] > 0
    moved = client.post("/api/documents/move", json={"path": "Letters/Contract.md", "destination": "Archive"})
    assert moved.status_code == 200, moved.text
    assert (folder / "Archive/Contract.md").is_file() and not (folder / "Letters/Contract.md").exists()
    assert client.get("/api/documents/recent").json()[0]["path"] == "Archive/Contract.md"
    assert client.post("/api/documents/move", json={"path": "Letters", "destination": "Letters/Nested"}).status_code == 422
    assert client.post("/api/documents/move", json={"path": "Archive/Contract.md", "destination": "../"}).status_code == 403
    (folder / "outside.txt").symlink_to(folder.parent / "outside.txt")
    assert client.post("/api/documents/move", json={"path": "outside.txt", "destination": "Archive"}).status_code in (403, 404)
    assert client.post("/api/documents/file", json={"path": "Letters", "name": "Contract.md"}).status_code == 200
    assert client.post("/api/documents/move", json={"path": "Archive/Contract.md", "destination": "Letters"}).status_code == 409
    moved_folder = client.post("/api/documents/move", json={"path": "Letters", "destination": "Archive"})
    assert moved_folder.status_code == 200 and (folder / "Archive/Letters/Nested").is_dir()
    assert client.get("/api/documents/tree", params={"path": "Archive"}).json()["children"][0]["directory"]


def test_encrypted_pdf_password_retry_and_preview(docs):
    client, folder = docs
    pdf = pymupdf.open()
    page = pdf.new_page()
    page.insert_text((60, 90), "PRIVATE-CONTENT")
    encrypted = pdf.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="owner-secret", user_pw="user-secret")
    pdf.close()
    (folder / "locked.pdf").write_bytes(encrypted)
    assert client.get("/api/documents/open", params={"path": "locked.pdf"}).status_code == 423
    assert client.post("/api/documents/unlock", json={"path": "locked.pdf", "password": "incorrect"}).status_code == 401
    assert client.post("/api/documents/unlock", json={"path": "locked.pdf", "password": "user-secret"}).status_code == 200
    assert client.get("/api/documents/open", params={"path": "locked.pdf"}).status_code == 200
    assert client.get("/api/documents/page", params={"path": "locked.pdf", "page": 0}).content.startswith(b"\x89PNG")
    changed = client.post("/api/documents/pdf", json={"path": "locked.pdf", "action": "redact", "page": 0, "rect": [55, 75, 230, 100]})
    assert changed.status_code == 200, changed.text
    with pymupdf.open(folder / changed.json()["path"]) as redacted:
        assert "PRIVATE-CONTENT" not in redacted[0].get_text()
    assert (folder / "locked.pdf").read_bytes() == encrypted
    (folder / "locked.pdf").write_bytes(encrypted + b"\n")
    assert client.get("/api/documents/open", params={"path": "locked.pdf"}).status_code == 423


def test_pdf_export_preview_and_safe_printer_options(docs, monkeypatch):
    client, folder = docs
    created = client.post("/api/documents/file", json={"name": "review.md"})
    assert created.status_code == 200
    opened = client.get("/api/documents/open", params={"path": "review.md"}).json()
    saved = client.put("/api/documents/content", json={"path": "review.md", "revision": opened["revision"], "content": "# Review document\\nPrint safely"})
    assert saved.status_code == 200
    exported = client.post("/api/documents/export-pdf", json={"path": "review.md"})
    assert exported.status_code == 200, exported.text
    with pymupdf.open(folder / exported.json()["path"]) as pdf:
        assert "Print safely" in pdf[0].get_text()
    first_output = (folder / exported.json()["path"]).read_bytes()
    another = client.post("/api/documents/export-pdf", json={"path": "review.md"})
    assert another.status_code == 200 and another.json()["path"] != exported.json()["path"]
    assert (folder / exported.json()["path"]).read_bytes() == first_output
    preview = client.get("/api/documents/print-preview", params={"path": "review.md"})
    assert preview.status_code == 200 and preview.content.startswith(b"\x89PNG")
    assert client.post("/api/documents/export-pdf", json={"path": exported.json()["path"]}).json()["path"] == exported.json()["path"]
    (folder / "review.export-3.pdf").symlink_to(folder.parent / "keep-existing-link")
    safe_export = client.post("/api/documents/export-pdf", json={"path": "review.md"})
    assert safe_export.status_code == 200 and safe_export.json()["path"] == "review.export-4.pdf"
    assert (folder / "review.export-3.pdf").is_symlink()

    calls = []
    def fake_run(args, **kwargs):
        calls.append(args)
        if args[0] == "lpstat":
            return subprocess.CompletedProcess(args, 0, stdout="printer TestQueue is idle. enabled\nsystem default destination: TestQueue\n", stderr="")
        assert args[0] == "lp" and "TestQueue" in args
        assert args[-1].startswith(str(folder) + os.sep) and Path(args[-1]).is_file()
        return subprocess.CompletedProcess(args, 0, stdout="request id is TestQueue-1", stderr="")
    monkeypatch.setattr(documents.shutil, "which", lambda name: "/usr/bin/" + name if name in ("lp", "lpstat") else None)
    monkeypatch.setattr(documents.subprocess, "run", fake_run)
    assert client.get("/api/documents/printers").json()["default"] == "TestQueue"
    assert client.post("/api/documents/print", json={"path": "review.md", "printer": "Unauthorized"}).status_code == 422
    assert client.post("/api/documents/print", json={"path": "review.md", "printer": "TestQueue", "pages": "1;touch /tmp/unsafe"}).status_code == 422
    assert client.post("/api/documents/print", json={"path": "review.md", "printer": "TestQueue", "paper": "-o raw"}).status_code == 422
    result = client.post("/api/documents/print", json={"path": "review.md", "printer": "TestQueue", "pages": "1-2", "copies": 2, "orientation": "landscape", "duplex": "long"})
    assert result.status_code == 200, result.text
    assert any(arg == "page-ranges=1-2" for arg in calls[-1])
    assert not list(folder.glob(".inkwell-print-*"))


@pytest.mark.skipif(not documents.shutil.which("libreoffice") and not documents.shutil.which("soffice"), reason="LibreOffice is not installed")
def test_docx_pdf_export_keeps_original_and_print_preview(docs):
    client, folder = docs
    original = Document()
    original.add_paragraph("DOCX ORIGINAL LAYOUT")
    source = folder / "office.docx"
    original.save(source)
    previous = source.read_bytes()
    result = client.post("/api/documents/export-pdf", json={"path": source.name})
    assert result.status_code == 200, result.text
    with pymupdf.open(folder / result.json()["path"]) as pdf:
        assert "DOCX ORIGINAL LAYOUT" in pdf[0].get_text()
    assert source.read_bytes() == previous
    preview = client.get("/api/documents/print-preview", params={"path": source.name})
    assert preview.status_code == 200 and preview.content.startswith(b"\x89PNG")


def test_pkcs12_signature_is_embedded_in_new_pdf(docs):
    client, folder = docs
    pdf = pymupdf.open()
    pdf.new_page()
    (folder / "sign-me.pdf").write_bytes(pdf.tobytes())
    pdf.close()
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Inkwell Test")])
    now = datetime.now(timezone.utc)
    certificate = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(days=1)).not_valid_after(now + timedelta(days=1)).sign(key, hashes.SHA256()))
    archive = serialize_key_and_certificates(b"Inkwell Test", key, certificate, None, serialization.BestAvailableEncryption(b"password"))
    payload = {"path": "sign-me.pdf", "certificate": base64.b64encode(archive).decode(), "password": "password"}
    assert client.post("/api/documents/sign", json={**payload, "password": "incorrect"}).status_code == 422
    result = client.post("/api/documents/sign", json=payload)
    assert result.status_code == 200, result.text
    assert result.json()["path"] != "sign-me.pdf"
    with pymupdf.open(folder / result.json()["path"]) as signed:
        assert signed.get_sigflags() > 0
    with (folder / result.json()["path"]).open("rb") as stream:
        reader = PdfFileReader(stream)
        signatures = reader.embedded_signatures
        assert len(signatures) == 1
        assert validate_pdf_signature(signatures[0]).intact
    with pymupdf.open(folder / "sign-me.pdf") as original:
        assert original.get_sigflags() <= 0
