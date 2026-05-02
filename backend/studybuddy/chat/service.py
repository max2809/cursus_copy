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

from studybuddy.chat.prompts import ChatMode, build_context_block, build_messages, build_system_prompt
from studybuddy.chat.query_rewriter import rewrite_query
from studybuddy.db.models import ChatMessage, ChatSession, Chunk, Deadline, File, User
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
    rewriter_model: str | None = None,
    chat_mode: ChatMode = "tutor",
    canvas_course_id: int | None = None,  # needed to build source_url for citations
    max_output_tokens: int = 2048,
    today=None,  # datetime.date — injected so Claude can resolve "last lecture" etc.
    course_start_date=None,  # datetime.date — optional; enables "we're in week N"
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

    # Resolve pronouns against recent turns so "quiz me on that" retrieves the
    # right material. We rewrite only for retrieval — Claude still sees the
    # user's original wording.
    retrieval_query = user_text
    if rewriter_model:
        retrieval_query = await rewrite_query(
            claude_client=claude_client,
            model=rewriter_model,
            history=[{"role": m.role, "content": m.content} for m in history],
            user_text=user_text,
        )
    query_embedding = await embedder.embed_query(retrieval_query)
    top_chunks = await retrieve_chunks(
        db,
        user_id=user.id,
        course_id=session.course_id,
        query_embedding=query_embedding,
        query_text=retrieval_query,
        top_k_recall=top_k_recall,
        top_k_rerank=top_k_rerank,
        reranker=reranker,
    )
    source_labels = await _load_source_labels(db, top_chunks)
    context_block = build_context_block(top_chunks, source_labels)
    messages = build_messages(
        history=[{"role": m.role, "content": m.content} for m in history],
        user_query=user_text,
        context_block=context_block,
    )
    system_prompt = build_system_prompt(
        course_name=course_name,
        canvas_base_url=canvas_base_url,
        chat_mode=chat_mode,
        today=today,
        course_start_date=course_start_date,
    )

    full_text = ""
    had_error = False
    error_msg = ""

    # Anthropic SDK uses client.messages.stream(...) with a text_stream attr
    # (async iterable). Tests inject a fake that exposes messages_stream instead,
    # so we accept either shape.
    stream_fn = getattr(claude_client, "messages_stream", None)
    if stream_fn is None:
        stream_fn = claude_client.messages.stream
    try:
        async with stream_fn(
            model=claude_model,
            max_tokens=max_output_tokens,
            system=system_prompt,
            messages=messages,
        ) as stream:
            text_iter = stream.text_stream
            # Real SDK: text_stream is an async iterator (property).
            # Fake: text_stream is a method returning an async generator.
            if callable(text_iter):
                text_iter = text_iter()
            async for delta in text_iter:
                full_text += delta
                yield StreamEvent(kind="token", text=delta)
    except Exception as e:  # noqa: BLE001 — we persist the partial and let upstream decide
        had_error = True
        error_msg = f"{type(e).__name__}: {e}"

    citations = (
        await _extract_citations(
            db,
            full_text,
            top_chunks,
            canvas_course_id=canvas_course_id,
            canvas_base_url=canvas_base_url,
        )
        if not had_error
        else []
    )
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


async def _load_source_labels(db: AsyncSession, chunks: list[Chunk]) -> dict:
    """Map chunk.id -> human-readable source label (filename or deadline title).

    Kept to two SELECTs regardless of chunk count; missing rows are silently
    skipped so chunks without an attached source still render with a numeric
    header.
    """
    labels: dict = {}
    file_ids = {c.file_id for c in chunks if c.file_id is not None}
    deadline_ids = {c.deadline_id for c in chunks if c.deadline_id is not None}
    if file_ids:
        rows = (await db.execute(
            select(File.id, File.filename).where(File.id.in_(file_ids))
        )).all()
        file_names = {fid: name for fid, name in rows}
        for c in chunks:
            if c.file_id in file_names and c.id is not None:
                labels[c.id] = file_names[c.file_id]
    if deadline_ids:
        rows = (await db.execute(
            select(Deadline.id, Deadline.title).where(Deadline.id.in_(deadline_ids))
        )).all()
        deadline_titles = {did: title for did, title in rows}
        for c in chunks:
            if c.deadline_id in deadline_titles and c.id is not None:
                labels[c.id] = deadline_titles[c.deadline_id]
    return labels


async def _load_history(db: AsyncSession, *, session_id) -> list[ChatMessage]:
    rows = (await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
    )).scalars().all()
    return list(rows)


async def _extract_citations(
    db: AsyncSession,
    text: str,
    chunks: list[Chunk],
    *,
    canvas_course_id: int | None,
    canvas_base_url: str,
) -> list[dict]:
    """Scan `[N]` markers; build structured citation dicts referencing the matched chunk.

    Enriches each entry with source_name / source_kind / source_url so the UI
    can show a real filename and open the underlying document (Canvas deep
    link, our download proxy with `#page=N` for PDFs, or an external URL).

    Markers that point past the number of available chunks are silently dropped.
    Duplicates (same N used twice) produce one entry per unique N.
    """
    markers = sorted({int(m.group(1)) for m in _CITE_RE.finditer(text)})
    if not markers:
        return []
    used_chunks = [chunks[n - 1] for n in markers if 1 <= n <= len(chunks)]
    file_map = await _fetch_files_by_id(db, {c.file_id for c in used_chunks if c.file_id})
    deadline_map = await _fetch_deadlines_by_id(db, {c.deadline_id for c in used_chunks if c.deadline_id})

    result: list[dict] = []
    for n in markers:
        if not (1 <= n <= len(chunks)):
            continue
        c = chunks[n - 1]
        snippet = c.content_text[:180].replace("\n", " ").strip()
        source_name: str | None = None
        source_kind: str | None = None
        source_url: str | None = None
        if c.file_id and c.file_id in file_map:
            f = file_map[c.file_id]
            source_name = f.filename
            source_kind = f.source  # canvas | canvas_page | canvas_syllabus | upload | url
            source_url = _build_file_source_url(
                f,
                canvas_course_id=canvas_course_id,
                canvas_base_url=canvas_base_url,
                page_hint=c.page_hint,
            )
        elif c.deadline_id and c.deadline_id in deadline_map:
            d = deadline_map[c.deadline_id]
            source_name = d.title
            source_kind = "deadline"
            source_url = d.url
        result.append({
            "marker": n,
            "chunk_id": str(c.id) if c.id is not None else None,
            "file_id": str(c.file_id) if c.file_id is not None else None,
            "deadline_id": str(c.deadline_id) if c.deadline_id is not None else None,
            "page_hint": c.page_hint,
            "heading_path": c.heading_path,
            "snippet": snippet,
            "source_name": source_name,
            "source_kind": source_kind,
            "source_url": source_url,
        })
    return result


async def _fetch_files_by_id(db: AsyncSession, ids: set) -> dict:
    if not ids:
        return {}
    rows = (await db.execute(select(File).where(File.id.in_(ids)))).scalars().all()
    return {f.id: f for f in rows}


async def _fetch_deadlines_by_id(db: AsyncSession, ids: set) -> dict:
    if not ids:
        return {}
    rows = (await db.execute(select(Deadline).where(Deadline.id.in_(ids)))).scalars().all()
    return {d.id: d for d in rows}


def _build_file_source_url(
    f: File,
    *,
    canvas_course_id: int | None,
    canvas_base_url: str,
    page_hint: int | None,
) -> str | None:
    """Pick the best link to open for this file.

    For canvas files we route through our download proxy (handles PAT auth),
    and tack `#page=N` so the browser's PDF viewer jumps to that page.
    For canvas_page / canvas_syllabus we prefer a Canvas deep link when we can
    build one — it opens the real page in Canvas rather than a raw HTML dump.
    """
    base = _ensure_https(canvas_base_url)
    if f.source == "canvas":
        if canvas_course_id is None:
            return None
        url = f"/api/courses/{canvas_course_id}/materials/{f.id}/download"
        if page_hint is not None and _looks_like_pdf(f):
            url += f"#page={page_hint}"
        return url
    if f.source == "canvas_page":
        slug = f.source_url
        if base and canvas_course_id is not None and slug:
            return f"{base}/courses/{canvas_course_id}/pages/{slug}"
        return None
    if f.source == "canvas_syllabus":
        if base and canvas_course_id is not None:
            return f"{base}/courses/{canvas_course_id}/assignments/syllabus"
        return None
    if f.source == "url":
        return f.source_url
    # upload: we don't currently serve the body back, so nothing useful to link.
    return None


def _looks_like_pdf(f: File) -> bool:
    if f.content_type and "pdf" in f.content_type.lower():
        return True
    return bool(f.filename and f.filename.lower().endswith(".pdf"))


def _ensure_https(base: str) -> str:
    if not base:
        return ""
    if base.startswith("http://") or base.startswith("https://"):
        return base.rstrip("/")
    return f"https://{base.rstrip('/')}"
