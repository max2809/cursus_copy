import pytest
import sys
from datetime import datetime, timezone, timedelta
from sqlalchemy import select
from studybuddy.db.models import User, Course, Deadline
from studybuddy.api import deadlines as deadlines_mod


def _now_utc():
    return datetime.now(timezone.utc)


async def _seed(db, user_id):
    c = Course(user_id=user_id, canvas_course_id=10, name="Algorithms")
    db.add(c); await db.flush()
    base = [
        ("overdue_d",  _now_utc() - timedelta(days=2)),
        ("today_d",    _now_utc() + timedelta(hours=3)),
        ("week_d",     _now_utc() + timedelta(days=3)),
        ("twoweek_d",  _now_utc() + timedelta(days=10)),
        ("later_d",    _now_utc() + timedelta(days=40)),
        ("nodue_d",    None),
    ]
    for i, (title, due) in enumerate(base):
        db.add(Deadline(
            user_id=user_id, course_id=c.id, canvas_source_type="assignment",
            canvas_source_id=f"a{i}", title=title, url="https://x", type="assignment", due_at=due,
        ))
    await db.flush()


@pytest.mark.asyncio
async def test_deadlines_returns_buckets(authed_client, db, monkeypatch):
    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            fixed = datetime(2026, 5, 3, 10, 0, tzinfo=timezone.utc)
            return fixed.astimezone(tz) if tz else fixed.replace(tzinfo=None)

    monkeypatch.setattr(deadlines_mod, "datetime", FixedDateTime)
    monkeypatch.setattr(sys.modules[__name__], "datetime", FixedDateTime)
    user = (await db.execute(select(User))).scalar_one()
    await _seed(db, user.id)
    user.last_synced_at = _now_utc()
    await db.commit()

    resp = await authed_client.get("/api/deadlines")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["courses"]) == 1
    buckets = body["courses"][0]["buckets"]
    titles = lambda b: [d["title"] for d in buckets[b]]
    assert "overdue_d" in titles("overdue")
    assert "today_d" in titles("today")
    assert "week_d" in titles("this_week")
    assert "twoweek_d" in titles("next_two_weeks")
    assert "later_d" in titles("later")
    assert "nodue_d" in titles("no_due_date")
