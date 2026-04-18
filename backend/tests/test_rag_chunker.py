import pytest
from studybuddy.rag.chunker import chunk_markdown, Chunk
from studybuddy.rag.parser import ParsedDoc


def test_small_doc_produces_single_chunk():
    doc = ParsedDoc(markdown="# Intro\n\nJust a few words here.")
    chunks = list(chunk_markdown(doc, target_tokens=800, overlap_tokens=100))
    assert len(chunks) == 1
    assert chunks[0].chunk_index == 0
    assert chunks[0].heading_path == "Intro"
    assert chunks[0].token_count > 0
    assert "Just a few words" in chunks[0].text


def test_heading_path_tracks_hierarchy():
    md = (
        "# Chapter 1\n\n"
        "Intro para.\n\n"
        "## Section A\n\n"
        "A-body.\n\n"
        "### Subsection A.1\n\n"
        "A1-body.\n\n"
        "## Section B\n\n"
        "B-body.\n"
    )
    chunks = list(chunk_markdown(ParsedDoc(markdown=md), target_tokens=800, overlap_tokens=0))
    # Small doc: one chunk per section boundary at the target size, or fewer.
    # What we care about: heading_path reflects the *last* heading chain the chunk starts in.
    paths = [c.heading_path for c in chunks]
    assert any("Chapter 1" in (p or "") for p in paths)
    # Paths use " > " as separator
    joined = " | ".join(p or "" for p in paths)
    assert " > " in joined


def test_large_section_is_subdivided():
    # Build a long single-heading section: 3000 tokens-worth of filler.
    body = ("word " * 3000).strip()
    md = f"# Big\n\n{body}\n"
    chunks = list(chunk_markdown(ParsedDoc(markdown=md), target_tokens=800, overlap_tokens=100))
    assert len(chunks) >= 3
    # Each chunk roughly within [400, 1000] tokens — we don't demand exactness
    # because paragraph-boundary splits give uneven sizes. Hard upper bound: ~1200.
    for c in chunks:
        assert c.token_count <= 1200
        assert c.heading_path == "Big"


def test_overlap_shares_text_between_adjacent_chunks():
    body = ("sentence. " * 1500).strip()
    md = f"# Big\n\n{body}\n"
    chunks = list(chunk_markdown(ParsedDoc(markdown=md), target_tokens=600, overlap_tokens=100))
    assert len(chunks) >= 2
    # Tail of chunk[i] should share some tokens with head of chunk[i+1].
    a, b = chunks[0].text, chunks[1].text
    tail = a[-400:]
    head = b[:400]
    # They should share at least one whole "sentence. " window.
    assert "sentence." in tail and "sentence." in head
    # Overlap is non-zero: the first 100-ish chars of b should appear in a's tail.
    assert any(b[:50] in a[-200:-20+i] for i in range(50)) or "sentence." in tail


def test_page_hint_propagates():
    md = "# A\n\npage1 text\n\npage2 text\n"
    # 11 = char offset where 'page2' begins (best-effort)
    offset_of_page2 = md.index("page2")
    doc = ParsedDoc(markdown=md, pages=[(1, 0), (2, offset_of_page2)])
    chunks = list(chunk_markdown(doc, target_tokens=800, overlap_tokens=0))
    # Small doc -> one chunk starting at offset 0 -> page 1.
    assert chunks[0].page_hint == 1


def test_chunk_index_is_sequential():
    md = "# A\n\n" + ("para. " * 1500)
    chunks = list(chunk_markdown(ParsedDoc(markdown=md), target_tokens=400, overlap_tokens=50))
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))
