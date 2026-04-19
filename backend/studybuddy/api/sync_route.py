from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from studybuddy.api.materials import enqueue_pending_indexing
from studybuddy.auth.deps import current_user
from studybuddy.canvas.client import CanvasUnauthorized
from studybuddy.config import get_settings
from studybuddy.db.base import get_db
from studybuddy.db.models import User
from studybuddy.security.crypto import decrypt_pat
from studybuddy.sync.orchestrator import sync_user


router = APIRouter(prefix="/api", tags=["sync"])


@router.post("/sync")
async def trigger_sync(
    background: BackgroundTasks,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.pat_encrypted is None:
        raise HTTPException(status_code=400, detail="no Canvas token configured — complete onboarding first")
    settings = get_settings()
    try:
        result = await sync_user(db, user, master_key=settings.master_key_bytes())
        await db.commit()
        pat = decrypt_pat(user.pat_encrypted, user.pat_nonce, settings.master_key_bytes())
        enqueue_pending_indexing(background, user=user, pat=pat, result=result)
    except CanvasUnauthorized:
        await db.commit()
        raise HTTPException(status_code=401, detail="Canvas rejected your token — re-enter it in Settings")
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=500, detail="sync failed")
    return {"ok": True, "last_synced_at": user.last_synced_at.isoformat()}
