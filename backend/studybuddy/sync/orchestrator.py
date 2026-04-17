from datetime import datetime, timezone
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from studybuddy.canvas.classify import classify_deadline
from studybuddy.canvas.client import CanvasClient, CanvasUnauthorized
from studybuddy.db.models import Course, Deadline, File as FileModel, User
from studybuddy.security.crypto import decrypt_pat


async def _safe_get(client: CanvasClient, path: str, params: dict | None = None) -> list[dict]:
    """Canvas returns 404 when a per-course feature (quizzes/files/etc.) is disabled.
    Treat that as an empty collection so one disabled feature doesn't abort the sync."""
    try:
        return await client.get_paginated(path, params=params)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return []
        raise


async def sync_user(db: AsyncSession, user: User, master_key: bytes) -> None:
    if user.pat_encrypted is None or user.pat_nonce is None:
        raise ValueError("user has no PAT configured")

    try:
        pat = decrypt_pat(user.pat_encrypted, user.pat_nonce, master_key)
    except Exception as e:
        raise ValueError("failed to decrypt stored PAT") from e

    client = CanvasClient(base_url=user.canvas_base_url, token=pat)

    try:
        courses_payload = await client.get_paginated(
            "/api/v1/courses", params={"enrollment_state": "active"}
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
        assignments = await _safe_get(client, f"/api/v1/courses/{course.canvas_course_id}/assignments")
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

    user.last_synced_at = datetime.now(timezone.utc)
    await db.flush()


async def _upsert_course(db: AsyncSession, user_id, payload: dict) -> None:
    existing = (await db.execute(
        select(Course).where(Course.user_id == user_id, Course.canvas_course_id == payload["id"])
    )).scalar_one_or_none()
    if existing is None:
        db.add(Course(
            user_id=user_id,
            canvas_course_id=payload["id"],
            name=payload.get("name") or "(unnamed)",
            code=payload.get("course_code"),
            synced_at=datetime.now(timezone.utc),
        ))
    else:
        existing.name = payload.get("name") or existing.name
        existing.code = payload.get("course_code") or existing.code
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
            submitted=(payload.get("has_submitted_submissions") if source_type == "assignment" else None),
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
            existing.submitted = payload.get("has_submitted_submissions")
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
