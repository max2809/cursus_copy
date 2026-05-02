import logging

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from studybuddy.auth.magic_link import create_magic_link, verify_magic_link
from studybuddy.auth.session import create_session, delete_session
from studybuddy.auth.deps import SESSION_COOKIE_NAME, current_user
from studybuddy.config import get_settings
from studybuddy.db.base import get_db
from studybuddy.db.models import User
from studybuddy.email.resend_client import ResendClient


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class MagicLinkRequest(BaseModel):
    email: EmailStr


class VerifyRequest(BaseModel):
    token: str


class MeResponse(BaseModel):
    email: EmailStr
    canvas_base_url: str
    has_pat: bool


@router.post("/magic-link")
async def request_magic_link(payload: MagicLinkRequest, db: AsyncSession = Depends(get_db)):
    settings = get_settings()
    # Email lookup is case-insensitive: Pydantic's EmailStr preserves local-part case,
    # so "Alice@example.com" and "alice@example.com" would otherwise miss each other.
    email = payload.email.lower()
    user = (
        await db.execute(select(User).where(func.lower(User.email) == email))
    ).scalar_one_or_none()
    if user is None:
        return {"ok": True}  # don't leak allowlist

    token = await create_magic_link(db, user)
    link = f"{settings.magic_link_base_url}/auth/verify?token={token}"
    resend = ResendClient(api_key=settings.resend_api_key, default_from=settings.resend_from)
    # Never let a Resend failure change the response: a 200 for unknown emails
    # and a 500 for known emails would leak the allowlist. Log and swallow.
    try:
        await resend.send_magic_link(to=email, link=link)
    except Exception:
        logger.exception("resend send_magic_link failed for an allowlisted user")
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


@router.get("/me", response_model=MeResponse)
async def me(user: User = Depends(current_user)):
    return MeResponse(
        email=user.email,
        canvas_base_url=user.canvas_base_url,
        has_pat=user.pat_encrypted is not None and user.pat_nonce is not None,
    )


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
