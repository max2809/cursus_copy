from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from studybuddy.auth.session import get_user_from_cookie
from studybuddy.db.base import get_db
from studybuddy.db.models import User


SESSION_COOKIE_NAME = "sb_session"


async def current_user(
    sb_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    db: AsyncSession = Depends(get_db),
) -> User:
    if sb_session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="not authenticated")
    user = await get_user_from_cookie(db, sb_session)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid or expired session")
    return user
