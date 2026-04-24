import pytest
from sqlalchemy import select
from studybuddy.chat.service import answer_and_stream, StreamEvent
from studybuddy.db.models import (
    ChatMessage, ChatSession, Chunk, Course, File as FileModel, User,
)


class FakeEmbedder:
    async def embed_query(self, text):
        return [0.0] * 512


class FakeReranker:
    async def rerank(self, *, query, documents, top_k):
        return list(range(min(top_k, len(documents))))


class FakeClaude:
    """Simulates an Anthropic streaming response as an async iterator of deltas."""

    def __init__(self, chunks: list[str], raise_after: int | None = None):
        self._chunks = chunks
        self._raise_after = raise_after

    def messages_stream(self, **kwargs):
        chunks = self._chunks
        raise_after = self._raise_after

        class _Ctx:
            async def __aenter__(self_inner):
                return self_inner

            async def __aexit__(self_inner, *a):
                return False

            async def text_stream(self_inner):  # async generator
                for i, c in enumerate(chunks):
                    if raise_after is not None and i == raise_after:
                        raise RuntimeError("boom")
                    yield c

        return _Ctx()


async def _setup(db):
    u = User(email="a@eur.nl"); db.add(u); await db.flush()
    c = Course(user_id=u.id, canvas_course_id=1, name="CS"); db.add(c); await db.flush()
    f = FileModel(user_id=u.id, course_id=c.id, canvas_file_id=10,
                  filename="algo.pdf", url="https://canvas/algo.pdf", source="canvas")
    db.add(f); await db.flush()
    db.add(Chunk(
        user_id=u.id, course_id=c.id, file_id=f.id, source_kind="file",
        content_text="Big-O describes complexity.", chunk_index=0, token_count=4,
        heading_path="Ch1", page_hint=2, embedding=[1.0] + [0.0] * 511,
    ))
    s = ChatSession(user_id=u.id, course_id=c.id, title="Untitled")
    db.add(s); await db.commit()
    return u, c, s


@pytest.mark.asyncio
async def test_answer_streams_tokens_and_persists_citations(db):
    u, c, s = await _setup(db)
    claude = FakeClaude(chunks=["Big-O ", "is about ", "complexity [1]."])
    events: list[StreamEvent] = []
    async for ev in answer_and_stream(
        db, user=u, session_id=s.id, user_text="What is Big-O?",
        embedder=FakeEmbedder(), reranker=FakeReranker(), claude_client=claude,
        course_name=c.name, canvas_base_url="canvas.eur.nl",
        top_k_recall=5, top_k_rerank=3, claude_model="claude-sonnet-4-6",
    ):
        events.append(ev)
    await db.commit()

    # Token events for each streamed delta.
    token_text = "".join(e.text for e in events if e.kind == "token")
    assert "complexity [1]" in token_text

    done = [e for e in events if e.kind == "done"]
    assert len(done) == 1
    assert done[0].citations is not None
    # [1] should map to our single chunk.
    assert done[0].citations[0]["marker"] == 1

    msgs = (await db.execute(select(ChatMessage))).scalars().all()
    roles = sorted(m.role for m in msgs)
    assert roles == ["assistant", "user"]
    assistant = next(m for m in msgs if m.role == "assistant")
    assert "complexity [1]" in assistant.content
    assert assistant.error is False
    assert assistant.citations_json[0]["marker"] == 1


@pytest.mark.asyncio
async def test_answer_populates_source_url_for_pdf_citation(db):
    u, c, s = await _setup(db)
    # Our _setup chunk is from a canvas PDF ("algo.pdf") with page_hint=2.
    claude = FakeClaude(chunks=["Big-O is complexity [1]."])
    events: list[StreamEvent] = []
    async for ev in answer_and_stream(
        db, user=u, session_id=s.id, user_text="Big-O?",
        embedder=FakeEmbedder(), reranker=FakeReranker(), claude_client=claude,
        course_name=c.name, canvas_base_url="canvas.eur.nl",
        top_k_recall=5, top_k_rerank=3, claude_model="claude-sonnet-4-6",
        canvas_course_id=1,
    ):
        events.append(ev)
    await db.commit()

    done = [e for e in events if e.kind == "done"][0]
    cite = done.citations[0]
    assert cite["source_name"] == "algo.pdf"
    assert cite["source_kind"] == "canvas"
    assert cite["source_url"] == "/api/courses/1/materials/" + cite["file_id"] + "/download#page=2"


@pytest.mark.asyncio
async def test_answer_handles_stream_error_midway(db):
    u, c, s = await _setup(db)
    claude = FakeClaude(chunks=["Hello ", "world"], raise_after=1)
    events: list[StreamEvent] = []
    async for ev in answer_and_stream(
        db, user=u, session_id=s.id, user_text="hi",
        embedder=FakeEmbedder(), reranker=FakeReranker(), claude_client=claude,
        course_name=c.name, canvas_base_url="canvas.eur.nl",
        top_k_recall=5, top_k_rerank=3, claude_model="claude-sonnet-4-6",
    ):
        events.append(ev)
    await db.commit()

    err = [e for e in events if e.kind == "error"]
    assert len(err) == 1
    msgs = (await db.execute(select(ChatMessage))).scalars().all()
    assistant = next((m for m in msgs if m.role == "assistant"), None)
    assert assistant is not None
    assert assistant.error is True
    assert assistant.content.startswith("Hello")


@pytest.mark.asyncio
async def test_answer_with_no_chunks_still_responds(db):
    """If retrieval returns nothing, we still pass through to Claude with an
    empty context block; the model is instructed to say 'not in materials'."""
    u = User(email="a@eur.nl"); db.add(u); await db.flush()
    c = Course(user_id=u.id, canvas_course_id=1, name="CS"); db.add(c); await db.flush()
    s = ChatSession(user_id=u.id, course_id=c.id, title="x"); db.add(s); await db.commit()

    claude = FakeClaude(chunks=["I don't have material on that."])
    events = []
    async for ev in answer_and_stream(
        db, user=u, session_id=s.id, user_text="obscure?",
        embedder=FakeEmbedder(), reranker=FakeReranker(), claude_client=claude,
        course_name=c.name, canvas_base_url="canvas.eur.nl",
        top_k_recall=5, top_k_rerank=3, claude_model="claude-sonnet-4-6",
    ):
        events.append(ev)
    await db.commit()
    done = [e for e in events if e.kind == "done"][0]
    assert done.citations == []
