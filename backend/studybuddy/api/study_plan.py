from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from studybuddy.auth.deps import current_user
from studybuddy.db.base import get_db
from studybuddy.db.models import User
from studybuddy.study_plan.service import (
    generate_weekly_plan,
    serialize_plan,
    set_task_done,
    study_plan_response,
)


router = APIRouter(prefix="/api/study-plan", tags=["study-plan"])


class GeneratePayload(BaseModel):
    selected_canvas_course_ids: list[int] = Field(default_factory=list)


class TaskDonePayload(BaseModel):
    done: bool


@router.get("/current")
async def current_study_plan(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await study_plan_response(db, user, today=date.today())


@router.post("/generate")
async def generate_study_plan(
    payload: GeneratePayload,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    plan = await generate_weekly_plan(
        db,
        user,
        selected_canvas_course_ids=payload.selected_canvas_course_ids,
        today=date.today(),
    )
    await db.commit()
    response = await study_plan_response(db, user, today=date.today())
    response["plan"] = serialize_plan(plan)
    return response


@router.patch("/tasks/{task_id}")
async def update_study_plan_task(
    task_id: str,
    payload: TaskDonePayload,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    updated = await set_task_done(
        db,
        user,
        task_id=task_id,
        done=payload.done,
        today=date.today(),
    )
    if not updated:
        raise HTTPException(status_code=404, detail="study plan task not found")
    await db.commit()
    return {"id": task_id, "done": payload.done}
