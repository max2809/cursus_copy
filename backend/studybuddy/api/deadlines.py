from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import APIRouter, BackgroundTasks, Depends
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
# Hide courses whose term ended more than this many days ago. A small grace
# window lets resits / late-graded items still surface.
COURSE_END_GRACE_DAYS = 14
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
    course_end_cutoff = date.today() - timedelta(days=COURSE_END_GRACE_DAYS)

    # A course is "active" only if it has at least one dated deadline within
    # the last 30 days or in the future. Courses whose only remaining items
    # are null-due-at admin/resource rows get hidden, even if Canvas still
    # reports them as active.
    active_course_ids = (
        select(Deadline.course_id)
        .where(
            Deadline.user_id == user.id,
            Deadline.due_at.is_not(None),
            Deadline.due_at >= cutoff,
        )
    )

    q = (
        select(Deadline, Course)
        .join(Course, Deadline.course_id == Course.id)
        .where(Deadline.user_id == user.id)
        .where(Course.id.in_(active_course_ids))
        # Within an active course, include recent dated items AND null-due items
        # (so the "No due date" bucket still works for live courses).
        .where(or_(Deadline.due_at.is_(None), Deadline.due_at >= cutoff))
        # Conservative belt-and-suspenders: if Canvas does set a clearly-past
        # end_date, hide the course. EUR sets this to the whole year so it's
        # usually a no-op here, but it catches odd cases.
        .where(or_(Course.end_date.is_(None), Course.end_date >= course_end_cutoff))
        .order_by(Deadline.due_at.asc().nullslast())
    )
    rows = (await db.execute(q)).all()

    now_ams = datetime.now(AMS)
    start_of_today = now_ams.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_today = start_of_today + timedelta(days=1)
    end_of_week = start_of_today + timedelta(days=7)
    end_of_two_weeks = start_of_today + timedelta(days=14)

    by_course: dict[str, dict] = {}
    for deadline, course in rows:
        cid = str(course.id)
        if cid not in by_course:
            by_course[cid] = {
                "course": {
                    "id": cid,
                    "canvas_course_id": course.canvas_course_id,
                    "name": course.name,
                    "code": course.code,
                },
                "buckets": _empty_buckets(),
                "earliest_due": None,  # for sorting; stripped before responding
                "pending_count": 0,
            }
        entry = by_course[cid]

        due_iso = _as_utc(deadline.due_at).isoformat() if deadline.due_at else None
        item = {
            "id": str(deadline.id),
            "title": deadline.title,
            "type": deadline.type,
            "due_at": due_iso,
            "url": deadline.url,
            "points_possible": deadline.points_possible,
            "submitted": deadline.submitted,
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
        if not deadline.submitted:
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
