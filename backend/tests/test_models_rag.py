import pytest
from sqlalchemy import select
from studybuddy.db.models import (
    User, Course, File as FileModel, Deadline, Chunk, ChatSession, ChatMessage,
)


@pytest.mark.asyncio
async def test_chunk_file_roundtrip(db):
    """Can insert a chunk tied to a file, including a 512-dim embedding as JSON on SQLite."""
    u = User(email="a@eur.nl"); db.add(u); await db.flush()
    c = Course(user_id=u.id, canvas_course_id=1, name="Algorithms"); db.add(c); await db.flush()
    f = FileModel(
        user_id=u.id, course_id=c.id, canvas_file_id=10,
        filename="lec1.pdf", url="https://x", source="canvas",
    )
    db.add(f); await db.flush()
    ch = Chunk(
        user_id=u.id, course_id=c.id, file_id=f.id,
        source_kind="file",
        content_text="Big-O notation describes complexity.",
        chunk_index=0, token_count=9,
        page_hint=14, heading_path="Chapter 1 > Analysis",
        embedding=[0.1] * 512,
    )
    db.add(ch); await db.commit()

    fetched = (await db.execute(select(Chunk))).scalar_one()
    assert fetched.file_id == f.id
    assert len(fetched.embedding) == 512
    assert fetched.embedding[0] == pytest.approx(0.1)
    assert fetched.heading_path == "Chapter 1 > Analysis"


@pytest.mark.asyncio
async def test_chunk_assignment_description(db):
    """A chunk can be tied to a deadline instead of a file (assignment description chunk)."""
    u = User(email="a@eur.nl"); db.add(u); await db.flush()
    c = Course(user_id=u.id, canvas_course_id=1, name="Econ"); db.add(c); await db.flush()
    d = Deadline(
        user_id=u.id, course_id=c.id,
        canvas_source_type="assignment", canvas_source_id="a1",
        title="PS1", url="https://x", type="assignment",
    )
    db.add(d); await db.flush()
    ch = Chunk(
        user_id=u.id, course_id=c.id, deadline_id=d.id,
        source_kind="assignment_description",
        content_text="Explain supply and demand.",
        chunk_index=0, token_count=6,
        embedding=[0.0] * 512,
    )
    db.add(ch); await db.commit()

    fetched = (await db.execute(select(Chunk))).scalar_one()
    assert fetched.deadline_id == d.id
    assert fetched.file_id is None


@pytest.mark.asyncio
async def test_chat_session_and_messages(db):
    u = User(email="a@eur.nl"); db.add(u); await db.flush()
    c = Course(user_id=u.id, canvas_course_id=1, name="Stats"); db.add(c); await db.flush()
    s = ChatSession(user_id=u.id, course_id=c.id, title="Midterm prep")
    db.add(s); await db.flush()
    db.add(ChatMessage(session_id=s.id, role="user", content="Hi"))
    db.add(ChatMessage(
        session_id=s.id, role="assistant",
        content="Hello [1]", citations_json=[{"marker": 1, "snippet": "greeting"}],
    ))
    await db.commit()
    msgs = (await db.execute(select(ChatMessage))).scalars().all()
    assert len(msgs) == 2
    assistant = [m for m in msgs if m.role == "assistant"][0]
    assert assistant.citations_json[0]["marker"] == 1
    assert assistant.error is False


@pytest.mark.asyncio
async def test_file_new_columns_default(db):
    u = User(email="a@eur.nl"); db.add(u); await db.flush()
    c = Course(user_id=u.id, canvas_course_id=1, name="CS"); db.add(c); await db.flush()
    f = FileModel(user_id=u.id, course_id=c.id, canvas_file_id=1,
                  filename="x.pdf", url="https://x")
    db.add(f); await db.commit()
    row = (await db.execute(select(FileModel))).scalar_one()
    assert row.source == "canvas"
    assert row.indexed_at is None
    assert row.index_version is None
    assert row.deleted_at is None
