import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from studybuddy.auth.deps import current_user
from studybuddy.canvas.domains import (
    CanvasHostUnreachable,
    InvalidCanvasHost,
    validate_canvas_host,
)
from studybuddy.config import get_settings
from studybuddy.db.base import get_db
from studybuddy.db.models import User
from studybuddy.security.crypto import encrypt_pat
from studybuddy.sync.background import sync_and_index_background


router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])


class PATPayload(BaseModel):
    pat: str
    canvas_base_url: str | None = None


@router.post("/pat")
async def submit_pat(
    payload: PATPayload,
    background: BackgroundTasks,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """Validate the PAT against Canvas, store it encrypted, and fire a background
    sync + indexing pass. Returns immediately so the frontend can move on to the
    dashboard — polling /api/deadlines shows courses filling in live.
    """
    settings = get_settings()
    pat = payload.pat.strip()
    requested_host = payload.canvas_base_url or user.canvas_base_url or settings.canvas_base_url
    try:
        canvas_host = await validate_canvas_host(requested_host)
    except InvalidCanvasHost as exc:
        raise HTTPException(status_code=400, detail="Invalid Canvas domain") from exc
    except CanvasHostUnreachable as exc:
        raise HTTPException(status_code=400, detail="Could not reach that Canvas domain") from exc

    try:
        async with httpx.AsyncClient(timeout=10.0) as c:
            resp = await c.get(
                f"https://{canvas_host}/api/v1/users/self",
                headers={"Authorization": f"Bearer {pat}"},
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=400, detail="Could not reach that Canvas domain") from exc
    if resp.status_code == 401:
        raise HTTPException(status_code=400, detail="Canvas rejected that token")
    try:
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=400, detail="Could not reach that Canvas domain") from exc

    ct, nonce = encrypt_pat(pat, settings.master_key_bytes())
    user.pat_encrypted = ct
    user.pat_nonce = nonce
    user.canvas_base_url = canvas_host
    await db.commit()

    background.add_task(sync_and_index_background, user.id, settings.master_key_bytes())
    return {"ok": True}
