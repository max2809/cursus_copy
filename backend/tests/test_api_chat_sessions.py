import pytest
from sqlalchemy import select
from studybuddy.db.models import (
    ChatMessage, ChatSession, Course, User,
)


async def _course(db, user, canvas_course_id=10):
    c = Course(user_id=user.id, canvas_course_id=canvas_course_id, name="CS")
    db.add(c); await db.commit()
    return c


@pytest.mark.asyncio
async def test_create_session_defaults_title(authed_client, db):
    u = (await db.execute(select(User))).scalar_one()
    await _course(db, u)
    resp = await authed_client.post("/api/courses/10/chat/sessions", json={})
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"].startswith("New chat") or body["title"] == "Untitled"
    assert body["id"]


@pytest.mark.asyncio
async def test_create_session_with_title(authed_client, db):
    u = (await db.execute(select(User))).scalar_one()
    await _course(db, u)
    resp = await authed_client.post(
        "/api/courses/10/chat/sessions", json={"title": "Midterm prep"},
    )
    assert resp.status_code == 200
    assert resp.json()["title"] == "Midterm prep"


@pytest.mark.asyncio
async def test_list_sessions_most_recent_first(authed_client, db):
    import datetime as dt
    u = (await db.execute(select(User))).scalar_one()
    c = await _course(db, u)
    older = ChatSession(user_id=u.id, course_id=c.id, title="older",
                        updated_at=dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc))
    newer = ChatSession(user_id=u.id, course_id=c.id, title="newer",
                        updated_at=dt.datetime(2026, 4, 1, tzinfo=dt.timezone.utc))
    db.add_all([older, newer]); await db.commit()
    resp = await authed_client.get("/api/courses/10/chat/sessions")
    assert resp.status_code == 200
    body = resp.json()
    titles = [s["title"] for s in body["sessions"]]
    assert titles == ["newer", "older"]


@pytest.mark.asyncio
async def test_get_session_includes_messages(authed_client, db):
    u = (await db.execute(select(User))).scalar_one()
    c = await _course(db, u)
    s = ChatSession(user_id=u.id, course_id=c.id, title="x"); db.add(s); await db.flush()
    db.add(ChatMessage(session_id=s.id, role="user", content="hi"))
    db.add(ChatMessage(session_id=s.id, role="assistant", content="hey [1]",
                       citations_json=[{"marker": 1, "snippet": "y"}]))
    await db.commit()
    resp = await authed_client.get(f"/api/courses/10/chat/sessions/{s.id}")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["messages"]) == 2
    assert body["messages"][1]["citations_json"][0]["marker"] == 1


@pytest.mark.asyncio
async def test_delete_session_cascades(authed_client, db):
    u = (await db.execute(select(User))).scalar_one()
    c = await _course(db, u)
    s = ChatSession(user_id=u.id, course_id=c.id, title="x"); db.add(s); await db.flush()
    db.add(ChatMessage(session_id=s.id, role="user", content="hi"))
    await db.commit()
    resp = await authed_client.delete(f"/api/courses/10/chat/sessions/{s.id}")
    assert resp.status_code == 204
    assert (await db.execute(select(ChatSession))).scalars().all() == []
    assert (await db.execute(select(ChatMessage))).scalars().all() == []


@pytest.mark.asyncio
async def test_cannot_access_other_users_session(authed_client, db):
    u = (await db.execute(select(User))).scalar_one()
    await _course(db, u)
    other = User(email="other@eur.nl"); db.add(other); await db.flush()
    oc = Course(user_id=other.id, canvas_course_id=10, name="CS"); db.add(oc); await db.flush()
    s = ChatSession(user_id=other.id, course_id=oc.id, title="secret")
    db.add(s); await db.commit()
    resp = await authed_client.get(f"/api/courses/10/chat/sessions/{s.id}")
    assert resp.status_code == 404
