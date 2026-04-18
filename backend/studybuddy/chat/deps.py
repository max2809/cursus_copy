"""Small factories and lookup helpers shared by the chat/materials routers."""
from __future__ import annotations
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from studybuddy.config import get_settings
from studybuddy.db.models import Course, User
from studybuddy.rag.embedder import VoyageEmbedder
from studybuddy.rag.reranker import VoyageReranker


def get_embedder() -> VoyageEmbedder:
    s = get_settings()
    if not s.voyage_api_key:
        raise RuntimeError("VOYAGE_API_KEY is not set")
    return VoyageEmbedder(api_key=s.voyage_api_key)


def get_reranker() -> VoyageReranker:
    s = get_settings()
    if not s.voyage_api_key:
        raise RuntimeError("VOYAGE_API_KEY is not set")
    return VoyageReranker(api_key=s.voyage_api_key)


def get_claude():
    s = get_settings()
    if not s.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")
    from anthropic import AsyncAnthropic
    return AsyncAnthropic(api_key=s.anthropic_api_key)


async def resolve_course(db: AsyncSession, *, user: User, canvas_course_id: int) -> Course:
    row = (await db.execute(
        select(Course).where(
            Course.user_id == user.id,
            Course.canvas_course_id == canvas_course_id,
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="course not found")
    return row
