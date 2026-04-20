from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from studybuddy.db.models import User


async def invite_email(db: AsyncSession, email: str) -> User:
    email = email.lower()
    existing = (
        await db.execute(select(User).where(func.lower(User.email) == email))
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    user = User(email=email)
    db.add(user)
    await db.flush()
    return user
