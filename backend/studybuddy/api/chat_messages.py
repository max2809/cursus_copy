"""Streaming chat message endpoint (Server-Sent Events)."""
from __future__ import annotations
import json
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from studybuddy.auth.deps import current_user
from studybuddy.chat.deps import get_claude, get_embedder, get_reranker, resolve_course
from studybuddy.chat.service import answer_and_stream
from studybuddy.config import get_settings
from studybuddy.db.base import get_db
from studybuddy.db.models import ChatSession, User


router = APIRouter(
    prefix="/api/courses/{canvas_course_id}/chat/sessions/{session_id}/messages",
    tags=["chat"],
)


class MessagePayload(BaseModel):
    content: str = Field(min_length=1)


@router.post("")
async def post_message(
    canvas_course_id: int,
    session_id: UUID,
    payload: MessagePayload,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    text = payload.content.strip()
    if not text:
        raise HTTPException(status_code=422, detail="content must be non-empty")

    course = await resolve_course(db, user=user, canvas_course_id=canvas_course_id)
    session = (await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == user.id,
            ChatSession.course_id == course.id,
        )
    )).scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")

    # Auto-title first message if session is still on its placeholder.
    if session.title.lower() in ("new chat", "untitled", ""):
        session.title = text[:60]
        await db.flush()

    settings = get_settings()
    embedder = get_embedder()
    reranker = get_reranker()
    claude = get_claude()

    async def _iter():
        try:
            async for event in answer_and_stream(
                db,
                user=user,
                session_id=session.id,
                user_text=text,
                embedder=embedder,
                reranker=reranker,
                claude_client=claude,
                course_name=course.name,
                canvas_base_url=user.canvas_base_url,
                top_k_recall=settings.rag_top_k_recall,
                top_k_rerank=settings.rag_top_k_rerank,
                claude_model=settings.rag_claude_model,
                today=date.today(),
                course_start_date=course.start_date,
            ):
                if event.kind == "token":
                    yield {"event": "token", "data": json.dumps({"text": event.text})}
                elif event.kind == "done":
                    yield {
                        "event": "done",
                        "data": json.dumps({
                            "message_id": str(event.message_id),
                            "citations": event.citations or [],
                        }),
                    }
                elif event.kind == "error":
                    yield {
                        "event": "error",
                        "data": json.dumps({
                            "message": event.error or "stream failed",
                            "message_id": str(event.message_id) if event.message_id else None,
                        }),
                    }
            await db.commit()
        except Exception as e:  # noqa: BLE001
            yield {"event": "error", "data": json.dumps({"message": f"{type(e).__name__}: {e}"})}

    return EventSourceResponse(_iter())
