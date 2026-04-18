"""Per-course chat streaming orchestrator.

answer_and_stream is an async-generator that yields StreamEvent values
as the Claude response streams in. It's provider-agnostic in tests —
claude_client just needs to implement messages_stream(...) returning an
async context manager with .text_stream() async generator.

Side effects: persists the user message before streaming begins, and
persists the assistant message after the stream ends (partial if the
stream errored mid-flight, with error=True).
"""
from __future__ import annotations
import re
from dataclasses import dataclass
from typing import Any, AsyncIterator, Protocol
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from studybuddy.chat.prompts import build_context_block, build_messages, build_system_prompt
from studybuddy.db.models import ChatMessage, ChatSession, Chunk, User
from studybuddy.rag.retrieval import retrieve_chunks


@dataclass
class StreamEvent:
    kind: str  # "token" | "done" | "error"
    text: str = ""
    message_id: Any = None
    citations: list[dict] | None = None
    error: str | None = None


class _Embedder(Protocol):
    async def embed_query(self, text: str) -> list[float]: ...


class _Reranker(Protocol):
    async def rerank(self, *, query: str, documents: list[str], top_k: int) -> list[int]: ...


_CITE_RE = re.compile(r"\[(\d+)\]")


async def answer_and_stream(
    db: AsyncSession,
    *,
    user: User,
    session_id,
    user_text: str,
    embedder: _Embedder,
    reranker: _Reranker,
    claude_client: Any,
    course_name: str,
    canvas_base_url: str,
    top_k_recall: int,
    top_k_rerank: int,
    claude_model: str,
    max_output_tokens: int = 2048,
) -> AsyncIterator[StreamEvent]:
    session = (await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == user.id,
        )
    )).scalar_one()

    history = await _load_history(db, session_id=session.id)

    # Persist user message up front — if stream fails, we still have it.
    db.add(ChatMessage(session_id=session.id, role="user", content=user_text))
    await db.flush()

    query_embedding = await embedder.embed_query(user_text)
    top_chunks = await retrieve_chunks(
        db,
        user_id=user.id,
        course_id=session.course_id,
        query_embedding=query_embedding,
        query_text=user_text,
        top_k_recall=top_k_recall,
        top_k_rerank=top_k_rerank,
        reranker=reranker,
    )
    context_block = build_context_block(top_chunks)
    messages = build_messages(
        history=[{"role": m.role, "content": m.content} for m in history],
        user_query=user_text,
        context_block=context_block,
    )
    system_prompt = build_system_prompt(course_name=course_name, canvas_base_url=canvas_base_url)

    full_text = ""
    had_error = False
    error_msg = ""

    try:
        async with claude_client.messages_stream(
            model=claude_model,
            max_tokens=max_output_tokens,
            system=system_prompt,
            messages=messages,
        ) as stream:
            async for delta in stream.text_stream():
                full_text += delta
                yield StreamEvent(kind="token", text=delta)
    except Exception as e:  # noqa: BLE001 — we persist the partial and let upstream decide
        had_error = True
        error_msg = f"{type(e).__name__}: {e}"

    citations = _extract_citations(full_text, top_chunks) if not had_error else []
    assistant_msg = ChatMessage(
        session_id=session.id,
        role="assistant",
        content=full_text,
        citations_json=citations if not had_error else None,
        error=had_error,
    )
    db.add(assistant_msg)
    await db.flush()

    if had_error:
        yield StreamEvent(kind="error", error=error_msg, message_id=assistant_msg.id)
    else:
        yield StreamEvent(
            kind="done",
            message_id=assistant_msg.id,
            citations=citations,
        )


async def _load_history(db: AsyncSession, *, session_id) -> list[ChatMessage]:
    rows = (await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
    )).scalars().all()
    return list(rows)


def _extract_citations(text: str, chunks: list[Chunk]) -> list[dict]:
    """Scan `[N]` markers; build structured citation dicts referencing the matched chunk.

    Markers that point past the number of available chunks are silently dropped.
    Duplicates (same N used twice) produce one entry per unique N.
    """
    markers = sorted({int(m.group(1)) for m in _CITE_RE.finditer(text)})
    result: list[dict] = []
    for n in markers:
        if 1 <= n <= len(chunks):
            c = chunks[n - 1]
            snippet = c.content_text[:180].replace("\n", " ").strip()
            result.append({
                "marker": n,
                "chunk_id": str(c.id) if c.id is not None else None,
                "file_id": str(c.file_id) if c.file_id is not None else None,
                "deadline_id": str(c.deadline_id) if c.deadline_id is not None else None,
                "page_hint": c.page_hint,
                "heading_path": c.heading_path,
                "snippet": snippet,
            })
    return result
