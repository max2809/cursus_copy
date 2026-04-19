from dataclasses import dataclass, field
from datetime import datetime, timezone
from hashlib import sha256
from uuid import UUID
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from studybuddy.canvas.classify import classify_deadline
from studybuddy.canvas.client import CanvasClient, CanvasUnauthorized
from studybuddy.db.models import Course, Deadline, File as FileModel, User
from studybuddy.rag import INDEX_VERSION
from studybuddy.security.crypto import decrypt_pat


@dataclass
class SyncResult:
    pending_file_ids: list[UUID] = field(default_factory=list)
    pending_deadline_ids: list[UUID] = field(default_factory=list)


async def _safe_get(client: CanvasClient, path: str, params: dict | None = None) -> list[dict]:
    """Canvas returns 404 (feature disabled) or 403 (student lacks permission) on
    optional per-course resources. Treat as empty so one gap doesn't abort the sync."""
    try:
        return await client.get_paginated(path, params=params)
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (403, 404):
            return []
        raise


async def sync_user(db: AsyncSession, user: User, master_key: bytes) -> SyncResult:
    if user.pat_encrypted is None or user.pat_nonce is None:
        raise ValueError("user has no PAT configured")

    try:
        pat = decrypt_pat(user.pat_encrypted, user.pat_nonce, master_key)
    except Exception as e:
        raise ValueError("failed to decrypt stored PAT") from e

    client = CanvasClient(base_url=user.canvas_base_url, token=pat)

    try:
        courses_payload = await client.get_paginated(
            "/api/v1/courses",
            params={"enrollment_state": "active", "include[]": "term"},
        )
    except CanvasUnauthorized:
        user.pat_encrypted = None
        user.pat_nonce = None
        await db.flush()
        raise

    for c in courses_payload:
        await _upsert_course(db, user.id, c)

    courses = (await db.execute(select(Course).where(Course.user_id == user.id))).scalars().all()
    for course in courses:
        assignments = await _safe_get(
            client,
            f"/api/v1/courses/{course.canvas_course_id}/assignments",
            params={"include[]": "submission"},
        )
        for a in assignments:
            await _upsert_deadline(db, user.id, course.id, "assignment", a)

        quizzes = await _safe_get(client, f"/api/v1/courses/{course.canvas_course_id}/quizzes")
        for q in quizzes:
            await _upsert_deadline(db, user.id, course.id, "quiz", q)

        events = await _safe_get(
            client,
            "/api/v1/calendar_events",
            params={"context_codes[]": f"course_{course.canvas_course_id}", "type": "event"},
        )
        for e in events:
            await _upsert_deadline(db, user.id, course.id, "calendar_event", e)

        files = await _safe_get(client, f"/api/v1/courses/{course.canvas_course_id}/files")
        for f in files:
            await _upsert_file(db, user.id, course.id, f)

        # Module walker — picks up files and pages embedded in modules even
        # when the Files tab is restricted to students (403 on /files).
        modules = await _safe_get(
            client,
            f"/api/v1/courses/{course.canvas_course_id}/modules",
            params={"include[]": "items"},
        )
        for m in modules:
            for item in m.get("items") or []:
                itype = item.get("type")
                if itype == "File":
                    file_id = item.get("content_id")
                    if file_id is None:
                        continue
                    # Fetch this file's metadata directly. The per-file endpoint
                    # often works even when listing /files is 403.
                    try:
                        one = await client.get_paginated(f"/api/v1/files/{file_id}")
                        payload = one[0] if one else None
                    except httpx.HTTPStatusError:
                        payload = None
                    if payload:
                        await _upsert_file(db, user.id, course.id, payload)
                elif itype == "Page":
                    page_url = item.get("page_url")
                    if not page_url:
                        continue
                    await _upsert_page(
                        db,
                        user.id,
                        course.id,
                        page_slug=page_url,
                        title=item.get("title") or page_url,
                        html_url=item.get("html_url") or "",
                    )

    user.last_synced_at = datetime.now(timezone.utc)
    await db.flush()

    return await _pending_indexing(db, user)


async def _pending_indexing(db: AsyncSession, user: User) -> SyncResult:
    """Collect files/deadlines that need indexing after this sync.

    Files: indexed_at is NULL OR index_version < INDEX_VERSION OR
           updated_at > indexed_at.
    Deadlines: description is non-empty AND
               (description_hash is NULL OR hash(description) != description_hash).
    """
    pending_files = (await db.execute(
        select(FileModel.id).where(
            FileModel.user_id == user.id,
            FileModel.deleted_at.is_(None),
            (
                FileModel.indexed_at.is_(None)
                | (FileModel.index_version.is_(None))
                | (FileModel.index_version < INDEX_VERSION)
                | (
                    FileModel.updated_at.is_not(None)
                    & (FileModel.updated_at > FileModel.indexed_at)
                )
            ),
        )
    )).scalars().all()

    deadline_rows = (await db.execute(
        select(Deadline).where(Deadline.user_id == user.id)
    )).scalars().all()
    pending_deadlines: list = []
    for d in deadline_rows:
        desc = (d.description or "").strip()
        if not desc:
            continue
        h = sha256((d.description or "").encode("utf-8")).hexdigest()
        if d.description_hash != h:
            pending_deadlines.append(d.id)

    return SyncResult(
        pending_file_ids=list(pending_files),
        pending_deadline_ids=pending_deadlines,
    )


def _course_dates(payload: dict):
    """Pull start/end dates from the course itself or fall through to its term.
    Canvas often leaves end_at null on the course object but populated on term.end_at."""
    term = payload.get("term") if isinstance(payload.get("term"), dict) else {}
    start_raw = payload.get("start_at") or term.get("start_at")
    end_raw = payload.get("end_at") or term.get("end_at")

    def _to_date(raw):
        if not raw:
            return None
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
        except Exception:
            return None

    return _to_date(start_raw), _to_date(end_raw)


async def _upsert_course(db: AsyncSession, user_id, payload: dict) -> None:
    existing = (await db.execute(
        select(Course).where(Course.user_id == user_id, Course.canvas_course_id == payload["id"])
    )).scalar_one_or_none()
    start_date, end_date = _course_dates(payload)
    if existing is None:
        db.add(Course(
            user_id=user_id,
            canvas_course_id=payload["id"],
            name=payload.get("name") or "(unnamed)",
            code=payload.get("course_code"),
            start_date=start_date,
            end_date=end_date,
            synced_at=datetime.now(timezone.utc),
        ))
    else:
        existing.name = payload.get("name") or existing.name
        existing.code = payload.get("course_code") or existing.code
        # Always refresh dates so a term update in Canvas propagates.
        existing.start_date = start_date
        existing.end_date = end_date
        existing.synced_at = datetime.now(timezone.utc)
    await db.flush()


async def _upsert_deadline(db: AsyncSession, user_id, course_id, source_type: str, payload: dict) -> None:
    source_id = str(payload["id"])
    due_at_field = "due_at" if source_type != "calendar_event" else "end_at"
    due_raw = payload.get(due_at_field)
    due_at = datetime.fromisoformat(due_raw.replace("Z", "+00:00")) if due_raw else None

    existing = (await db.execute(
        select(Deadline).where(
            Deadline.user_id == user_id,
            Deadline.canvas_source_type == source_type,
            Deadline.canvas_source_id == source_id,
        )
    )).scalar_one_or_none()

    title = payload.get("name") or payload.get("title") or "(untitled)"
    url = payload.get("html_url") or ""
    dtype = classify_deadline(source_type, payload)
    description = payload.get("description")

    # Per-user submission state (only meaningful for assignments).
    # `include[]=submission` on /assignments returns a `submission` object for the current user.
    submitted: bool | None = None
    if source_type == "assignment":
        submission = payload.get("submission") or {}
        submitted_at = submission.get("submitted_at")
        workflow = submission.get("workflow_state")
        submitted = bool(submitted_at) or workflow in ("submitted", "graded", "complete")

    if existing is None:
        db.add(Deadline(
            user_id=user_id,
            course_id=course_id,
            canvas_source_type=source_type,
            canvas_source_id=source_id,
            title=title,
            description=description,
            due_at=due_at,
            url=url,
            type=dtype,
            points_possible=payload.get("points_possible"),
            submitted=submitted,
            synced_at=datetime.now(timezone.utc),
        ))
    else:
        existing.title = title
        existing.description = description
        existing.due_at = due_at
        existing.url = url
        existing.type = dtype
        existing.points_possible = payload.get("points_possible")
        if source_type == "assignment":
            existing.submitted = submitted
        existing.synced_at = datetime.now(timezone.utc)


async def _upsert_file(db: AsyncSession, user_id, course_id, payload: dict) -> None:
    existing = (await db.execute(
        select(FileModel).where(FileModel.user_id == user_id, FileModel.canvas_file_id == payload["id"])
    )).scalar_one_or_none()
    updated_at_raw = payload.get("updated_at")
    updated_at = datetime.fromisoformat(updated_at_raw.replace("Z", "+00:00")) if updated_at_raw else None

    if existing is None:
        db.add(FileModel(
            user_id=user_id,
            course_id=course_id,
            canvas_file_id=payload["id"],
            filename=payload.get("display_name") or payload.get("filename") or "(unnamed)",
            content_type=payload.get("content-type") or payload.get("content_type"),
            url=payload.get("url") or "",
            size_bytes=payload.get("size"),
            folder_path=payload.get("folder_path"),
            updated_at=updated_at,
            synced_at=datetime.now(timezone.utc),
        ))
    else:
        existing.filename = payload.get("display_name") or payload.get("filename") or existing.filename
        existing.content_type = payload.get("content-type") or payload.get("content_type") or existing.content_type
        existing.url = payload.get("url") or existing.url
        existing.size_bytes = payload.get("size")
        existing.folder_path = payload.get("folder_path")
        existing.updated_at = updated_at
        existing.synced_at = datetime.now(timezone.utc)


async def _upsert_page(
    db: AsyncSession,
    user_id,
    course_id,
    *,
    page_slug: str,
    title: str,
    html_url: str,
) -> None:
    """Upsert a Canvas Page as a FileModel with source='canvas_page'.

    page_slug (the Canvas page URL path) is stored in source_url so the
    indexer can re-fetch the page body via the Pages API. We keep
    canvas_file_id NULL to distinguish from actual uploaded files.
    Identity is (user_id, course_id, source='canvas_page', source_url=slug).
    """
    existing = (await db.execute(
        select(FileModel).where(
            FileModel.user_id == user_id,
            FileModel.course_id == course_id,
            FileModel.source == "canvas_page",
            FileModel.source_url == page_slug,
        )
    )).scalar_one_or_none()

    now = datetime.now(timezone.utc)
    if existing is None:
        db.add(FileModel(
            user_id=user_id,
            course_id=course_id,
            canvas_file_id=None,
            filename=title,
            content_type="text/html",
            url=html_url,
            source="canvas_page",
            source_url=page_slug,
            uploaded_at=now,
            synced_at=now,
        ))
    else:
        existing.filename = title or existing.filename
        existing.url = html_url or existing.url
        existing.synced_at = now
