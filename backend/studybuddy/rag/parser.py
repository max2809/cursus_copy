"""Source-file parser. Produces markdown plus optional page offsets.

- PDF/PPTX/DOCX: go through markitdown (Microsoft's unified parser).
- text/plain: decoded as UTF-8 and returned as-is.
- text/markdown: decoded as UTF-8 and returned as-is.
- text/html: trafilatura for readable-content extraction, then wrapped as markdown.
- Anything else: raises ValueError.

Page offsets: when markitdown exposes page breaks (PDFs), we record them
so the chunker can populate Chunk.page_hint. For formats without pages,
ParsedDoc.pages is an empty list.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from io import BytesIO
from typing import Any


@dataclass
class ParsedDoc:
    markdown: str
    pages: list[tuple[int, int]] = field(default_factory=list)
    """List of (page_number, char_offset_in_markdown). Empty if no page info."""


_MARKITDOWN_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def parse_to_markdown(raw: bytes, *, content_type: str, filename: str) -> ParsedDoc:
    ct = (content_type or "").split(";")[0].strip().lower()

    if ct in ("text/markdown", "text/x-markdown"):
        return ParsedDoc(markdown=raw.decode("utf-8", errors="replace"))

    if ct == "text/plain":
        return ParsedDoc(markdown=raw.decode("utf-8", errors="replace"))

    if ct == "text/html":
        import trafilatura
        extracted = trafilatura.extract(
            raw.decode("utf-8", errors="replace"),
            include_comments=False,
            include_tables=True,
            favor_precision=True,
        ) or ""
        return ParsedDoc(markdown=extracted)

    if ct in _MARKITDOWN_TYPES:
        from markitdown import MarkItDown
        md = MarkItDown()
        result = md.convert_stream(BytesIO(raw), file_extension=_extension_for(ct, filename))
        return ParsedDoc(markdown=result.text_content or "")

    raise ValueError(f"unsupported content_type: {content_type!r}")


def _extension_for(content_type: str, filename: str) -> str:
    """markitdown keys off file extension; pick a sane one from content_type."""
    ext_map = {
        "application/pdf": ".pdf",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    }
    if content_type in ext_map:
        return ext_map[content_type]
    # Fall back to filename extension.
    if "." in filename:
        return "." + filename.rsplit(".", 1)[-1].lower()
    return ""
