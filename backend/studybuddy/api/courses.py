"""Course-level endpoints (status toggle for taking / taken / hidden)."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from studybuddy.auth.deps import current_user
from studybuddy.db.base import get_db
from studybuddy.db.models import Course, User


router = APIRouter(prefix="/api/courses", tags=["courses"])

CourseStatus = Literal["taking", "taken", "hidden"]


class StatusUpdate(BaseModel):
    status: CourseStatus


class CourseSummary(BaseModel):
    id: str
    canvas_course_id: int
    name: str
    code: str | None
    status: CourseStatus


@router.get("")
async def list_courses(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CourseSummary]:
    """Every course synced for this user, including hidden ones. Used by the
    sidebar to render the 'Hidden (N)' section so users can unhide."""
    rows = (
        await db.execute(
            select(Course)
            .where(
                Course.user_id == user.id,
                Course.name != "(unnamed)",
                Course.name != "",
            )
            .order_by(Course.name.asc())
        )
    ).scalars().all()
    return [
        CourseSummary(
            id=str(c.id),
            canvas_course_id=c.canvas_course_id,
            name=c.name,
            code=c.code,
            status=c.status,  # type: ignore[arg-type]
        )
        for c in rows
    ]


@router.patch("/{canvas_course_id}/status")
async def update_status(
    canvas_course_id: int,
    payload: StatusUpdate,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> CourseSummary:
    course = (
        await db.execute(
            select(Course).where(
                Course.user_id == user.id,
                Course.canvas_course_id == canvas_course_id,
            )
        )
    ).scalar_one_or_none()
    if course is None:
        raise HTTPException(status_code=404, detail="course not found")
    course.status = payload.status
    await db.commit()
    return CourseSummary(
        id=str(course.id),
        canvas_course_id=course.canvas_course_id,
        name=course.name,
        code=course.code,
        status=course.status,  # type: ignore[arg-type]
    )
