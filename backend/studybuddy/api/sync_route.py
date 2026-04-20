from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from studybuddy.auth.deps import current_user
from studybuddy.config import get_settings
from studybuddy.db.base import get_db
from studybuddy.db.models import User
from studybuddy.sync.background import is_syncing, sync_and_index_background


router = APIRouter(prefix="/api", tags=["sync"])


@router.post("/sync")
async def trigger_sync(
    background: BackgroundTasks,
    user: User = Depends(current_user),
):
    """User-initiated refresh. Fires the same background sync pass as onboarding,
    so the dashboard's poller can show courses filling in live — no 60s block.
    """
    if user.pat_encrypted is None:
        raise HTTPException(status_code=400, detail="no Canvas token configured — complete onboarding first")
    settings = get_settings()
    if not is_syncing(user.id):
        background.add_task(sync_and_index_background, user.id, settings.master_key_bytes())
    return {"ok": True, "syncing": True}
