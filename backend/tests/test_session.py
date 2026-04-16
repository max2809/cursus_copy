import pytest
from datetime import datetime, timezone, timedelta
from sqlalchemy import select
from studybuddy.auth.session import create_session, get_user_from_cookie
from studybuddy.db.models import User, Session as SessionModel


@pytest.mark.asyncio
async def test_create_session_returns_token_and_stores_hash(db):
    user = User(email="a@eur.nl")
    db.add(user); await db.flush()

    token = await create_session(db, user)
    assert isinstance(token, str) and len(token) == 43

    rows = (await db.execute(select(SessionModel).where(SessionModel.user_id == user.id))).scalars().all()
    assert len(rows) == 1
    stored_expiry = rows[0].expires_at
    if stored_expiry.tzinfo is None:
        stored_expiry = stored_expiry.replace(tzinfo=timezone.utc)
    assert stored_expiry > datetime.now(timezone.utc) + timedelta(days=29)


@pytest.mark.asyncio
async def test_get_user_from_cookie_valid(db):
    user = User(email="a@eur.nl")
    db.add(user); await db.flush()
    token = await create_session(db, user)

    result = await get_user_from_cookie(db, token)
    assert result is not None
    assert result.id == user.id


@pytest.mark.asyncio
async def test_get_user_from_cookie_bad_token(db):
    assert await get_user_from_cookie(db, "bogus") is None


@pytest.mark.asyncio
async def test_get_user_from_cookie_expired(db):
    user = User(email="a@eur.nl")
    db.add(user); await db.flush()
    token = await create_session(db, user, ttl_days=-1)

    assert await get_user_from_cookie(db, token) is None
