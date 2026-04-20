"""Background sync + indexing for onboarding and stale-dashboard triggers.

Runs as a FastAPI BackgroundTask. Opens its own AsyncSessionLocal because
the request-scoped session is closed by the time the task fires.

In-memory concurrency guard prevents two parallel syncs for the same user
from hitting Canvas and the DB in parallel (idempotent but wasteful).
Scope: single Railway instance. If we ever scale out, move this to a
DB-backed flag or a Redis lock.
"""

import logging
from uuid import UUID

from studybuddy.canvas.client import CanvasUnauthorized
from studybuddy.config import get_settings
from studybuddy.db.base import AsyncSessionLocal
from studybuddy.db.models import User
from studybuddy.chat.deps import get_embedder
from studybuddy.rag.indexer import index_assignment_description, index_file
from studybuddy.security.crypto import decrypt_pat
from studybuddy.sync.orchestrator import sync_user

logger = logging.getLogger(__name__)

_syncing_users: set[UUID] = set()


def is_syncing(user_id: UUID) -> bool:
    return user_id in _syncing_users


async def sync_and_index_background(user_id: UUID, master_key: bytes) -> None:
    """Full sync (commits per course) followed by indexing of pending files."""
    if user_id in _syncing_users:
        return
    _syncing_users.add(user_id)
    try:
        result = None
        canvas_base_url = None
        pat: str | None = None

        async with AsyncSessionLocal() as db:
            user = await db.get(User, user_id)
            if user is None or user.pat_encrypted is None:
                return
            canvas_base_url = user.canvas_base_url
            try:
                pat = decrypt_pat(user.pat_encrypted, user.pat_nonce, master_key)
            except Exception:
                logger.exception("sync_and_index_background: PAT decrypt failed for %s", user_id)
                return
            try:
                result = await sync_user(db, user, master_key=master_key)
            except CanvasUnauthorized:
                # sync_user clears the PAT; persist that state.
                logger.warning("sync_and_index_background: Canvas rejected PAT for %s", user_id)
                await db.commit()
                return
            except Exception:
                logger.exception("sync_and_index_background: sync_user failed for %s", user_id)
                # Rollback is safe — sync_user commits per course, so partial
                # data is already durable; rollback only affects the tail.
                await db.rollback()
                return
            # sync_user commits per course and sets last_synced_at at the end;
            # a final flush keeps the session consistent.
            await db.commit()

        if result is None:
            return

        settings = get_settings()
        max_bytes = settings.rag_max_upload_mb * 1024 * 1024
        chunk_tokens = settings.rag_chunk_tokens
        chunk_overlap = settings.rag_chunk_overlap
        embedder = get_embedder()

        for file_id in result.pending_file_ids:
            try:
                async with AsyncSessionLocal() as db:
                    u = await db.get(User, user_id)
                    if u is None:
                        continue
                    await index_file(
                        db,
                        user=u,
                        file_id=file_id,
                        voyage_embedder=embedder,
                        pat=pat,
                        canvas_base_url=canvas_base_url,
                        max_bytes=max_bytes,
                        chunk_tokens=chunk_tokens,
                        chunk_overlap=chunk_overlap,
                    )
                    await db.commit()
            except Exception:
                logger.exception("sync_and_index_background: index_file failed for %s", file_id)

        for deadline_id in result.pending_deadline_ids:
            try:
                async with AsyncSessionLocal() as db:
                    u = await db.get(User, user_id)
                    if u is None:
                        continue
                    await index_assignment_description(
                        db,
                        user=u,
                        deadline_id=deadline_id,
                        voyage_embedder=embedder,
                        chunk_tokens=chunk_tokens,
                        chunk_overlap=chunk_overlap,
                    )
                    await db.commit()
            except Exception:
                logger.exception(
                    "sync_and_index_background: index_assignment_description failed for %s",
                    deadline_id,
                )
    finally:
        _syncing_users.discard(user_id)
