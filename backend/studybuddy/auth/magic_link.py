from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from studybuddy.db.models import MagicLinkToken, User
from studybuddy.security.tokens import new_token, hash_token


MAGIC_LINK_TTL_MINUTES = 15


def _as_utc(dt: datetime) -> datetime:
    """SQLite stores tz-naive datetimes; treat them as UTC for comparison."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


async def create_magic_link(db: AsyncSession, user: User, ttl_minutes: int = MAGIC_LINK_TTL_MINUTES) -> str:
    token = new_token()
    row = MagicLinkToken(
        user_id=user.id,
        token_hash=hash_token(token),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes),
    )
    db.add(row)
    await db.flush()
    return token


async def verify_magic_link(db: AsyncSession, token: str) -> User | None:
    stmt = select(MagicLinkToken).where(MagicLinkToken.token_hash == hash_token(token))
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        return None
    if row.used_at is not None:
        return None
    if _as_utc(row.expires_at) < datetime.now(timezone.utc):
        return None

    row.used_at = datetime.now(timezone.utc)
    user = (await db.execute(select(User).where(User.id == row.user_id))).scalar_one()
    await db.flush()
    return user
