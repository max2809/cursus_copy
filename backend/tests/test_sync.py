import os
from datetime import timezone
import pytest
from sqlalchemy import select
from studybuddy.sync.orchestrator import sync_user
from studybuddy.db.models import User, Course, Deadline, File as FileModel
from studybuddy.security.crypto import encrypt_pat


MASTER_KEY = os.urandom(32)


async def _user_with_pat(db, email="a@eur.nl", pat="pat_value"):
    ct, nonce = encrypt_pat(pat, MASTER_KEY)
    u = User(email=email, pat_encrypted=ct, pat_nonce=nonce)
    db.add(u); await db.flush()
    return u


@pytest.mark.asyncio
async def test_sync_inserts_courses_deadlines_files(db, httpx_mock):
    user = await _user_with_pat(db)

    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses?enrollment_state%5B%5D=active&enrollment_state%5B%5D=completed&enrollment_state%5B%5D=invited_or_pending&include%5B%5D=term&include%5B%5D=syllabus_body",
        json=[{"id": 10, "name": "Algorithms", "course_code": "CS101", "enrollments": [{"enrollment_state": "active"}]}],
    )
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses/10/front_page",
        status_code=404,
    )
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses/10/assignments?include%5B%5D=submission&include%5B%5D=all_dates",
        json=[{"id": "a1", "name": "PS1", "due_at": "2026-05-01T12:00:00Z",
               "html_url": "https://canvas.eur.nl/c/10/a/1", "points_possible": 10.0}],
    )
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses/10/quizzes",
        json=[],
    )
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/calendar_events?context_codes%5B%5D=course_10&type=event",
        json=[{"id": "e1", "title": "Final exam", "end_at": "2026-06-01T12:00:00Z",
               "html_url": "https://canvas.eur.nl/cal/e1"}],
    )
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses/10/files",
        json=[{"id": 500, "display_name": "slides.pdf", "url": "https://canvas.eur.nl/files/500",
               "size": 10240, "content-type": "application/pdf"}],
    )
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses/10/modules?include%5B%5D=items",
        json=[],
    )

    await sync_user(db, user, master_key=MASTER_KEY)

    courses = (await db.execute(select(Course))).scalars().all()
    deadlines = (await db.execute(select(Deadline))).scalars().all()
    files = (await db.execute(select(FileModel))).scalars().all()
    assert len(courses) == 1 and courses[0].canvas_course_id == 10
    assert len(deadlines) == 2
    types = sorted(d.type for d in deadlines)
    assert types == ["assignment", "exam"]
    assert len(files) == 1 and files[0].filename == "slides.pdf"
    assert user.last_synced_at is not None


@pytest.mark.asyncio
async def test_sync_uses_assignment_all_dates_when_due_at_is_null(db, httpx_mock):
    user = await _user_with_pat(db)

    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses?enrollment_state%5B%5D=active&enrollment_state%5B%5D=completed&enrollment_state%5B%5D=invited_or_pending&include%5B%5D=term&include%5B%5D=syllabus_body",
        json=[{"id": 10, "name": "Economics of Conflict", "course_code": "ECB307", "enrollments": [{"enrollment_state": "active"}]}],
    )
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses/10/front_page",
        status_code=404,
    )
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses/10/assignments?include%5B%5D=submission&include%5B%5D=all_dates",
        json=[{
            "id": "248651",
            "name": "Assignment",
            "due_at": None,
            "all_dates": [{"title": "EUC-ECB307", "due_at": "2026-05-17T21:59:00Z"}],
            "html_url": "https://canvas.eur.nl/courses/52441/assignments/248651",
            "points_possible": 100,
        }],
    )
    httpx_mock.add_response(method="GET", url="https://canvas.eur.nl/api/v1/courses/10/quizzes", json=[])
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/calendar_events?context_codes%5B%5D=course_10&type=event",
        json=[],
    )
    httpx_mock.add_response(method="GET", url="https://canvas.eur.nl/api/v1/courses/10/files", json=[])
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses/10/modules?include%5B%5D=items",
        json=[],
    )

    await sync_user(db, user, master_key=MASTER_KEY)

    deadline = (await db.execute(select(Deadline))).scalar_one()
    assert deadline.title == "Assignment"
    assert deadline.due_at is not None
    assert deadline.due_at.replace(tzinfo=timezone.utc).isoformat() == "2026-05-17T21:59:00+00:00"


@pytest.mark.asyncio
async def test_sync_is_idempotent(db, httpx_mock):
    user = await _user_with_pat(db)

    for _ in range(2):
        httpx_mock.add_response(
            method="GET",
            url="https://canvas.eur.nl/api/v1/courses?enrollment_state%5B%5D=active&enrollment_state%5B%5D=completed&enrollment_state%5B%5D=invited_or_pending&include%5B%5D=term&include%5B%5D=syllabus_body",
            json=[{"id": 10, "name": "Algorithms", "enrollments": [{"enrollment_state": "active"}]}],
        )
        httpx_mock.add_response(
            method="GET",
            url="https://canvas.eur.nl/api/v1/courses/10/front_page",
            status_code=404,
        )
        httpx_mock.add_response(
            method="GET",
            url="https://canvas.eur.nl/api/v1/courses/10/assignments?include%5B%5D=submission&include%5B%5D=all_dates",
            json=[{"id": "a1", "name": "PS1", "due_at": "2026-05-01T12:00:00Z",
                   "html_url": "https://canvas.eur.nl/c/10/a/1"}],
        )
        httpx_mock.add_response(method="GET", url="https://canvas.eur.nl/api/v1/courses/10/quizzes", json=[])
        httpx_mock.add_response(
            method="GET",
            url="https://canvas.eur.nl/api/v1/calendar_events?context_codes%5B%5D=course_10&type=event",
            json=[],
        )
        httpx_mock.add_response(method="GET", url="https://canvas.eur.nl/api/v1/courses/10/files", json=[])
        httpx_mock.add_response(
            method="GET",
            url="https://canvas.eur.nl/api/v1/courses/10/modules?include%5B%5D=items",
            json=[],
        )

    await sync_user(db, user, master_key=MASTER_KEY)
    await sync_user(db, user, master_key=MASTER_KEY)

    deadlines = (await db.execute(select(Deadline))).scalars().all()
    assert len(deadlines) == 1


@pytest.mark.asyncio
async def test_sync_401_clears_pat(db, httpx_mock):
    user = await _user_with_pat(db)
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses?enrollment_state%5B%5D=active&enrollment_state%5B%5D=completed&enrollment_state%5B%5D=invited_or_pending&include%5B%5D=term&include%5B%5D=syllabus_body",
        status_code=401,
    )
    with pytest.raises(Exception):
        await sync_user(db, user, master_key=MASTER_KEY)
    # sync_user flushes the cleared PAT in the same session before raising.
    # The test shares that session, so in-memory state reflects the clear.
    assert user.pat_encrypted is None
    assert user.pat_nonce is None
