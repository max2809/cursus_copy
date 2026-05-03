from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from studybuddy.db.models import Chunk, Course, Deadline, File as FileModel, StudyPlan, User


WINDOW_DAYS = 7
MAX_MATERIAL_TASKS_PER_COURSE = 4
MATERIAL_SOURCE_PRIORITY = {
    "canvas_syllabus": 0,
    "canvas_page": 1,
    "canvas": 2,
    "upload": 3,
    "url": 4,
}


def plan_window(today: date) -> tuple[date, date]:
    return today, today + timedelta(days=WINDOW_DAYS - 1)


async def get_available_courses(db: AsyncSession, user: User) -> list[Course]:
    rows = (await db.execute(
        select(Course)
        .where(Course.user_id == user.id)
        .where(Course.name != "")
        .where(Course.name != "(unnamed)")
        .order_by(Course.status.asc(), Course.name.asc())
    )).scalars().all()
    return list(rows)


async def get_current_plan(
    db: AsyncSession,
    user: User,
    *,
    today: date,
) -> StudyPlan | None:
    row = (await db.execute(
        select(StudyPlan)
        .where(StudyPlan.user_id == user.id)
        .where(StudyPlan.week_start <= today)
        .where(StudyPlan.week_end >= today)
        .order_by(StudyPlan.updated_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    return row


def default_selected_canvas_ids(courses: Iterable[Course]) -> list[int]:
    return [c.canvas_course_id for c in courses if c.status == "taking"]


async def study_plan_response(
    db: AsyncSession,
    user: User,
    *,
    today: date,
) -> dict:
    courses = await get_available_courses(db, user)
    plan = await get_current_plan(db, user, today=today)
    selected = (
        [int(v) for v in plan.selected_course_ids]
        if plan is not None
        else default_selected_canvas_ids(courses)
    )
    return {
        "available_courses": [_course_payload(c) for c in courses],
        "selected_canvas_course_ids": selected,
        "plan": serialize_plan(plan) if plan is not None else None,
    }


async def generate_weekly_plan(
    db: AsyncSession,
    user: User,
    *,
    selected_canvas_course_ids: list[int],
    today: date,
) -> StudyPlan:
    available = await get_available_courses(db, user)
    if not selected_canvas_course_ids:
        selected_canvas_course_ids = default_selected_canvas_ids(available)

    selected_set = set(selected_canvas_course_ids)
    selected_courses_by_canvas = {
        c.canvas_course_id: c for c in available if c.canvas_course_id in selected_set
    }
    selected_courses = [
        selected_courses_by_canvas[cid]
        for cid in selected_canvas_course_ids
        if cid in selected_courses_by_canvas
    ]

    start, end = plan_window(today)
    existing = await get_current_plan(db, user, today=today)
    completed = set(str(v) for v in (existing.completed_task_ids if existing else []))
    plan_json = await _build_plan_json(
        db,
        user,
        selected_courses=selected_courses,
        selected_canvas_course_ids=selected_canvas_course_ids,
        start=start,
        end=end,
        completed_task_ids=completed,
    )
    completed = completed & _task_ids(plan_json)

    if existing is None:
        existing = StudyPlan(
            user_id=user.id,
            week_start=start,
            week_end=end,
            selected_course_ids=selected_canvas_course_ids,
            plan_json=plan_json,
            completed_task_ids=sorted(completed),
        )
        db.add(existing)
    else:
        existing.week_start = start
        existing.week_end = end
        existing.selected_course_ids = selected_canvas_course_ids
        existing.plan_json = plan_json
        existing.completed_task_ids = sorted(completed)
        existing.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return existing


async def set_task_done(
    db: AsyncSession,
    user: User,
    *,
    task_id: str,
    done: bool,
    today: date,
) -> bool:
    plan = await get_current_plan(db, user, today=today)
    if plan is None:
        return False
    if task_id not in _task_ids(plan.plan_json):
        return False

    completed = set(str(v) for v in (plan.completed_task_ids or []))
    if done:
        completed.add(task_id)
    else:
        completed.discard(task_id)
    plan.completed_task_ids = sorted(completed)
    plan.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return True


def serialize_plan(plan: StudyPlan) -> dict:
    payload = dict(plan.plan_json or {})
    payload["id"] = str(plan.id)
    payload["week_start"] = _date_iso(plan.week_start)
    payload["week_end"] = _date_iso(plan.week_end)
    completed = set(str(v) for v in (plan.completed_task_ids or []))
    for course in payload.get("courses", []):
        for task in course.get("tasks", []):
            task["done"] = task.get("id") in completed
    return payload


async def _build_plan_json(
    db: AsyncSession,
    user: User,
    *,
    selected_courses: list[Course],
    selected_canvas_course_ids: list[int],
    start: date,
    end: date,
    completed_task_ids: set[str],
) -> dict:
    course_ids = [c.id for c in selected_courses]
    deadlines = await _load_deadlines(db, user=user, course_ids=course_ids, end=end)
    chunks = await _load_material_chunks(db, user=user, course_ids=course_ids)

    deadlines_by_course: dict[str, list[Deadline]] = defaultdict(list)
    for d in deadlines:
        deadlines_by_course[str(d.course_id)].append(d)

    chunks_by_course: dict[str, list[tuple[Chunk, FileModel | None]]] = defaultdict(list)
    for chunk, file in chunks:
        chunks_by_course[str(chunk.course_id)].append((chunk, file))

    pressure_points: list[dict] = []
    course_payloads: list[dict] = []
    for course in selected_courses:
        course_deadlines = deadlines_by_course.get(str(course.id), [])
        material_tasks = _material_tasks(
            course,
            chunks_by_course.get(str(course.id), []),
            completed_task_ids=completed_task_ids,
        )
        deadline_tasks = [
            _deadline_task(course, d, start=start, end=end, completed_task_ids=completed_task_ids)
            for d in course_deadlines
        ]
        for d in course_deadlines:
            if d.due_at is not None:
                pressure_points.append(_pressure_point(course, d, start=start, end=end))

        tasks = material_tasks + deadline_tasks
        if not tasks:
            tasks = [_fallback_task(course)]

        course_payloads.append({
            **_course_payload(course),
            "confidence": _confidence(material_tasks, deadline_tasks),
            "tasks": tasks,
        })

    pressure_points.sort(key=lambda p: (p["due_at"] or "9999-12-31", p["course_name"].lower()))
    return {
        "week_start": start.isoformat(),
        "week_end": end.isoformat(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "selected_canvas_course_ids": selected_canvas_course_ids,
        "pressure_points": pressure_points,
        "courses": course_payloads,
    }


async def _load_deadlines(
    db: AsyncSession,
    *,
    user: User,
    course_ids: list,
    end: date,
) -> list[Deadline]:
    if not course_ids:
        return []
    end_exclusive = datetime.combine(end + timedelta(days=1), time.min, tzinfo=timezone.utc)
    rows = (await db.execute(
        select(Deadline)
        .where(Deadline.user_id == user.id)
        .where(Deadline.course_id.in_(course_ids))
        .order_by(Deadline.due_at.asc().nullslast(), Deadline.title.asc())
    )).scalars().all()
    out: list[Deadline] = []
    for d in rows:
        if bool(d.submitted) or bool(d.manually_submitted):
            continue
        if d.due_at is not None and _as_utc(d.due_at) >= end_exclusive:
            continue
        out.append(d)
    return out


async def _load_material_chunks(
    db: AsyncSession,
    *,
    user: User,
    course_ids: list,
) -> list[tuple[Chunk, FileModel | None]]:
    if not course_ids:
        return []
    rows = (await db.execute(
        select(Chunk, FileModel)
        .join(FileModel, Chunk.file_id == FileModel.id, isouter=True)
        .where(Chunk.user_id == user.id)
        .where(Chunk.course_id.in_(course_ids))
        .order_by(Chunk.chunk_index.asc())
    )).all()
    return sorted(
        [(chunk, file) for chunk, file in rows if file is not None],
        key=lambda pair: (
            str(pair[0].course_id),
            MATERIAL_SOURCE_PRIORITY.get(pair[1].source if pair[1] else "", 9),
            pair[1].filename if pair[1] else "",
            pair[0].chunk_index,
        ),
    )


def _course_payload(course: Course) -> dict:
    return {
        "id": str(course.id),
        "canvas_course_id": course.canvas_course_id,
        "name": course.name,
        "code": course.code,
        "status": course.status,
    }


def _material_tasks(
    course: Course,
    chunks: list[tuple[Chunk, FileModel | None]],
    *,
    completed_task_ids: set[str],
) -> list[dict]:
    tasks: list[dict] = []
    seen: set[str] = set()
    for chunk, file in chunks:
        if len(tasks) >= MAX_MATERIAL_TASKS_PER_COURSE:
            break
        title = _topic_title(chunk, file)
        key = _slug(title)
        if key in seen:
            continue
        seen.add(key)
        task_id = f"c{course.canvas_course_id}-file-{file.id}-chunk-{chunk.chunk_index}"
        tasks.append({
            "id": task_id,
            "title": f"Study {title}",
            "detail": _clip_sentence(chunk.content_text),
            "priority": "recommended",
            "reason": "Current course material indexed from Canvas.",
            "source_refs": [_file_source_ref(course, file)],
            "done": task_id in completed_task_ids,
        })
    return tasks


def _deadline_task(
    course: Course,
    deadline: Deadline,
    *,
    start: date,
    end: date,
    completed_task_ids: set[str],
) -> dict:
    action = "Prepare for" if deadline.type in {"quiz", "exam"} else "Complete"
    task_id = f"c{course.canvas_course_id}-deadline-{deadline.id}"
    return {
        "id": task_id,
        "title": f"{action} {deadline.title}",
        "detail": _deadline_detail(deadline),
        "priority": _deadline_priority(deadline, start=start, end=end),
        "reason": _deadline_reason(deadline, start=start, end=end),
        "source_refs": [{
            "label": deadline.title,
            "kind": deadline.type,
            "url": deadline.url,
        }],
        "done": task_id in completed_task_ids,
    }


def _pressure_point(course: Course, deadline: Deadline, *, start: date, end: date) -> dict:
    return {
        "id": f"pressure-c{course.canvas_course_id}-deadline-{deadline.id}",
        "course_id": str(course.id),
        "canvas_course_id": course.canvas_course_id,
        "course_name": course.name,
        "title": deadline.title,
        "type": deadline.type,
        "due_at": _datetime_iso(deadline.due_at),
        "priority": _deadline_priority(deadline, start=start, end=end),
        "reason": _deadline_reason(deadline, start=start, end=end),
    }


def _fallback_task(course: Course) -> dict:
    task_id = f"c{course.canvas_course_id}-review-canvas"
    return {
        "id": task_id,
        "title": f"Review current Canvas material for {course.name}",
        "detail": "Cursus has not found enough indexed material or upcoming deadlines for a detailed breakdown yet.",
        "priority": "low",
        "reason": "Fallback step until more course structure is synced or indexed.",
        "source_refs": [],
        "done": False,
    }


def _topic_title(chunk: Chunk, file: FileModel | None) -> str:
    if chunk.heading_path:
        parts = [p.strip() for p in re.split(r"[/>\n]+", chunk.heading_path) if p.strip()]
        if parts:
            return parts[-1]
    if file and file.filename:
        return Path(file.filename).stem
    return _clip_sentence(chunk.content_text, max_chars=72)


def _file_source_ref(course: Course, file: FileModel | None) -> dict:
    if file is None:
        return {"label": course.name, "kind": "material", "url": None}
    url: str | None = None
    if file.source == "canvas":
        url = f"/api/courses/{course.canvas_course_id}/materials/{file.id}/download"
    elif file.source == "url":
        url = file.source_url
    return {
        "label": file.filename,
        "kind": file.source,
        "url": url,
    }


def _deadline_detail(deadline: Deadline) -> str:
    due = _datetime_iso(deadline.due_at)
    if due:
        return f"Due {due[:10]}. Use the assignment instructions and related course material before attempting it."
    return "No due date is set in Canvas. Keep it visible so it does not fall through the cracks."


def _deadline_reason(deadline: Deadline, *, start: date, end: date) -> str:
    if deadline.due_at is None:
        return "Canvas lists this item without a due date."
    due_day = _as_utc(deadline.due_at).date()
    if due_day < start:
        return "Overdue item from Canvas."
    if due_day <= end:
        return "Deadline falls inside this weekly checklist window."
    return "Upcoming course requirement."


def _deadline_priority(deadline: Deadline, *, start: date, end: date) -> str:
    if deadline.due_at is None:
        return "low"
    due_day = _as_utc(deadline.due_at).date()
    if due_day < start or due_day <= start + timedelta(days=3):
        return "high"
    if due_day <= end:
        return "medium"
    return "low"


def _confidence(material_tasks: list[dict], deadline_tasks: list[dict]) -> str:
    if material_tasks and deadline_tasks:
        return "high"
    if material_tasks or deadline_tasks:
        return "medium"
    return "low"


def _task_ids(plan_json: dict) -> set[str]:
    ids: set[str] = set()
    for course in plan_json.get("courses", []):
        for task in course.get("tasks", []):
            if task.get("id"):
                ids.add(str(task["id"]))
    return ids


def _clip_sentence(text: str, max_chars: int = 180) -> str:
    cleaned = " ".join((text or "").split())
    if len(cleaned) <= max_chars:
        return cleaned
    return cleaned[: max_chars - 3].rstrip() + "..."


def _slug(text: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return value or "topic"


def _as_utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _datetime_iso(dt: datetime | None) -> str | None:
    return _as_utc(dt).isoformat() if dt else None


def _date_iso(value) -> str:
    return value.isoformat() if hasattr(value, "isoformat") else str(value)
