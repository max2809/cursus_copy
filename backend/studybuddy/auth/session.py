from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from studybuddy.db.models import Session as SessionModel, User
from studybuddy.security.tokens import new_token, hash_token


SESSION_TTL_DAYS = 30


def _as_utc(dt: datetime) -> datetime:
    """SQLite stores tz-naive datetimes; treat them as UTC for comparison."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


async def create_session(db: AsyncSession, user: User, ttl_days: int = SESSION_TTL_DAYS) -> str:
    token = new_token()
    row = SessionModel(
        user_id=user.id,
        token_hash=hash_token(token),
        expires_at=datetime.now(timezone.utc) + timedelta(days=ttl_days),
    )
    db.add(row)
    user.last_login_at = datetime.now(timezone.utc)
    await db.flush()
    return token


async def get_user_from_cookie(db: AsyncSession, token: str) -> User | None:
    stmt = select(SessionModel).where(SessionModel.token_hash == hash_token(token))
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        return None
    if _as_utc(row.expires_at) < datetime.now(timezone.utc):
        return None
    row.expires_at = datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)
    user = (await db.execute(select(User).where(User.id == row.user_id))).scalar_one()
    await db.flush()
    return user


async def delete_session(db: AsyncSession, token: str) -> None:
    stmt = select(SessionModel).where(SessionModel.token_hash == hash_token(token))
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        await db.flush()
