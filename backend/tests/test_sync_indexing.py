import os
import pytest
from hashlib import sha256
from sqlalchemy import select
from studybuddy.sync.orchestrator import sync_user
from studybuddy.db.models import User, Course, File as FileModel, Deadline
from studybuddy.security.crypto import encrypt_pat
from studybuddy.rag import INDEX_VERSION


MASTER_KEY = os.urandom(32)


async def _user(db, email="a@eur.nl", pat="p"):
    ct, nonce = encrypt_pat(pat, MASTER_KEY)
    u = User(email=email, pat_encrypted=ct, pat_nonce=nonce)
    db.add(u); await db.flush()
    return u


@pytest.mark.asyncio
async def test_sync_returns_pending_indexing_for_new_files(db, httpx_mock):
    user = await _user(db)
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses?enrollment_state=active&include%5B%5D=term",
        json=[{"id": 10, "name": "CS", "course_code": "CS101"}],
    )
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses/10/assignments?include%5B%5D=submission",
        json=[{"id": "a1", "name": "PS1", "description": "<p>Old</p>",
               "due_at": None, "html_url": "https://x"}],
    )
    httpx_mock.add_response(method="GET", url="https://canvas.eur.nl/api/v1/courses/10/quizzes", json=[])
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/calendar_events?context_codes%5B%5D=course_10&type=event",
        json=[],
    )
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses/10/files",
        json=[{"id": 500, "display_name": "lec3.pdf",
               "url": "https://x", "content-type": "application/pdf",
               "size": 1024, "updated_at": "2026-04-16T12:00:00Z"}],
    )
    result = await sync_user(db, user, master_key=MASTER_KEY)
    # Every file fresh from Canvas is "pending".
    file_ids = [f.id for f in (await db.execute(select(FileModel))).scalars().all()]
    deadline_ids = [d.id for d in (await db.execute(select(Deadline))).scalars().all()]
    assert set(result.pending_file_ids) == set(file_ids)
    assert set(result.pending_deadline_ids) == set(deadline_ids)


@pytest.mark.asyncio
async def test_sync_skips_already_indexed_files(db, httpx_mock):
    user = await _user(db)
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses?enrollment_state=active&include%5B%5D=term",
        json=[{"id": 10, "name": "CS"}],
    )
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses/10/assignments?include%5B%5D=submission", json=[],
    )
    httpx_mock.add_response(method="GET", url="https://canvas.eur.nl/api/v1/courses/10/quizzes", json=[])
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/calendar_events?context_codes%5B%5D=course_10&type=event",
        json=[],
    )
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses/10/files",
        json=[{"id": 500, "display_name": "lec3.pdf", "url": "https://x",
               "content-type": "application/pdf", "size": 1024,
               "updated_at": "2026-04-16T12:00:00Z"}],
    )
    # First sync inserts the file.
    await sync_user(db, user, master_key=MASTER_KEY)
    # Mark it fully indexed.
    f = (await db.execute(select(FileModel))).scalar_one()
    from datetime import datetime, timezone
    f.indexed_at = datetime.now(timezone.utc)
    f.index_version = INDEX_VERSION
    await db.commit()

    # Second sync: mock everything again (pytest-httpx consumes responses).
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses?enrollment_state=active&include%5B%5D=term",
        json=[{"id": 10, "name": "CS"}],
    )
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses/10/assignments?include%5B%5D=submission", json=[],
    )
    httpx_mock.add_response(method="GET", url="https://canvas.eur.nl/api/v1/courses/10/quizzes", json=[])
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/calendar_events?context_codes%5B%5D=course_10&type=event",
        json=[],
    )
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses/10/files",
        json=[{"id": 500, "display_name": "lec3.pdf", "url": "https://x",
               "content-type": "application/pdf", "size": 1024,
               "updated_at": "2026-04-16T12:00:00Z"}],
    )
    result2 = await sync_user(db, user, master_key=MASTER_KEY)
    assert result2.pending_file_ids == []


@pytest.mark.asyncio
async def test_sync_reindexes_on_description_hash_drift(db, httpx_mock):
    user = await _user(db)
    for body in ("orig", "updated"):
        httpx_mock.add_response(
            method="GET",
            url="https://canvas.eur.nl/api/v1/courses?enrollment_state=active&include%5B%5D=term",
            json=[{"id": 10, "name": "CS"}],
        )
        httpx_mock.add_response(
            method="GET",
            url="https://canvas.eur.nl/api/v1/courses/10/assignments?include%5B%5D=submission",
            json=[{"id": "a1", "name": "PS1", "description": f"<p>{body}</p>",
                   "due_at": None, "html_url": "https://x"}],
        )
        httpx_mock.add_response(method="GET", url="https://canvas.eur.nl/api/v1/courses/10/quizzes", json=[])
        httpx_mock.add_response(
            method="GET",
            url="https://canvas.eur.nl/api/v1/calendar_events?context_codes%5B%5D=course_10&type=event",
            json=[],
        )
        httpx_mock.add_response(
            method="GET",
            url="https://canvas.eur.nl/api/v1/courses/10/files",
            json=[],
        )
    r1 = await sync_user(db, user, master_key=MASTER_KEY)
    d = (await db.execute(select(Deadline))).scalar_one()
    d.description_hash = sha256("<p>orig</p>".encode()).hexdigest()  # pretend indexed
    await db.commit()
    r2 = await sync_user(db, user, master_key=MASTER_KEY)
    assert d.id in r2.pending_deadline_ids
