from pathlib import Path
import pytest
from studybuddy.rag.parser import parse_to_markdown, ParsedDoc


FIXTURES = Path(__file__).parent / "fixtures" / "rag"


def test_parse_markdown_roundtrip():
    raw = (FIXTURES / "sample.md").read_bytes()
    doc = parse_to_markdown(raw, content_type="text/markdown", filename="sample.md")
    assert isinstance(doc, ParsedDoc)
    assert "# Sample" in doc.markdown
    assert "Second section" in doc.markdown
    assert doc.pages == []  # no page info for markdown


def test_parse_plaintext():
    raw = (FIXTURES / "sample.txt").read_bytes()
    doc = parse_to_markdown(raw, content_type="text/plain", filename="sample.txt")
    assert "Plain text fixture" in doc.markdown
    assert "Line two" in doc.markdown
    assert doc.pages == []


def test_parse_rejects_unknown_content_type():
    with pytest.raises(ValueError, match="unsupported"):
        parse_to_markdown(b"binary", content_type="application/octet-stream", filename="x.bin")


def test_parse_html_strips_boilerplate(monkeypatch):
    """HTML is parsed via trafilatura for readable-text extraction."""
    html = b"""
    <html><body>
      <nav>skip me</nav>
      <article><h1>Title</h1><p>Body copy about supply.</p></article>
      <footer>skip</footer>
    </body></html>
    """
    doc = parse_to_markdown(html, content_type="text/html", filename="a.html")
    assert "Body copy about supply" in doc.markdown
    # boilerplate extractor drops nav/footer
    assert "skip me" not in doc.markdown
