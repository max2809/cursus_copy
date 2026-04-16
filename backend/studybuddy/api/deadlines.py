from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from studybuddy.auth.deps import current_user
from studybuddy.canvas.client import CanvasUnauthorized
from studybuddy.config import get_settings
from studybuddy.db.base import get_db
from studybuddy.db.models import Course, Deadline, User
from studybuddy.sync.orchestrator import sync_user


router = APIRouter(prefix="/api", tags=["deadlines"])

STALE_MINUTES = 30
AMS = ZoneInfo("Europe/Amsterdam")


def _as_utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


@router.get("/deadlines")
async def get_deadlines(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    settings = get_settings()
    stale = (
        user.last_synced_at is None
        or _as_utc(user.last_synced_at) < datetime.now(timezone.utc) - timedelta(minutes=STALE_MINUTES)
    )
    if stale and user.pat_encrypted is not None:
        try:
            await sync_user(db, user, master_key=settings.master_key_bytes())
            await db.commit()
        except CanvasUnauthorized:
            await db.commit()  # persist PAT clear
        except Exception:
            await db.rollback()

    q = (
        select(Deadline, Course)
        .join(Course, Deadline.course_id == Course.id, isouter=True)
        .where(Deadline.user_id == user.id)
        .order_by(Deadline.due_at.asc().nullslast())
    )
    rows = (await db.execute(q)).all()

    now_ams = datetime.now(AMS)
    start_of_today = now_ams.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_today = start_of_today + timedelta(days=1)
    end_of_week = start_of_today + timedelta(days=7)
    end_of_two_weeks = start_of_today + timedelta(days=14)

    buckets: dict[str, list] = {
        "overdue": [], "today": [], "this_week": [],
        "next_two_weeks": [], "later": [], "no_due_date": [],
    }

    for deadline, course in rows:
        due_iso = _as_utc(deadline.due_at).isoformat() if deadline.due_at else None
        item = {
            "id": str(deadline.id),
            "title": deadline.title,
            "type": deadline.type,
            "due_at": due_iso,
            "url": deadline.url,
            "points_possible": deadline.points_possible,
            "submitted": deadline.submitted,
            "course": {"id": str(course.id), "name": course.name, "code": course.code} if course else None,
        }
        if deadline.due_at is None:
            buckets["no_due_date"].append(item); continue
        due_ams = _as_utc(deadline.due_at).astimezone(AMS)
        if due_ams < now_ams:
            buckets["overdue"].append(item)
        elif due_ams < end_of_today:
            buckets["today"].append(item)
        elif due_ams < end_of_week:
            buckets["this_week"].append(item)
        elif due_ams < end_of_two_weeks:
            buckets["next_two_weeks"].append(item)
        else:
            buckets["later"].append(item)

    return {
        "buckets": buckets,
        "last_synced_at": _as_utc(user.last_synced_at).isoformat() if user.last_synced_at else None,
    }
