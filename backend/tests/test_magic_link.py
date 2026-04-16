import pytest
from datetime import datetime, timezone, timedelta
from sqlalchemy import select
from studybuddy.auth.magic_link import create_magic_link, verify_magic_link
from studybuddy.db.models import User, MagicLinkToken


@pytest.mark.asyncio
async def test_create_returns_token_and_stores_hash(db):
    user = User(email="a@eur.nl")
    db.add(user)
    await db.flush()

    token = await create_magic_link(db, user)
    assert isinstance(token, str) and len(token) == 43

    rows = (await db.execute(select(MagicLinkToken).where(MagicLinkToken.user_id == user.id))).scalars().all()
    assert len(rows) == 1
    assert rows[0].token_hash != token.encode()  # stored as hash, not raw


@pytest.mark.asyncio
async def test_verify_returns_user_and_marks_used(db):
    user = User(email="a@eur.nl")
    db.add(user)
    await db.flush()
    token = await create_magic_link(db, user)

    verified = await verify_magic_link(db, token)
    assert verified is not None
    assert verified.id == user.id

    row = (await db.execute(select(MagicLinkToken).where(MagicLinkToken.user_id == user.id))).scalar_one()
    assert row.used_at is not None


@pytest.mark.asyncio
async def test_verify_expired_returns_none(db):
    user = User(email="a@eur.nl")
    db.add(user)
    await db.flush()
    token = await create_magic_link(db, user, ttl_minutes=-1)  # already expired

    assert await verify_magic_link(db, token) is None


@pytest.mark.asyncio
async def test_verify_used_token_returns_none(db):
    user = User(email="a@eur.nl")
    db.add(user)
    await db.flush()
    token = await create_magic_link(db, user)

    assert await verify_magic_link(db, token) is not None  # first verify: OK
    assert await verify_magic_link(db, token) is None      # second verify: rejected


@pytest.mark.asyncio
async def test_verify_unknown_token_returns_none(db):
    assert await verify_magic_link(db, "definitely_not_a_real_token") is None
