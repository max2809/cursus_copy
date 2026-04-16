import pytest
from sqlalchemy import select
from studybuddy.db.models import User
from studybuddy.cli.commands import invite_email


@pytest.mark.asyncio
async def test_invite_creates_user(db):
    await invite_email(db, "new@eur.nl")
    rows = (await db.execute(select(User).where(User.email == "new@eur.nl"))).scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_invite_is_idempotent(db):
    await invite_email(db, "new@eur.nl")
    await invite_email(db, "new@eur.nl")
    rows = (await db.execute(select(User).where(User.email == "new@eur.nl"))).scalars().all()
    assert len(rows) == 1
