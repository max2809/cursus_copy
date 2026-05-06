# Study Plan Path Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cluttered Study plan page with a path-first weekly learning view: unified course sections by default, expandable course detail, and course selection behind an edit control.

**Architecture:** This is a frontend restructuring of `PlanView`; the existing study-plan API contract remains unchanged. `plan.courses[]` becomes the primary render source, while `plan.pressure_points[]` is merged into each course section for deadline counts and inline pressure context. Course selection moves from the top-level page into a secondary edit panel.

**Tech Stack:** React, TypeScript, Vitest/Testing Library, existing Cursus CSS in `frontend-v2/src/design/app.css`, existing React Query mutations in `frontend-v2/src/api/queries.ts`.

---

### Task 1: Frontend Regression Tests

**Files:**
- Modify: `frontend-v2/src/pages/PlanView.test.tsx`

- [ ] **Step 1: Replace tab-focused expectations with path-first expectations**

Update the generated-plan tests so they expect all generated course sections to be visible at once and no course tabs to be rendered.

Add/modify assertions like:

```ts
expect(screen.getByRole("heading", { name: "Weekly learning path" })).toBeInTheDocument();
expect(screen.getByText("2 courses - 2 steps - 2 deadlines")).toBeInTheDocument();
expect(screen.queryByRole("tablist", { name: "Study plan courses" })).not.toBeInTheDocument();
expect(screen.getByRole("heading", { name: "Microeconomics" })).toBeInTheDocument();
expect(screen.getByRole("heading", { name: "Finance" })).toBeInTheDocument();
expect(screen.getByText("Study Micro Topic")).toBeInTheDocument();
expect(screen.getByText("Study Finance Topic")).toBeInTheDocument();
```

- [ ] **Step 2: Add collapsed/expanded course detail test**

Add a test where one course has at least three tasks and source refs. Assert that the first two tasks are visible in collapsed state, the third task/source chip is hidden, then clicking `Expand Microeconomics` reveals all tasks and source chips.

Use expectations like:

```ts
expect(screen.getByText("Study Topic 1")).toBeInTheDocument();
expect(screen.getByText("Study Topic 2")).toBeInTheDocument();
expect(screen.queryByText("Study Topic 3")).not.toBeInTheDocument();
expect(screen.queryByText("Week 1 Slides.pdf")).not.toBeInTheDocument();

fireEvent.click(screen.getByRole("button", { name: "Expand Microeconomics" }));

expect(screen.getByText("Study Topic 3")).toBeInTheDocument();
expect(screen.getByText("Week 1 Slides.pdf")).toBeInTheDocument();
```

- [ ] **Step 3: Add course edit panel test**

Change the course-selection test so the default page does not show course checkboxes. Clicking `Edit courses` should reveal the selector, allow toggling a course, and `Update path` should call the existing generate mutation with selected IDs.

Use expectations like:

```ts
expect(screen.queryByRole("checkbox", { name: /Finance/ })).not.toBeInTheDocument();

fireEvent.click(screen.getByRole("button", { name: "Edit courses" }));
expect(screen.getByRole("checkbox", { name: /Finance/ })).toBeInTheDocument();
fireEvent.click(screen.getByRole("checkbox", { name: /Finance/ }));
fireEvent.click(screen.getByRole("button", { name: "Update path" }));

await waitFor(() => {
  expect(mocks.generateMutateAsync).toHaveBeenCalledWith({
    selectedCanvasCourseIds: [202, 101],
  });
});
```

- [ ] **Step 4: Run tests and verify they fail for missing behavior**

Run:

```powershell
npm.cmd run test -- src/pages/PlanView.test.tsx
```

Expected result: failures mentioning missing `Weekly learning path`, visible old checkboxes, or old tab behavior.

### Task 2: PlanView Path-First Layout

**Files:**
- Modify: `frontend-v2/src/pages/PlanView.tsx`

- [ ] **Step 1: Replace tab state with expanded-course state**

Remove `activePlanCanvasCourseId` and `PlanCourseTabs`. Add:

```ts
const [editingCourses, setEditingCourses] = useState(false);
const [expandedCourses, setExpandedCourses] = useState<Set<number>>(new Set());
```

Use a toggle helper:

```ts
function toggleExpanded(canvasCourseId: number) {
  setExpandedCourses((prev) => {
    const next = new Set(prev);
    if (next.has(canvasCourseId)) next.delete(canvasCourseId);
    else next.add(canvasCourseId);
    return next;
  });
}
```

- [ ] **Step 2: Add summary helpers**

Add helper functions in `PlanView.tsx`:

```ts
function countDeadlineSteps(plan: StudyPlanPayload | null): number {
  return plan?.pressure_points.length ?? 0;
}

function countSteps(plan: StudyPlanPayload | null): number {
  return plan?.courses.reduce((sum, course) => sum + course.tasks.length, 0) ?? 0;
}

function countCompleted(course: { tasks: StudyPlanTask[] }): number {
  return course.tasks.filter((task) => task.done).length;
}

function coursePressurePoints(plan: StudyPlanPayload, canvasCourseId: number) {
  return plan.pressure_points.filter((point) => point.canvas_course_id === canvasCourseId);
}
```

- [ ] **Step 3: Rewrite the hero**

Render:

```tsx
<h1 className="plan-title">Weekly learning path</h1>
<p className="plan-sub">
  {plan
    ? `${plan.courses.length} courses - ${countSteps(plan)} steps - ${countDeadlineSteps(plan)} deadlines`
    : "Build a weekly path from your Canvas deadlines and indexed material."}
</p>
```

Actions:

- `Generate path` when no plan exists.
- `Regenerate` when a plan exists.
- `Edit courses` as a secondary button.

- [ ] **Step 4: Move course selector behind an edit panel**

Only render the course checkbox grid inside:

```tsx
{editingCourses && (
  <section className="plan-edit-panel" aria-label="Edit courses">
    ...
    <button type="button" onClick={handleGenerate}>Update path</button>
  </section>
)}
```

The main page should not render course checkboxes unless `editingCourses` is true.

- [ ] **Step 5: Replace tabs/active course rendering with unified course sections**

Replace:

```tsx
<PlanCourseTabs ... />
<PressurePoints ... />
<ActivePlanCourse ... />
```

with:

```tsx
<PlanPath
  plan={plan}
  expandedCourses={expandedCourses}
  onToggleCourse={toggleExpanded}
  onToggleTask={(task) => setTaskDone.mutate({ taskId: task.id, done: !task.done })}
/>
```

- [ ] **Step 6: Implement `PlanPath` and `PlanCourseSection`**

Each course section should:

- Always show the course heading.
- Show first two tasks when collapsed.
- Show all tasks when expanded.
- Show source chips only when expanded.
- Show an accessible button named `Expand {course.name}` or `Collapse {course.name}`.

The body logic:

```ts
const isExpanded = expandedCourses.has(course.canvas_course_id);
const visibleTasks = isExpanded ? course.tasks : course.tasks.slice(0, 2);
const hiddenTaskCount = course.tasks.length - visibleTasks.length;
const pressurePoints = coursePressurePoints(plan, course.canvas_course_id);
```

Pass `showSources={isExpanded}` into `PlanTaskRow`.

- [ ] **Step 7: Keep task completion behavior unchanged**

`PlanTaskRow` should continue to render the existing `Checkbox` and call the existing mutation through `onToggle`.

### Task 3: CSS For Path UI

**Files:**
- Modify: `frontend-v2/src/design/app.css`

- [ ] **Step 1: Remove/neutralize tab-only styling if unused**

Keep old classes if harmless, but new layout should use:

- `.plan-actions`
- `.plan-edit-panel`
- `.plan-path`
- `.plan-path-course`
- `.plan-path-course-head`
- `.plan-path-summary`
- `.plan-path-preview`
- `.plan-expand`

- [ ] **Step 2: Style course sections as compact repeated items**

Use existing colors and radius rules. Avoid nested cards. Course sections should be full-width rows/sections with a light border and compact spacing.

- [ ] **Step 3: Hide noisy metadata from the collapsed state**

Use class-level styling rather than inline conditions where possible. Source rows remain available in expanded state only.

### Task 4: Verification

**Files:**
- No production file changes.

- [ ] **Step 1: Run focused PlanView tests**

```powershell
npm.cmd run test -- src/pages/PlanView.test.tsx
```

Expected: all PlanView tests pass.

- [ ] **Step 2: Run full frontend suite**

```powershell
npm.cmd run test
```

Expected: all frontend tests pass.

- [ ] **Step 3: Run production build**

```powershell
$env:VITE_API_BASE_URL='http://localhost:8000'; npm.cmd run build
```

Expected: build succeeds. Existing large-chunk warning is acceptable.

- [ ] **Step 4: Run diff check**

```powershell
git diff --check
```

Expected: no whitespace errors.

### Task 5: Docs, Commit, Push, Deploy Check

**Files:**
- Modify: `journey-into-studybuddy.md`
- Modify: `C:\Users\Minex\.codex\memories\cursus.md`

- [ ] **Step 1: Record the UX update**

Add a short note that the Study Plan page was redesigned into a weekly learning path with expandable course sections and secondary course editing.

- [ ] **Step 2: Commit**

```powershell
git add frontend-v2/src/pages/PlanView.tsx frontend-v2/src/pages/PlanView.test.tsx frontend-v2/src/design/app.css docs/superpowers/plans/2026-05-06-study-plan-path-redesign-plan.md journey-into-studybuddy.md
git commit -m "fix: simplify study plan learning path"
```

- [ ] **Step 3: Push and inspect deployment**

```powershell
git push origin main
Start-Sleep -Seconds 10; npx.cmd vercel ls
```

Expected: latest `studybuddy` production deployment is `Ready`.
