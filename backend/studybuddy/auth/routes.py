from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from studybuddy.auth.magic_link import create_magic_link, verify_magic_link
from studybuddy.auth.session import create_session, delete_session
from studybuddy.auth.deps import SESSION_COOKIE_NAME
from studybuddy.config import get_settings
from studybuddy.db.base import get_db
from studybuddy.db.models import User
from studybuddy.email.resend_client import ResendClient


router = APIRouter(prefix="/api/auth", tags=["auth"])


class MagicLinkRequest(BaseModel):
    email: EmailStr


class VerifyRequest(BaseModel):
    token: str


@router.post("/magic-link")
async def request_magic_link(payload: MagicLinkRequest, db: AsyncSession = Depends(get_db)):
    settings = get_settings()
    user = (await db.execute(select(User).where(User.email == payload.email))).scalar_one_or_none()
    if user is None:
        return {"ok": True}  # don't leak allowlist

    token = await create_magic_link(db, user)
    link = f"{settings.magic_link_base_url}/auth/verify?token={token}"
    resend = ResendClient(api_key=settings.resend_api_key, default_from=settings.resend_from)
    await resend.send_magic_link(to=payload.email, link=link)
    await db.commit()
    return {"ok": True}


@router.post("/verify")
async def verify(payload: VerifyRequest, response: Response, db: AsyncSession = Depends(get_db)):
    user = await verify_magic_link(db, payload.token)
    if user is None:
        raise HTTPException(status_code=400, detail="invalid or expired token")
    session_token = await create_session(db, user)
    await db.commit()

    settings = get_settings()
    next_path = "/onboarding" if user.pat_encrypted is None else "/"
    # samesite=none required for cross-site POSTs (Vercel frontend -> Railway backend).
    # samesite=none requires secure=true; fall back to lax for local dev (http).
    samesite = "none" if settings.cookie_secure else "lax"
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=samesite,
        max_age=60 * 60 * 24 * 30,
    )
    return {"next": next_path}


@router.delete("/session", status_code=204)
async def logout(
    response: Response,
    sb_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    db: AsyncSession = Depends(get_db),
):
    if sb_session is not None:
        await delete_session(db, sb_session)
        await db.commit()
    response.delete_cookie(SESSION_COOKIE_NAME)
    return None
