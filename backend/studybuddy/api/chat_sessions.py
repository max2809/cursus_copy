"""CRUD for chat sessions per course."""
from __future__ import annotations
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from studybuddy.auth.deps import current_user
from studybuddy.chat.deps import resolve_course
from studybuddy.db.base import get_db
from studybuddy.db.models import ChatMessage, ChatSession, User


router = APIRouter(prefix="/api/courses/{canvas_course_id}/chat/sessions", tags=["chat"])


class CreateSessionPayload(BaseModel):
    title: str | None = None


class SessionSummary(BaseModel):
    id: UUID
    title: str
    created_at: datetime
    updated_at: datetime


class SessionList(BaseModel):
    sessions: list[SessionSummary]


class MessageItem(BaseModel):
    id: UUID
    role: str
    content: str
    citations_json: list | None = None
    error: bool
    created_at: datetime


class SessionDetail(BaseModel):
    id: UUID
    title: str
    created_at: datetime
    updated_at: datetime
    messages: list[MessageItem]


@router.post("", response_model=SessionSummary)
async def create_session(
    canvas_course_id: int,
    payload: CreateSessionPayload,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionSummary:
    course = await resolve_course(db, user=user, canvas_course_id=canvas_course_id)
    title = (payload.title or "").strip() or "New chat"
    s = ChatSession(user_id=user.id, course_id=course.id, title=title)
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return SessionSummary(id=s.id, title=s.title, created_at=s.created_at, updated_at=s.updated_at)


@router.get("", response_model=SessionList)
async def list_sessions(
    canvas_course_id: int,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionList:
    course = await resolve_course(db, user=user, canvas_course_id=canvas_course_id)
    rows = (await db.execute(
        select(ChatSession)
        .where(ChatSession.user_id == user.id, ChatSession.course_id == course.id)
        .order_by(ChatSession.updated_at.desc())
    )).scalars().all()
    return SessionList(sessions=[
        SessionSummary(id=r.id, title=r.title, created_at=r.created_at, updated_at=r.updated_at)
        for r in rows
    ])


@router.get("/{session_id}", response_model=SessionDetail)
async def get_session(
    canvas_course_id: int,
    session_id: UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionDetail:
    course = await resolve_course(db, user=user, canvas_course_id=canvas_course_id)
    s = (await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == user.id,
            ChatSession.course_id == course.id,
        )
    )).scalar_one_or_none()
    if s is None:
        raise HTTPException(status_code=404, detail="session not found")
    msgs = (await db.execute(
        select(ChatMessage).where(ChatMessage.session_id == s.id).order_by(ChatMessage.created_at.asc())
    )).scalars().all()
    return SessionDetail(
        id=s.id, title=s.title,
        created_at=s.created_at, updated_at=s.updated_at,
        messages=[MessageItem(
            id=m.id, role=m.role, content=m.content,
            citations_json=m.citations_json, error=m.error,
            created_at=m.created_at,
        ) for m in msgs],
    )


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    canvas_course_id: int,
    session_id: UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    course = await resolve_course(db, user=user, canvas_course_id=canvas_course_id)
    row = (await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == user.id,
            ChatSession.course_id == course.id,
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="session not found")
    await db.execute(delete(ChatMessage).where(ChatMessage.session_id == row.id))
    await db.delete(row)
    await db.commit()
