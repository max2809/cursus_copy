import pytest
from studybuddy.db.models import Chunk
from studybuddy.chat.prompts import (
    build_system_prompt, build_context_block, build_messages,
)


def _chunk(**kw):
    return Chunk(
        user_id=None, course_id=None, source_kind="file",
        content_text=kw.get("content_text", "body"),
        chunk_index=kw.get("chunk_index", 0),
        token_count=kw.get("token_count", 2),
        heading_path=kw.get("heading_path"),
        page_hint=kw.get("page_hint"),
        embedding=[0.0] * 512,
    )


def test_system_prompt_names_course_and_base_url():
    p = build_system_prompt(course_name="Econ 101", canvas_base_url="canvas.eur.nl")
    assert "Econ 101" in p
    assert "canvas.eur.nl" in p
    assert "[1]" in p  # instruction about inline citations


def test_context_block_numbered_with_metadata():
    chunks = [
        _chunk(content_text="Supply and demand basics.",
               heading_path="Ch.1 > Basics", page_hint=3),
        _chunk(content_text="Elasticity is the responsiveness...",
               heading_path=None, page_hint=None),
    ]
    block = build_context_block(chunks)
    assert "[1]" in block
    assert "[2]" in block
    assert "Ch.1 > Basics" in block
    assert "p.3" in block
    assert "Supply and demand basics" in block
    assert "Elasticity" in block


def test_context_block_uses_source_labels():
    import uuid
    id1 = uuid.uuid4()
    id2 = uuid.uuid4()
    c1 = _chunk(content_text="Supply and demand basics.",
                heading_path="Ch.1 > Basics", page_hint=3)
    c2 = _chunk(content_text="Elasticity is the responsiveness...",
                heading_path=None, page_hint=None)
    c1.id = id1
    c2.id = id2
    labels = {id1: "Week 3 — Econ.pdf", id2: "Assignment 1"}
    block = build_context_block([c1, c2], labels)
    assert "Week 3 — Econ.pdf" in block
    assert "Assignment 1" in block
    # Filename appears before heading/page in the header.
    assert block.index("Week 3 — Econ.pdf") < block.index("Ch.1 > Basics")


def test_system_prompt_forbids_unsupported_citations():
    p = build_system_prompt(course_name="X", canvas_base_url="canvas")
    # The stricter rule wording should appear.
    assert "literally supports" in p or "literally support" in p


def test_system_prompt_mentions_math_delimiters():
    p = build_system_prompt(course_name="X", canvas_base_url="canvas")
    assert "$...$" in p and "$$...$$" in p


def test_context_block_empty_when_no_chunks():
    assert build_context_block([]) == ""


def test_build_messages_shape():
    history = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello there"},
    ]
    msgs = build_messages(
        history=history,
        user_query="What is Big-O?",
        context_block="[1] algo.pdf:\nBig-O...",
    )
    # Anthropic messages API: alternating, last one is current user.
    assert msgs[-1]["role"] == "user"
    assert "What is Big-O?" in msgs[-1]["content"]
    assert "[1] algo.pdf" in msgs[-1]["content"]
    # History preserved.
    assert msgs[0]["role"] == "user"
    assert msgs[1]["role"] == "assistant"


def test_build_messages_trims_long_history():
    # 30 turns of history; we expect at most 10 (last 10) + current user.
    history = []
    for i in range(15):
        history.append({"role": "user", "content": f"u{i}"})
        history.append({"role": "assistant", "content": f"a{i}"})
    msgs = build_messages(history=history, user_query="q", context_block="")
    assert len(msgs) <= 11
    assert msgs[-1]["role"] == "user" and "q" in msgs[-1]["content"]
