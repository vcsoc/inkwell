import base64
import io
from datetime import datetime, timedelta, timezone

import pymupdf
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization.pkcs12 import serialize_key_and_certificates
from cryptography.x509.oid import NameOID
from PIL import Image
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.validation import validate_pdf_signature


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
