import datetime as dt

import pytest
from sqlalchemy import select

from studybuddy.db.models import Chunk, Course, Deadline, File as FileModel, User


async def _seed_weekly_plan_data(db):
    user = (await db.execute(select(User))).scalar_one()
    taking = Course(
        user_id=user.id,
        canvas_course_id=101,
        name="Microeconomics",
        code="MIC101",
        status="taking",
    )
    elective = Course(
        user_id=user.id,
        canvas_course_id=202,
        name="Finance",
        code="FIN202",
        status="taken",
    )
    hidden = Course(
        user_id=user.id,
        canvas_course_id=303,
        name="Statistics",
        code="STA303",
        status="hidden",
    )
    db.add_all([taking, elective, hidden])
    await db.flush()

    due = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=2)
    db.add(
        Deadline(
            user_id=user.id,
            course_id=taking.id,
            canvas_source_type="assignment",
            canvas_source_id="a1",
            title="Problem Set 1",
            description="Competition and market structures.",
            due_at=due,
            url="https://canvas.example/courses/101/assignments/1",
            type="assignment",
            points_possible=10,
            submitted=False,
        )
    )
    f = FileModel(
        user_id=user.id,
        course_id=taking.id,
        canvas_file_id=1,
        filename="Week 1 Competition Slides.pdf",
        url="https://canvas.example/files/1",
        source="canvas",
        source_url=None,
        indexed_at=dt.datetime.now(dt.timezone.utc),
    )
    db.add(f)
    await db.flush()
    db.add(
        Chunk(
            user_id=user.id,
            course_id=taking.id,
            file_id=f.id,
            source_kind="file",
            content_text="Perfect competition, monopoly, and oligopoly are the core Week 1 topics.",
            chunk_index=0,
            token_count=12,
            heading_path="Week 1 / Competition",
            embedding=[1.0] + [0.0] * 511,
        )
    )
    await db.commit()
    return taking, elective, hidden


@pytest.mark.asyncio
async def test_current_study_plan_defaults_to_taking_courses(authed_client, db):
    taking, elective, hidden = await _seed_weekly_plan_data(db)

    resp = await authed_client.get("/api/study-plan/current")

    assert resp.status_code == 200
    body = resp.json()
    assert body["selected_canvas_course_ids"] == [taking.canvas_course_id]
    assert body["plan"] is None
    statuses = {c["canvas_course_id"]: c["status"] for c in body["available_courses"]}
    assert statuses == {
        taking.canvas_course_id: "taking",
        elective.canvas_course_id: "taken",
        hidden.canvas_course_id: "hidden",
    }


@pytest.mark.asyncio
async def test_generate_study_plan_builds_course_checklists(authed_client, db):
    taking, elective, _hidden = await _seed_weekly_plan_data(db)

    resp = await authed_client.post(
        "/api/study-plan/generate",
        json={"selected_canvas_course_ids": [taking.canvas_course_id, elective.canvas_course_id]},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["selected_canvas_course_ids"] == [taking.canvas_course_id, elective.canvas_course_id]
    plan = body["plan"]
    assert plan["week_start"]
    assert plan["week_end"]
    assert [c["canvas_course_id"] for c in plan["courses"]] == [
        taking.canvas_course_id,
        elective.canvas_course_id,
    ]
    micro = plan["courses"][0]
    assert any("Problem Set 1" in task["title"] for task in micro["tasks"])
    assert any("Competition" in task["title"] for task in micro["tasks"])
    assert plan["pressure_points"][0]["title"] == "Problem Set 1"


@pytest.mark.asyncio
async def test_study_plan_task_completion_persists(authed_client, db):
    taking, _elective, _hidden = await _seed_weekly_plan_data(db)
    generated = await authed_client.post(
        "/api/study-plan/generate",
        json={"selected_canvas_course_ids": [taking.canvas_course_id]},
    )
    task_id = generated.json()["plan"]["courses"][0]["tasks"][0]["id"]

    resp = await authed_client.patch(
        f"/api/study-plan/tasks/{task_id}",
        json={"done": True},
    )

    assert resp.status_code == 200
    assert resp.json()["done"] is True

    current = await authed_client.get("/api/study-plan/current")
    task = current.json()["plan"]["courses"][0]["tasks"][0]
    assert task["id"] == task_id
    assert task["done"] is True
