"""Vector search + rerank for per-course chat.

Production path (Postgres + pgvector):
    SELECT * FROM chunks WHERE user_id=:u AND course_id=:c
    ORDER BY embedding <=> :q LIMIT :n;

Test path (SQLite): we can't use the `<=>` operator. Fall back to loading
all matching rows and sorting by cosine distance in Python. Tests use
small datasets so the cost is negligible.
"""
from __future__ import annotations
import math
from typing import Protocol
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from studybuddy.db.models import Chunk


class _Reranker(Protocol):
    async def rerank(self, *, query: str, documents: list[str], top_k: int) -> list[int]: ...


async def retrieve_chunks(
    db: AsyncSession,
    *,
    user_id,
    course_id,
    query_embedding: list[float],
    query_text: str,
    top_k_recall: int,
    top_k_rerank: int,
    reranker: _Reranker,
) -> list[Chunk]:
    recalled = await _recall(db, user_id=user_id, course_id=course_id,
                             query_embedding=query_embedding, limit=top_k_recall)
    if not recalled:
        return []
    documents = [c.content_text for c in recalled]
    order = await reranker.rerank(query=query_text, documents=documents, top_k=top_k_rerank)
    return [recalled[i] for i in order]


async def _recall(db: AsyncSession, *, user_id, course_id,
                  query_embedding: list[float], limit: int) -> list[Chunk]:
    dialect = db.bind.dialect.name if db.bind else "sqlite"
    if dialect == "postgresql":
        # pgvector: <=> is cosine distance. Use bind param via text() with cast.
        stmt = text(
            """
            SELECT id FROM chunks
            WHERE user_id = :u AND course_id = :c
            ORDER BY embedding <=> (:q)::vector
            LIMIT :n
            """
        ).bindparams(u=user_id, c=course_id, q=query_embedding, n=limit)
        rows = (await db.execute(stmt)).all()
        ids = [r[0] for r in rows]
        if not ids:
            return []
        fetched = (await db.execute(select(Chunk).where(Chunk.id.in_(ids)))).scalars().all()
        # Preserve pgvector order.
        by_id = {c.id: c for c in fetched}
        return [by_id[i] for i in ids if i in by_id]

    # SQLite fallback: pull all, rank in Python.
    all_rows = (await db.execute(
        select(Chunk).where(Chunk.user_id == user_id, Chunk.course_id == course_id)
    )).scalars().all()
    if not all_rows:
        return []
    scored = [(_cosine_distance(query_embedding, c.embedding), c) for c in all_rows]
    scored.sort(key=lambda t: t[0])
    return [c for _, c in scored[:limit]]


def _cosine_distance(a: list[float], b: list[float]) -> float:
    # a, b are raw lists of floats (JSON in SQLite).
    if not a or not b or len(a) != len(b):
        return 1.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 1.0
    return 1.0 - (dot / (na * nb))
