import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from studybuddy.auth.deps import current_user
from studybuddy.config import get_settings
from studybuddy.db.base import get_db
from studybuddy.db.models import User
from studybuddy.security.crypto import encrypt_pat
from studybuddy.sync.orchestrator import sync_user


router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])


class PATPayload(BaseModel):
    pat: str


@router.post("/pat")
async def submit_pat(
    payload: PATPayload,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    settings = get_settings()
    pat = payload.pat.strip()
    print(
        f"[onboarding] base_url={settings.canvas_base_url!r} "
        f"pat_len={len(pat)} pat_has_tilde={'~' in pat}",
        flush=True,
    )

    async with httpx.AsyncClient(timeout=10.0) as c:
        resp = await c.get(
            f"https://{settings.canvas_base_url}/api/v1/users/self",
            headers={"Authorization": f"Bearer {pat}"},
        )
    print(f"[onboarding] canvas status={resp.status_code}", flush=True)
    if resp.status_code == 401:
        raise HTTPException(status_code=400, detail="Canvas rejected that token")
    resp.raise_for_status()

    ct, nonce = encrypt_pat(pat, settings.master_key_bytes())
    user.pat_encrypted = ct
    user.pat_nonce = nonce
    await db.flush()

    await sync_user(db, user, master_key=settings.master_key_bytes())
    await db.commit()
    return {"ok": True}
