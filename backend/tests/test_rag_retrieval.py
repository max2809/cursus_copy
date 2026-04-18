import pytest
from sqlalchemy import select
from studybuddy.db.models import Chunk, Course, File as FileModel, User
from studybuddy.rag.retrieval import retrieve_chunks


class FakeReranker:
    def __init__(self, order: list[int]):
        self._order = order

    async def rerank(self, *, query, documents, top_k):
        return self._order[:top_k]


def _unit_vec(dim, nonzero_index):
    v = [0.0] * dim
    v[nonzero_index] = 1.0
    return v


@pytest.mark.asyncio
async def test_retrieve_scopes_to_course_and_ranks(db):
    u = User(email="a@eur.nl"); db.add(u); await db.flush()
    c1 = Course(user_id=u.id, canvas_course_id=1, name="A"); db.add(c1)
    c2 = Course(user_id=u.id, canvas_course_id=2, name="B"); db.add(c2)
    await db.flush()
    f1 = FileModel(user_id=u.id, course_id=c1.id, canvas_file_id=10,
                   filename="a.pdf", url="x", source="canvas")
    f2 = FileModel(user_id=u.id, course_id=c2.id, canvas_file_id=20,
                   filename="b.pdf", url="x", source="canvas")
    db.add_all([f1, f2]); await db.flush()
    # Three chunks in course 1; one in course 2.
    db.add_all([
        Chunk(user_id=u.id, course_id=c1.id, file_id=f1.id, source_kind="file",
              content_text="alpha", chunk_index=0, token_count=1, embedding=_unit_vec(512, 0)),
        Chunk(user_id=u.id, course_id=c1.id, file_id=f1.id, source_kind="file",
              content_text="beta", chunk_index=1, token_count=1, embedding=_unit_vec(512, 1)),
        Chunk(user_id=u.id, course_id=c1.id, file_id=f1.id, source_kind="file",
              content_text="gamma", chunk_index=2, token_count=1, embedding=_unit_vec(512, 2)),
        Chunk(user_id=u.id, course_id=c2.id, file_id=f2.id, source_kind="file",
              content_text="other_course", chunk_index=0, token_count=1, embedding=_unit_vec(512, 0)),
    ])
    await db.commit()

    # Query embedding closest to "alpha" (index 0) and "beta" (index 1).
    q = [0.9] + [0.0] * 511
    q[1] = 0.4  # inject some mass into beta dim
    rr = FakeReranker(order=[0, 1])  # assume reranker keeps first two in order
    chunks = await retrieve_chunks(
        db, user_id=u.id, course_id=c1.id,
        query_embedding=q, query_text="alpha beta",
        top_k_recall=10, top_k_rerank=2, reranker=rr,
    )
    texts = [c.content_text for c in chunks]
    assert "other_course" not in texts
    assert len(chunks) == 2
    assert "alpha" in texts[0]


@pytest.mark.asyncio
async def test_retrieve_empty_when_no_chunks(db):
    u = User(email="a@eur.nl"); db.add(u); await db.flush()
    c = Course(user_id=u.id, canvas_course_id=1, name="A"); db.add(c); await db.flush()
    rr = FakeReranker(order=[])
    chunks = await retrieve_chunks(
        db, user_id=u.id, course_id=c.id,
        query_embedding=[0.0] * 512, query_text="anything",
        top_k_recall=10, top_k_rerank=5, reranker=rr,
    )
    assert chunks == []
