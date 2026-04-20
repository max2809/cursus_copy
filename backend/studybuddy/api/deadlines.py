from datetime import datetime, timedelta, timezone
from uuid import UUID
from zoneinfo import ZoneInfo
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from studybuddy.auth.deps import current_user
from studybuddy.config import get_settings
from studybuddy.db.base import get_db
from studybuddy.db.models import Course, Deadline, User
from studybuddy.sync.background import is_syncing, sync_and_index_background


router = APIRouter(prefix="/api", tags=["deadlines"])

STALE_MINUTES = 30
# Don't show deadlines older than this — hides items from past semesters
# whose courses Canvas still reports as "active."
RECENT_CUTOFF_DAYS = 30
AMS = ZoneInfo("Europe/Amsterdam")
BUCKET_ORDER = ("overdue", "today", "this_week", "next_two_weeks", "later", "no_due_date")


def _as_utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _empty_buckets() -> dict[str, list]:
    return {k: [] for k in BUCKET_ORDER}


@router.get("/deadlines")
async def get_deadlines(
    background: BackgroundTasks,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    settings = get_settings()
    stale = (
        user.last_synced_at is None
        or _as_utc(user.last_synced_at) < datetime.now(timezone.utc) - timedelta(minutes=STALE_MINUTES)
    )
    if stale and user.pat_encrypted is not None and not is_syncing(user.id):
        # Fire sync in the background so the dashboard never blocks. The
        # poller will see courses appear as each per-course commit lands.
        background.add_task(sync_and_index_background, user.id, settings.master_key_bytes())

    cutoff = datetime.now(timezone.utc) - timedelta(days=RECENT_CUTOFF_DAYS)

    # Visibility is user-controlled now via Course.status. Show all non-hidden
    # courses, even ones without any dated deadlines. That way a newly-synced
    # "taking" course with empty deadlines still appears in the sidebar so the
    # user can chat with it, and archived ("taken") courses remain accessible.
    all_courses_q = (
        select(Course)
        .where(Course.user_id == user.id, Course.status != "hidden")
    )
    all_courses = (await db.execute(all_courses_q)).scalars().all()

    # Deadlines: only pull recent/future dated items + null-due items, for
    # non-hidden courses. Past-semester garbage stays filtered out.
    q = (
        select(Deadline, Course)
        .join(Course, Deadline.course_id == Course.id)
        .where(Deadline.user_id == user.id)
        .where(Course.status != "hidden")
        .where(or_(Deadline.due_at.is_(None), Deadline.due_at >= cutoff))
        .order_by(Deadline.due_at.asc().nullslast())
    )
    rows = (await db.execute(q)).all()

    now_ams = datetime.now(AMS)
    start_of_today = now_ams.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_today = start_of_today + timedelta(days=1)
    end_of_week = start_of_today + timedelta(days=7)
    end_of_two_weeks = start_of_today + timedelta(days=14)

    def _entry_from_course(c: Course) -> dict:
        return {
            "course": {
                "id": str(c.id),
                "canvas_course_id": c.canvas_course_id,
                "name": c.name,
                "code": c.code,
                "status": c.status,
            },
            "buckets": _empty_buckets(),
            "earliest_due": None,
            "pending_count": 0,
        }

    # Seed with all non-hidden courses so empty ones still appear.
    by_course: dict[str, dict] = {str(c.id): _entry_from_course(c) for c in all_courses}

    for deadline, course in rows:
        cid = str(course.id)
        if cid not in by_course:
            # Defensive: a deadline's course should already be seeded, but
            # handle late-arriving data cleanly.
            by_course[cid] = _entry_from_course(course)
        entry = by_course[cid]

        due_iso = _as_utc(deadline.due_at).isoformat() if deadline.due_at else None
        # Effective "submitted" combines the Canvas-reported state with the
        # user's manual override. Canvas sometimes lags on paper submissions
        # or in-class quizzes, so the override lets the student tick it off.
        effective_submitted = bool(deadline.submitted) or bool(deadline.manually_submitted)
        item = {
            "id": str(deadline.id),
            "title": deadline.title,
            "type": deadline.type,
            "due_at": due_iso,
            "url": deadline.url,
            "points_possible": deadline.points_possible,
            "submitted": effective_submitted,
            "manually_submitted": deadline.manually_submitted,
        }

        if deadline.due_at is None:
            bucket = "no_due_date"
        else:
            due_ams = _as_utc(deadline.due_at).astimezone(AMS)
            if due_ams < now_ams:
                bucket = "overdue"
            elif due_ams < end_of_today:
                bucket = "today"
            elif due_ams < end_of_week:
                bucket = "this_week"
            elif due_ams < end_of_two_weeks:
                bucket = "next_two_weeks"
            else:
                bucket = "later"

        entry["buckets"][bucket].append(item)

        # Sort-by-urgency: earliest non-submitted deadline drives course order.
        if not effective_submitted:
            entry["pending_count"] += 1
            if deadline.due_at is not None:
                due_utc = _as_utc(deadline.due_at)
                if entry["earliest_due"] is None or due_utc < entry["earliest_due"]:
                    entry["earliest_due"] = due_utc

    # Order: courses with earlier pending deadlines first; courses with no
    # pending deadlines fall to the bottom (alphabetical within that group).
    FAR_FUTURE = datetime.max.replace(tzinfo=timezone.utc)
    courses_sorted = sorted(
        by_course.values(),
        key=lambda e: (e["earliest_due"] or FAR_FUTURE, e["course"]["name"].lower()),
    )
    for entry in courses_sorted:
        entry.pop("earliest_due", None)

    return {
        "courses": courses_sorted,
        "last_synced_at": _as_utc(user.last_synced_at).isoformat() if user.last_synced_at else None,
        # True while a background sync is running for this user. The dashboard
        # polls while this is true so per-course commits show up live.
        "syncing": is_syncing(user.id),
    }


class DeadlineOverride(BaseModel):
    manually_submitted: bool


@router.patch("/deadlines/{deadline_id}")
async def set_deadline_submission(
    deadline_id: UUID,
    payload: DeadlineOverride,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    deadline = (
        await db.execute(
            select(Deadline).where(Deadline.id == deadline_id, Deadline.user_id == user.id)
        )
    ).scalar_one_or_none()
    if deadline is None:
        raise HTTPException(status_code=404, detail="deadline not found")
    deadline.manually_submitted = payload.manually_submitted
    await db.commit()
    return {
        "id": str(deadline.id),
        "submitted": bool(deadline.submitted) or deadline.manually_submitted,
        "manually_submitted": deadline.manually_submitted,
    }
