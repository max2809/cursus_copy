# Study Plan Path Redesign

Date: 2026-05-05

## Goal

Redesign the Study plan page around a single product job: help the student understand and work through this week's learning path. The default screen should answer, "What should I learn or complete this week across my current courses?"

The page should stop behaving like a setup/control surface. Course selection, regeneration, sources, and diagnostic metadata should exist, but they should not dominate the first view.

## Current Problems

- The page exposes too many concepts at once: course selection grid, course tabs, pressure points, checklist rows, source chips, confidence labels, and regenerate controls.
- The course selector repeats the same course information already present in the sidebar and generated tabs.
- Pressure points are visually separated from checklist tasks, even though they are part of the same weekly path.
- The generated path is course-tab driven, so the user has to pick a course before seeing what the week looks like overall.
- Metadata like `high confidence`, `recommended`, and source chips adds noise before the user has understood the actual work.
- Setup is too prominent for a page the user will visit repeatedly.

## Product Direction

Use a path-first layout:

1. Show a unified weekly overview across selected/current courses.
2. Group the path by course so every course's weekly work is visible without tabs.
3. Keep each course compact by default.
4. Let the user expand a course to inspect details, sources, and all steps.
5. Move course selection into a secondary `Edit courses` drawer/modal.

## Default Screen

The top of the page should be compact:

- Week range, for example `May 5 - May 11`.
- Title: `Weekly learning path`.
- Summary line, for example `3 courses - 18 steps - 4 deadlines`.
- Primary action only when no plan exists: `Generate path`.
- Secondary actions after a plan exists:
  - `Regenerate`
  - `Edit courses`

The top area should not contain a visible checkbox grid.

## Main Path Layout

The main content should be one vertical list of course sections. Each selected/generated course gets one section.

Each collapsed course section should show:

- Course badge.
- Course name and short code.
- A compact status summary:
  - number of steps,
  - number of deadline-backed steps,
  - number completed.
- The first two or three highest-priority visible steps.
- A clear expand/collapse control.

The collapsed section should be useful on its own. A user should be able to scan the whole page and understand the week without opening anything.

## Course Expansion

Expanding a course reveals the complete course path:

- All steps for that course.
- Deadline context inline with the relevant step.
- Source chips or links for each step.
- Lower-priority/background reading steps.
- Optional details/reason text.

Source chips should only appear in expanded state unless a source is essential to complete a visible collapsed step.

## Task Presentation

Task copy should be action-oriented and specific. Avoid generic prefixes like `Study` when the material title is administrative or vague.

Preferred patterns:

- `Read the assignment brief and outline the required sections`
- `Review L6/L7 conflict causes before drafting`
- `Make recall notes for genetics concepts`
- `Draft the capstone methodology paragraph`

Avoid:

- `Study Syllabus`
- `Study All study materials are protected by copyright`
- `Study Assessment`

Priority should affect ordering and subtle styling, but priority labels should not dominate every row. Use visible deadline labels only where useful.

## Course Selection

Course selection moves behind `Edit courses`.

The drawer/modal should:

- Default to selected/current courses at the top.
- Allow searching/filtering if the full course list is large.
- Preserve the current selected-course behavior.
- End with one clear action: `Update path`.

The main page should not show all historical courses unless the user explicitly opens course editing.

## Empty And Loading States

When there is no generated plan:

- Show a simple empty state explaining that Cursus can build a weekly path from current Canvas deadlines and indexed material.
- Show selected/current courses as a short text summary, not a grid.
- Primary button: `Generate path`.

When sync/indexing is incomplete:

- Keep the path visible if possible.
- Show a small status note like `Some material is still indexing` near affected course sections.
- Do not block the whole page unless no usable data exists.

## Data And API Fit

The existing study-plan payload can support this redesign:

- `plan.courses[]` already provides course-level tasks.
- `plan.pressure_points[]` can be merged into the relevant course section instead of rendered as a separate top-level grid.
- Task completion already persists via `PATCH /api/study-plan/tasks/{task_id}`.
- Course selection already persists through plan generation.

The first implementation should be mostly frontend restructuring. Backend changes are only needed if the task generator cannot provide good action-oriented task titles after existing filtering improvements.

## Non-Goals

- Do not build a calendar scheduler.
- Do not introduce exact time estimates yet.
- Do not build a drag-and-drop planning system.
- Do not replace the deterministic backend generator in this redesign.
- Do not add cross-course LLM planning until the simpler path-first UX proves useful.

## Testing Strategy

Frontend regression tests should cover:

- The default page no longer renders the full checkbox grid.
- A generated plan renders all course sections in one unified page.
- Each course shows only a compact subset of tasks while collapsed.
- Expanding a course reveals all tasks and source chips.
- Task completion still calls the existing mutation.
- `Edit courses` reveals the course selector and regenerates with the selected ids.

Manual verification should cover:

- Desktop scanability with three current courses.
- Mobile behavior with the same generated plan.
- A course with deadline-backed tasks.
- A course with only material-backed tasks.
- A course with no useful indexed material.

## Success Criteria

- A student can understand the week's work without clicking through tabs.
- The first viewport is mostly the actual weekly path, not configuration.
- Course selection is available but secondary.
- Source/detail information remains accessible without overwhelming the default view.
- The page feels like a guided learning path rather than a dashboard of controls.
