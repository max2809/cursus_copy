"""End-to-end indexing of a single source into chunk rows.

`index_file` handles any `files` row (Canvas-synced, user upload, or URL).
`index_assignment_description` handles the `deadlines.description` text
as a separate source_kind.

Errors are captured into `files.index_error` (or raised for the caller to
surface) — we don't re-raise inside index_file because background sync
shouldn't halt on one bad PDF.
"""
from __future__ import annotations
from datetime import datetime, timezone
from hashlib import sha256
from typing import Awaitable, Callable, Protocol
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from studybuddy.db.models import Chunk, Course, Deadline, File as FileModel, User
from studybuddy.rag import INDEX_VERSION
from studybuddy.rag.chunker import chunk_markdown
from studybuddy.rag.downloader import (
    download_canvas_file,
    download_canvas_page,
    download_canvas_syllabus,
    fetch_url,
)
from studybuddy.rag.parser import ParsedDoc, parse_to_markdown


class _Embedder(Protocol):
    async def embed(self, texts: list[str], *, input_type: str) -> list[list[float]]: ...


DownloaderFn = Callable[..., Awaitable[tuple[bytes, str, str]]]


async def index_file(
    db: AsyncSession,
    *,
    user: User,
    file_id,
    voyage_embedder: _Embedder,
    pat: str | None = None,
    canvas_base_url: str,
    max_bytes: int,
    downloader_fn: DownloaderFn = download_canvas_file,
    chunk_tokens: int = 800,
    chunk_overlap: int = 100,
) -> None:
    f = (await db.execute(select(FileModel).where(FileModel.id == file_id))).scalar_one()
    try:
        raw, content_type, filename = await _download_for_file(
            db, f, pat=pat, canvas_base_url=canvas_base_url,
            max_bytes=max_bytes, downloader_fn=downloader_fn,
        )
        doc = parse_to_markdown(raw, content_type=content_type, filename=filename or f.filename)
        chunks = list(chunk_markdown(doc, target_tokens=chunk_tokens, overlap_tokens=chunk_overlap))
        if not chunks:
            f.index_error = "no content after parse"
            f.indexed_at = None
            return
        texts = [c.text for c in chunks]
        embeddings = await voyage_embedder.embed(texts, input_type="document")
        if len(embeddings) != len(chunks):
            raise RuntimeError(f"embedder returned {len(embeddings)} vecs for {len(chunks)} chunks")

        # Replace any existing chunks for this file.
        await db.execute(delete(Chunk).where(Chunk.file_id == f.id))
        for c, emb in zip(chunks, embeddings):
            db.add(Chunk(
                user_id=user.id, course_id=f.course_id, file_id=f.id,
                source_kind="file",
                content_text=c.text, chunk_index=c.chunk_index, token_count=c.token_count,
                page_hint=c.page_hint, heading_path=c.heading_path,
                embedding=emb,
            ))
        f.indexed_at = datetime.now(timezone.utc)
        f.index_version = INDEX_VERSION
        f.index_error = None
    except Exception as e:  # noqa: BLE001 — we want to keep going on any failure
        f.index_error = f"{type(e).__name__}: {e}"
        f.indexed_at = None
    await db.flush()


async def _download_for_file(
    db: AsyncSession,
    f: FileModel,
    *,
    pat: str | None,
    canvas_base_url: str,
    max_bytes: int,
    downloader_fn: DownloaderFn,
) -> tuple[bytes, str, str]:
    if f.source == "canvas":
        if not pat:
            raise RuntimeError("canvas file download requires pat")
        if f.canvas_file_id is None:
            raise RuntimeError("canvas file row missing canvas_file_id")
        return await downloader_fn(
            canvas_base_url=canvas_base_url,
            pat=pat,
            canvas_file_id=f.canvas_file_id,
            max_bytes=max_bytes,
        )
    if f.source == "canvas_page":
        if not pat:
            raise RuntimeError("canvas page download requires pat")
        if not f.source_url:
            raise RuntimeError("canvas_page row missing source_url (page slug)")
        course = (await db.execute(select(Course).where(Course.id == f.course_id))).scalar_one()
        return await download_canvas_page(
            canvas_base_url=canvas_base_url,
            pat=pat,
            canvas_course_id=course.canvas_course_id,
            page_slug=f.source_url,
            max_bytes=max_bytes,
        )
    if f.source == "canvas_syllabus":
        if not pat:
            raise RuntimeError("canvas syllabus download requires pat")
        course = (await db.execute(select(Course).where(Course.id == f.course_id))).scalar_one()
        return await download_canvas_syllabus(
            canvas_base_url=canvas_base_url,
            pat=pat,
            canvas_course_id=course.canvas_course_id,
            max_bytes=max_bytes,
        )
    if f.source == "url":
        if not f.source_url:
            raise RuntimeError("url-sourced file missing source_url")
        return await fetch_url(f.source_url, max_bytes=max_bytes)
    if f.source == "upload":
        raise RuntimeError(
            "upload-sourced files must be indexed inline via index_upload_bytes()"
        )
    raise RuntimeError(f"unknown file.source: {f.source!r}")


async def index_upload_bytes(
    db: AsyncSession,
    *,
    user: User,
    file_id,
    raw: bytes,
    content_type: str,
    filename: str,
    voyage_embedder: _Embedder,
    chunk_tokens: int = 800,
    chunk_overlap: int = 100,
) -> None:
    """Index an uploaded file whose bytes we already have in memory.

    Called from the upload endpoint's BackgroundTasks hook. We don't round-trip
    the bytes through Canvas/URL — we pass them straight to parse_to_markdown.
    """
    f = (await db.execute(select(FileModel).where(FileModel.id == file_id))).scalar_one()
    try:
        doc = parse_to_markdown(raw, content_type=content_type, filename=filename)
        chunks = list(chunk_markdown(doc, target_tokens=chunk_tokens, overlap_tokens=chunk_overlap))
        if not chunks:
            f.index_error = "no content after parse"
            return
        texts = [c.text for c in chunks]
        embeddings = await voyage_embedder.embed(texts, input_type="document")
        await db.execute(delete(Chunk).where(Chunk.file_id == f.id))
        for c, emb in zip(chunks, embeddings):
            db.add(Chunk(
                user_id=user.id, course_id=f.course_id, file_id=f.id,
                source_kind="file",
                content_text=c.text, chunk_index=c.chunk_index, token_count=c.token_count,
                page_hint=c.page_hint, heading_path=c.heading_path,
                embedding=emb,
            ))
        f.indexed_at = datetime.now(timezone.utc)
        f.index_version = INDEX_VERSION
        f.index_error = None
    except Exception as e:  # noqa: BLE001
        f.index_error = f"{type(e).__name__}: {e}"
        f.indexed_at = None
    await db.flush()


async def index_assignment_description(
    db: AsyncSession,
    *,
    user: User,
    deadline_id,
    voyage_embedder: _Embedder,
    chunk_tokens: int = 800,
    chunk_overlap: int = 100,
) -> None:
    d = (await db.execute(select(Deadline).where(Deadline.id == deadline_id))).scalar_one()
    desc = d.description or ""
    if not desc.strip():
        return
    # HTML-ish description? Strip tags cheaply. For richer parses, trafilatura
    # is available but assignment briefs are short + the LLM tolerates minor noise.
    if "<" in desc and ">" in desc:
        doc = parse_to_markdown(desc.encode("utf-8"), content_type="text/html", filename="assignment.html")
        # Trafilatura refuses very short HTML snippets ("empty HTML tree"). For
        # brief assignment descriptions we still want to index the text, so fall
        # back to a naive tag strip if extraction produced nothing.
        if not doc.markdown.strip():
            import re as _re
            stripped = _re.sub(r"<[^>]+>", " ", desc)
            stripped = _re.sub(r"\s+", " ", stripped).strip()
            doc = ParsedDoc(markdown=stripped)
    else:
        doc = ParsedDoc(markdown=desc)

    chunks = list(chunk_markdown(doc, target_tokens=chunk_tokens, overlap_tokens=chunk_overlap))
    if not chunks:
        return
    embeddings = await voyage_embedder.embed([c.text for c in chunks], input_type="document")

    await db.execute(delete(Chunk).where(Chunk.deadline_id == d.id))
    for c, emb in zip(chunks, embeddings):
        db.add(Chunk(
            user_id=user.id, course_id=d.course_id, deadline_id=d.id,
            source_kind="assignment_description",
            content_text=c.text, chunk_index=c.chunk_index, token_count=c.token_count,
            page_hint=c.page_hint, heading_path=c.heading_path,
            embedding=emb,
        ))
    d.description_hash = sha256(desc.encode("utf-8")).hexdigest()
    await db.flush()
