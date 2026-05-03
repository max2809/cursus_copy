# Weekly Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the deadline-only Study plan view with a persisted per-course weekly checklist that auto-selects current courses, lets the user adjust selected courses, generates course-specific steps, and preserves checked tasks.

**Architecture:** Add a `study_plans` table that stores the latest generated weekly plan as JSON plus completed task ids. The backend exposes `/api/study-plan/current`, `/api/study-plan/generate`, and `/api/study-plan/tasks/{task_id}`. The frontend replaces `PlanView` with a setup/generate/checklist UI using React Query.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, Pydantic, React, React Query, Vitest, pytest.

---

### Task 1: Backend Contract and Persistence

**Files:**
- Modify: `backend/studybuddy/db/models.py`
- Create: `backend/migrations/versions/0005_study_plans.py`
- Create: `backend/studybuddy/api/study_plan.py`
- Modify: `backend/studybuddy/main.py`
- Test: `backend/tests/test_study_plan_api.py`

- [ ] **Step 1: Write failing backend API tests**

Add tests that create one `taking` course, one `taken` course, one hidden course, deadlines, files, and chunks. Assert:

```python
resp = await authed_client.get("/api/study-plan/current")
assert resp.status_code == 200
assert body["selected_canvas_course_ids"] == [101]
assert body["available_courses"] includes taking/taken/hidden rows
assert body["plan"] is None
```

Then POST `/api/study-plan/generate` with selected taking+hidden course ids and assert:

```python
assert body["plan"]["courses"][0]["tasks"]
assert body["plan"]["pressure_points"]
assert every task has id, title, priority, source_refs, done
```

Finally PATCH one task to done and assert a subsequent GET returns that task with `done: true`.

- [ ] **Step 2: Add `StudyPlan` model and Alembic migration**

Create a single JSON-persisted plan row with:

```python
class StudyPlan(Base):
    __tablename__ = "study_plans"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    week_end: Mapped[date] = mapped_column(Date, nullable=False)
    selected_course_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    plan_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    completed_task_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
```

- [ ] **Step 3: Implement deterministic weekly checklist service**

Build the first version from stored Cursus data:

```python
generate_weekly_plan(db, user, selected_canvas_course_ids, today)
```

Rules:

- Default selected courses are `status == "taking"`.
- Plan window is next 7 days starting today.
- Include overdue, due-this-week, and no-due-date work as pressure points/tasks.
- Add 2-4 material/topic tasks per course from indexed chunks, preferring syllabus/pages/module-derived headings and recent course files.
- Preserve completed task ids on regeneration when task ids are stable.
- Never include another user's courses or chunks.

- [ ] **Step 4: Wire FastAPI routes**

Expose:

```text
GET /api/study-plan/current
POST /api/study-plan/generate
PATCH /api/study-plan/tasks/{task_id}
```

### Task 2: Frontend Weekly Checklist UI

**Files:**
- Modify: `frontend-v2/src/api/types.ts`
- Create: `frontend-v2/src/api/studyPlan.ts`
- Modify: `frontend-v2/src/api/queries.ts`
- Modify: `frontend-v2/src/pages/PlanView.tsx`
- Test: `frontend-v2/src/pages/PlanView.test.tsx`

- [ ] **Step 1: Write failing PlanView test**

Mock study-plan APIs. Assert the page:

- auto-selects taking courses,
- lets the user toggle an extra course,
- calls generate with selected course ids,
- renders per-course tasks,
- toggles a task completion checkbox.

- [ ] **Step 2: Add typed API helpers and React Query hooks**

Add `getStudyPlan`, `generateStudyPlan`, and `setStudyPlanTaskDone`.

- [ ] **Step 3: Replace deadline list UI**

Render:

- title and short description,
- course selection setup row,
- generate/regenerate button,
- pressure points,
- one checklist section per course,
- task checkbox, priority, reason, and source chips.

### Task 3: Verification and Continuity

**Files:**
- Modify: `journey-into-studybuddy.md`
- Modify: `C:\Users\Minex\.codex\memories\cursus.md`

- [ ] **Step 1: Run focused backend and frontend tests**

```powershell
uv run --extra dev pytest tests/test_study_plan_api.py -q
npm.cmd run test -- src/pages/PlanView.test.tsx
```

- [ ] **Step 2: Run full verification**

```powershell
uv run --extra dev pytest -q
npm.cmd run test
$env:VITE_API_BASE_URL='http://localhost:8000'; npm.cmd run build
```

- [ ] **Step 3: Update journey and memory**

Record the generated weekly checklist feature, verification counts, and latest commit ids.
