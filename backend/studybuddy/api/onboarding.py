import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from studybuddy.auth.deps import current_user
from studybuddy.config import get_settings
from studybuddy.db.base import get_db
from studybuddy.db.models import User
from studybuddy.security.crypto import encrypt_pat
from studybuddy.sync.background import sync_and_index_background


router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])


class PATPayload(BaseModel):
    pat: str


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

    async with httpx.AsyncClient(timeout=10.0) as c:
        resp = await c.get(
            f"https://{settings.canvas_base_url}/api/v1/users/self",
            headers={"Authorization": f"Bearer {pat}"},
        )
    if resp.status_code == 401:
        raise HTTPException(status_code=400, detail="Canvas rejected that token")
    resp.raise_for_status()

    ct, nonce = encrypt_pat(pat, settings.master_key_bytes())
    user.pat_encrypted = ct
    user.pat_nonce = nonce
    await db.commit()

    background.add_task(sync_and_index_background, user.id, settings.master_key_bytes())
    return {"ok": True}
