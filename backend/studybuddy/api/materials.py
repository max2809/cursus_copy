"""Materials endpoints: list / upload / url / delete / refresh / download."""
from __future__ import annotations
import io
import logging
import re
import zipfile
from datetime import datetime, timezone
from typing import Literal
from urllib.parse import unquote, urlparse
from uuid import UUID

import httpx
from fastapi import (
    APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

from studybuddy.auth.deps import current_user
from studybuddy.chat.deps import get_embedder, resolve_course
from studybuddy.config import get_settings
from studybuddy.db.base import AsyncSessionLocal, get_db
from studybuddy.db.models import Chunk, File as FileModel, User
from studybuddy.rag.indexer import index_assignment_description, index_file, index_upload_bytes
from studybuddy.security.crypto import decrypt_pat
from studybuddy.sync.orchestrator import SyncResult, sync_user


router = APIRouter(prefix="/api/courses/{canvas_course_id}/materials", tags=["materials"])


_UPLOAD_MIME_ALLOW = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
    "text/x-markdown",
}


class MaterialResponse(BaseModel):
    id: UUID
    filename: str
    source: Literal["canvas", "canvas_page", "canvas_syllabus", "upload", "url"]
    source_url: str | None = None
    size_bytes: int | None = None
    content_type: str | None = None
    indexed_at: datetime | None = None
    index_error: str | None = None
    updated_at: datetime | None = None


class MaterialsListResponse(BaseModel):
    materials: list[MaterialResponse]


class AddUrlPayload(BaseModel):
    url: str


@router.get("", response_model=MaterialsListResponse)
async def list_materials(
    canvas_course_id: int,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> MaterialsListResponse:
    course = await resolve_course(db, user=user, canvas_course_id=canvas_course_id)
    rows = (await db.execute(
        select(FileModel)
        .where(FileModel.course_id == course.id, FileModel.deleted_at.is_(None))
        .order_by(
            # canvas < upload < url so Canvas sorts first lexically; we want same.
            FileModel.source.asc(),
            FileModel.filename.asc(),
        )
    )).scalars().all()
    return MaterialsListResponse(
        materials=[MaterialResponse(
            id=r.id, filename=r.filename, source=r.source,
            source_url=r.source_url, size_bytes=r.size_bytes,
            content_type=r.content_type, indexed_at=r.indexed_at,
            index_error=r.index_error, updated_at=r.updated_at,
        ) for r in rows]
    )


@router.post("", response_model=MaterialResponse)
async def upload_material(
    canvas_course_id: int,
    background: BackgroundTasks,
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> MaterialResponse:
    course = await resolve_course(db, user=user, canvas_course_id=canvas_course_id)
    settings = get_settings()

    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in _UPLOAD_MIME_ALLOW:
        raise HTTPException(status_code=415, detail=f"unsupported content_type: {content_type!r}")

    raw = await file.read()
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="empty upload")
    if len(raw) > settings.rag_max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail="file exceeds upload cap")

    row = FileModel(
        user_id=user.id, course_id=course.id,
        filename=file.filename or "(untitled)",
        content_type=content_type,
        url="",  # no canvas-side URL for uploads
        size_bytes=len(raw),
        source="upload",
        uploaded_at=datetime.now(timezone.utc),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)

    background.add_task(
        _index_upload_in_background,
        user_id=user.id,
        file_id=row.id,
        raw=raw,
        content_type=content_type,
        filename=row.filename,
        chunk_tokens=settings.rag_chunk_tokens,
        chunk_overlap=settings.rag_chunk_overlap,
    )
    return _to_response(row)


@router.post("/url", response_model=MaterialResponse)
async def add_url_material(
    canvas_course_id: int,
    payload: AddUrlPayload,
    background: BackgroundTasks,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> MaterialResponse:
    course = await resolve_course(db, user=user, canvas_course_id=canvas_course_id)
    parsed = urlparse(payload.url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise HTTPException(status_code=400, detail="url must be http(s) with a hostname")

    filename = unquote(parsed.path.rsplit("/", 1)[-1]) or parsed.hostname
    settings = get_settings()
    row = FileModel(
        user_id=user.id, course_id=course.id,
        filename=filename,
        content_type=None,  # determined at fetch time
        url=payload.url,
        source="url",
        source_url=payload.url,
        uploaded_at=datetime.now(timezone.utc),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)

    background.add_task(
        _index_file_in_background,
        user_id=user.id,
        file_id=row.id,
        pat=None,
        canvas_base_url=user.canvas_base_url,
        max_bytes=settings.rag_max_upload_mb * 1024 * 1024,
        chunk_tokens=settings.rag_chunk_tokens,
        chunk_overlap=settings.rag_chunk_overlap,
    )
    return _to_response(row)


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_material(
    canvas_course_id: int,
    file_id: UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    course = await resolve_course(db, user=user, canvas_course_id=canvas_course_id)
    row = (await db.execute(
        select(FileModel).where(
            FileModel.id == file_id,
            FileModel.course_id == course.id,
            FileModel.user_id == user.id,
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="material not found")
    if row.source == "canvas":
        raise HTTPException(status_code=400, detail="cannot delete canvas-synced materials")
    await db.execute(delete(Chunk).where(Chunk.file_id == row.id))
    await db.delete(row)
    await db.commit()


_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._\- ()]+")


def _safe_filename(name: str) -> str:
    """Strip characters that can confuse zip clients or file systems."""
    cleaned = _SAFE_FILENAME_RE.sub("_", name).strip() or "file"
    return cleaned[:200]


@router.get("/download")
async def download_all_materials(
    canvas_course_id: int,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stream a zip of every downloadable Canvas file for this course.

    Uploads (user-added via our UI) aren't bundled — we don't persist their
    bytes once they're indexed. Canvas pages are also skipped (no file body).
    Buffers in memory; fine for ~hundreds of MB on the current plan.
    """
    if user.pat_encrypted is None or user.pat_nonce is None:
        raise HTTPException(status_code=400, detail="connect your Canvas PAT first")
    settings = get_settings()
    course = await resolve_course(db, user=user, canvas_course_id=canvas_course_id)
    files = (
        await db.execute(
            select(FileModel)
            .where(
                FileModel.course_id == course.id,
                FileModel.deleted_at.is_(None),
                FileModel.source == "canvas",
                FileModel.url != "",
            )
            .order_by(FileModel.filename.asc())
        )
    ).scalars().all()
    if not files:
        raise HTTPException(status_code=404, detail="no Canvas files to download")

    pat = decrypt_pat(user.pat_encrypted, user.pat_nonce, settings.master_key_bytes())

    buf = io.BytesIO()
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            seen: dict[str, int] = {}
            for f in files:
                try:
                    resp = await client.get(
                        f.url, headers={"Authorization": f"Bearer {pat}"}
                    )
                    resp.raise_for_status()
                except Exception:
                    logger.warning("download_all: fetch failed for %s", f.filename)
                    continue
                name = _safe_filename(f.filename)
                # De-dupe if multiple files have the same sanitised name.
                count = seen.get(name, 0)
                if count > 0:
                    root, _, ext = name.rpartition(".")
                    name = f"{root} ({count}).{ext}" if root else f"{name} ({count})"
                seen[_safe_filename(f.filename)] = count + 1
                zf.writestr(name, resp.content)

    buf.seek(0)
    zip_name = _safe_filename(f"{course.name} — materials") + ".zip"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_name}"'},
    )


@router.get("/{file_id}/download")
async def download_single_material(
    canvas_course_id: int,
    file_id: UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stream a single file's bytes back to the browser.

    Canvas-sourced files are fetched with the user's PAT (the `url` on a File
    is a Canvas-signed redirect that respects Bearer auth). Uploads and
    canvas_pages have no persisted body on our side, so they 404.
    """
    if user.pat_encrypted is None or user.pat_nonce is None:
        raise HTTPException(status_code=400, detail="connect your Canvas PAT first")
    settings = get_settings()
    course = await resolve_course(db, user=user, canvas_course_id=canvas_course_id)
    f = (
        await db.execute(
            select(FileModel).where(
                FileModel.id == file_id,
                FileModel.course_id == course.id,
                FileModel.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if f is None:
        raise HTTPException(status_code=404, detail="file not found")
    if f.source != "canvas" or not f.url:
        raise HTTPException(status_code=404, detail="no downloadable body for this material")

    pat = decrypt_pat(user.pat_encrypted, user.pat_nonce, settings.master_key_bytes())
    try:
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            resp = await client.get(
                f.url, headers={"Authorization": f"Bearer {pat}"}
            )
            resp.raise_for_status()
    except Exception as e:
        logger.warning("download_single: fetch failed for %s: %s", f.filename, e)
        raise HTTPException(status_code=502, detail="failed to fetch from Canvas")

    filename = _safe_filename(f.filename)
    return StreamingResponse(
        iter([resp.content]),
        media_type=f.content_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/refresh", response_model=MaterialsListResponse)
async def refresh_materials(
    canvas_course_id: int,
    background: BackgroundTasks,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> MaterialsListResponse:
    settings = get_settings()
    if user.pat_encrypted is None or user.pat_nonce is None:
        raise HTTPException(status_code=400, detail="connect your Canvas PAT first")
    await resolve_course(db, user=user, canvas_course_id=canvas_course_id)

    result = await sync_user(db, user, master_key=settings.master_key_bytes())
    await db.commit()

    pat = decrypt_pat(user.pat_encrypted, user.pat_nonce, settings.master_key_bytes())
    enqueue_pending_indexing(background, user=user, pat=pat, result=result)
    return await list_materials(canvas_course_id=canvas_course_id, user=user, db=db)


async def _index_upload_in_background(
    *,
    user_id,
    file_id,
    raw: bytes,
    content_type: str,
    filename: str,
    chunk_tokens: int,
    chunk_overlap: int,
) -> None:
    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one()
        embedder = get_embedder()
        try:
            await index_upload_bytes(
                db,
                user=user,
                file_id=file_id,
                raw=raw,
                content_type=content_type,
                filename=filename,
                voyage_embedder=embedder,
                chunk_tokens=chunk_tokens,
                chunk_overlap=chunk_overlap,
            )
            await db.commit()
        except Exception:
            await db.rollback()
            raise


async def _index_file_in_background(
    *,
    user_id,
    file_id,
    pat: str | None,
    canvas_base_url: str,
    max_bytes: int,
    chunk_tokens: int,
    chunk_overlap: int,
) -> None:
    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one()
        embedder = get_embedder()
        try:
            await index_file(
                db,
                user=user,
                file_id=file_id,
                voyage_embedder=embedder,
                pat=pat,
                canvas_base_url=canvas_base_url,
                max_bytes=max_bytes,
                chunk_tokens=chunk_tokens,
                chunk_overlap=chunk_overlap,
            )
            await db.commit()
        except Exception:
            await db.rollback()
            raise


async def _index_assignment_description_in_background(
    *,
    user_id,
    deadline_id,
    chunk_tokens: int,
    chunk_overlap: int,
) -> None:
    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one()
        embedder = get_embedder()
        try:
            await index_assignment_description(
                db,
                user=user,
                deadline_id=deadline_id,
                voyage_embedder=embedder,
                chunk_tokens=chunk_tokens,
                chunk_overlap=chunk_overlap,
            )
            await db.commit()
        except Exception:
            await db.rollback()
            raise


def enqueue_pending_indexing(
    background: BackgroundTasks,
    *,
    user: User,
    pat: str | None,
    result: SyncResult,
) -> None:
    """Schedule background indexing for every (file + deadline) that sync flagged pending.

    pat may be None for url-sourced files. Canvas-sourced files and canvas_page
    files both need the PAT — skip them silently when pat is None.
    """
    settings = get_settings()
    max_bytes = settings.rag_max_upload_mb * 1024 * 1024
    for file_id in result.pending_file_ids:
        background.add_task(
            _index_file_in_background,
            user_id=user.id,
            file_id=file_id,
            pat=pat,
            canvas_base_url=user.canvas_base_url,
            max_bytes=max_bytes,
            chunk_tokens=settings.rag_chunk_tokens,
            chunk_overlap=settings.rag_chunk_overlap,
        )
    for deadline_id in result.pending_deadline_ids:
        background.add_task(
            _index_assignment_description_in_background,
            user_id=user.id,
            deadline_id=deadline_id,
            chunk_tokens=settings.rag_chunk_tokens,
            chunk_overlap=settings.rag_chunk_overlap,
        )


def _to_response(r: FileModel) -> MaterialResponse:
    return MaterialResponse(
        id=r.id, filename=r.filename, source=r.source,
        source_url=r.source_url, size_bytes=r.size_bytes,
        content_type=r.content_type, indexed_at=r.indexed_at,
        index_error=r.index_error, updated_at=r.updated_at,
    )
