import { useEffect, useMemo, useState } from "react";
import type {
  CourseDeadlines,
  CourseSummary,
  StudyPlanPayload,
  StudyPlanPriority,
  StudyPlanTask,
} from "../api/types";
import {
  useGenerateStudyPlan,
  useSetStudyPlanTaskDone,
  useStudyPlan,
} from "../api/queries";
import { Checkbox } from "../components/home/Checkbox";
import { CourseBadge } from "../components/shared/CourseBadge";
import { shortCourseCode } from "../lib/course";
import { API_BASE_URL } from "../api/client";

interface Props {
  courses: CourseDeadlines[];
}

const PRIORITY_LABEL: Record<StudyPlanPriority, string> = {
  high: "High",
  medium: "Medium",
  recommended: "Recommended",
  low: "Low",
};

function fallbackCourses(courses: CourseDeadlines[]): CourseSummary[] {
  return courses.map((c) => ({
    id: c.course.id,
    canvas_course_id: c.course.canvas_course_id,
    name: c.course.name,
    code: c.course.code,
    status: c.course.status ?? "taking",
  }));
}

function compareCourses(a: CourseSummary, b: CourseSummary): number {
  return (
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
    (a.code ?? "").localeCompare(b.code ?? "", undefined, { sensitivity: "base" }) ||
    a.canvas_course_id - b.canvas_course_id
  );
}

function formatWindow(plan: StudyPlanPayload | null): string {
  if (!plan) return "Next 7 days";
  const start = new Date(`${plan.week_start}T00:00:00`);
  const end = new Date(`${plan.week_end}T00:00:00`);
  return `${start.toLocaleDateString([], { month: "short", day: "numeric" })} - ${end.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

function formatDue(iso: string | null): string {
  if (!iso) return "No due date";
  return new Date(iso).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function sourceHref(url: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_BASE_URL}${url}`;
}

export function PlanView({ courses }: Props) {
  const { data, isLoading, error } = useStudyPlan();
  const generatePlan = useGenerateStudyPlan();
  const setTaskDone = useSetStudyPlanTaskDone();
  const [showAllCourses, setShowAllCourses] = useState(false);
  const [activePlanCanvasCourseId, setActivePlanCanvasCourseId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(data?.selected_canvas_course_ids ?? []),
  );
  const alphabetizedCourses = useMemo(
    () => [...(data?.available_courses ?? fallbackCourses(courses))].sort(compareCourses),
    [courses, data?.available_courses],
  );
  const availableCourses = useMemo(
    () =>
      [...alphabetizedCourses].sort((a, b) => {
        const aRank = selected.has(a.canvas_course_id)
          ? 0
          : a.status === "taking"
            ? 1
            : 2;
        const bRank = selected.has(b.canvas_course_id)
          ? 0
          : b.status === "taking"
            ? 1
            : 2;
        return aRank - bRank || compareCourses(a, b);
      }),
    [alphabetizedCourses, selected],
  );
  const plan = data?.plan ?? null;
  const planCourseKey = (plan?.courses ?? [])
    .map((course) => course.canvas_course_id)
    .join(",");

  const selectedKey = (data?.selected_canvas_course_ids ?? [])
    .slice()
    .sort((a, b) => a - b)
    .join(",");

  useEffect(() => {
    if (!data) return;
    setSelected(new Set(data.selected_canvas_course_ids));
  }, [data, selectedKey]);

  useEffect(() => {
    const planCourses = plan?.courses ?? [];
    if (planCourses.length === 0) {
      setActivePlanCanvasCourseId(null);
      return;
    }
    setActivePlanCanvasCourseId((current) =>
      current !== null && planCourses.some((course) => course.canvas_course_id === current)
        ? current
        : planCourses[0].canvas_course_id,
    );
  }, [plan, planCourseKey]);

  const selectedIds = useMemo(
    () => availableCourses
      .filter((course) => selected.has(course.canvas_course_id))
      .map((course) => course.canvas_course_id),
    [availableCourses, selected],
  );
  const visibleCourses = useMemo(
    () =>
      showAllCourses
        ? availableCourses
        : availableCourses.filter(
            (course) =>
              selected.has(course.canvas_course_id) || course.status === "taking",
          ),
    [availableCourses, selected, showAllCourses],
  );
  const hiddenCourseCount = availableCourses.length - visibleCourses.length;

  function toggleCourse(canvasCourseId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(canvasCourseId)) next.delete(canvasCourseId);
      else next.add(canvasCourseId);
      return next;
    });
  }

  async function handleGenerate() {
    await generatePlan.mutateAsync({ selectedCanvasCourseIds: selectedIds });
  }

  if (isLoading && !data) {
    return <div className="plan-page"><div className="plan-empty">Loading weekly checklist...</div></div>;
  }

  if (error) {
    return (
      <div className="plan-page">
        <div className="plan-empty">Could not load the weekly checklist.</div>
      </div>
    );
  }

  return (
    <div className="plan-page">
      <div className="plan-hero">
        <div>
          <div className="plan-kicker">{formatWindow(plan)}</div>
          <h1 className="plan-title">Weekly checklist</h1>
          <p className="plan-sub">
            Course-by-course steps for the week, grounded in Canvas deadlines and indexed material.
          </p>
        </div>
        <button
          className="send-btn"
          type="button"
          onClick={handleGenerate}
          disabled={generatePlan.isPending || selectedIds.length === 0}
        >
          {plan ? "Regenerate checklist" : "Generate checklist"}
        </button>
      </div>

      <section className="plan-setup">
        <div className="section-head">
          <h3 className="section-title">Courses</h3>
          <div className="plan-course-actions">
            <span className="count-tag">{selectedIds.length} selected</span>
            <button
              className="plan-course-toggle"
              type="button"
              onClick={() => setShowAllCourses((value) => !value)}
            >
              {showAllCourses ? "Show compact list" : "Add/remove courses"}
            </button>
          </div>
        </div>
        {!showAllCourses && hiddenCourseCount > 0 && (
          <div className="plan-course-hint">
            Showing selected and current courses. {hiddenCourseCount} more available.
          </div>
        )}
        <div className="plan-course-grid">
          {visibleCourses.map((course) => {
            const checked = selected.has(course.canvas_course_id);
            return (
              <label
                key={course.canvas_course_id}
                className="plan-course-option"
                data-active={checked}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleCourse(course.canvas_course_id)}
                  aria-label={`${course.name} (${course.status})`}
                />
                <CourseBadge name={course.name} colorSeed={course.id} size={34} />
                <span className="plan-course-text">
                  <span className="plan-course-name">{course.name}</span>
                  <span className="plan-course-meta">
                    {shortCourseCode(course.code) || "No code"} - {course.status}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {visibleCourses.length === 0 && (
          <div className="plan-empty plan-empty-compact">
            No current courses selected. Use Add/remove courses to choose what belongs in this checklist.
          </div>
        )}
      </section>

      {!plan ? (
        <div className="plan-empty">
          Pick the courses you want included, then generate this week's checklist.
        </div>
      ) : (
        <>
          <PlanCourseTabs
            plan={plan}
            activeCanvasCourseId={activePlanCanvasCourseId}
            onSelect={setActivePlanCanvasCourseId}
          />
          <PressurePoints plan={plan} canvasCourseId={activePlanCanvasCourseId} />
          <ActivePlanCourse
            plan={plan}
            activeCanvasCourseId={activePlanCanvasCourseId}
            onToggleTask={(task) =>
              setTaskDone.mutate({ taskId: task.id, done: !task.done })
            }
          />
        </>
      )}
    </div>
  );
}

function PlanCourseTabs({
  plan,
  activeCanvasCourseId,
  onSelect,
}: {
  plan: StudyPlanPayload;
  activeCanvasCourseId: number | null;
  onSelect: (canvasCourseId: number) => void;
}) {
  if (plan.courses.length <= 1) return null;
  const active = activeCanvasCourseId ?? plan.courses[0]?.canvas_course_id ?? null;
  return (
    <div className="plan-tabs" role="tablist" aria-label="Study plan courses">
      {plan.courses.map((course) => (
        <button
          key={course.canvas_course_id}
          className="plan-tab"
          type="button"
          role="tab"
          aria-label={course.name}
          aria-selected={active === course.canvas_course_id}
          data-active={active === course.canvas_course_id}
          onClick={() => onSelect(course.canvas_course_id)}
        >
          <CourseBadge name={course.name} colorSeed={course.id} size={28} />
          <span>
            <strong>{course.name}</strong>
            <span>{course.tasks.length} steps</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function PressurePoints({
  plan,
  canvasCourseId,
}: {
  plan: StudyPlanPayload;
  canvasCourseId: number | null;
}) {
  const pressurePoints = canvasCourseId === null
    ? plan.pressure_points
    : plan.pressure_points.filter((point) => point.canvas_course_id === canvasCourseId);
  if (pressurePoints.length === 0) return null;
  return (
    <section className="plan-pressure">
      <div className="section-head">
        <h3 className="section-title">This Week&apos;s Pressure Points</h3>
        <span className="count-tag">{pressurePoints.length}</span>
      </div>
      <div className="plan-pressure-grid">
        {pressurePoints.map((point) => (
          <div key={point.id} className="plan-pressure-item">
            <div className="plan-priority" data-priority={point.priority}>
              {PRIORITY_LABEL[point.priority]}
            </div>
            <div className="plan-pressure-title">{point.title}</div>
            <div className="plan-pressure-meta">
              {point.course_name} - {formatDue(point.due_at)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ActivePlanCourse({
  plan,
  activeCanvasCourseId,
  onToggleTask,
}: {
  plan: StudyPlanPayload;
  activeCanvasCourseId: number | null;
  onToggleTask: (task: StudyPlanTask) => void;
}) {
  const course =
    plan.courses.find((entry) => entry.canvas_course_id === activeCanvasCourseId) ??
    plan.courses[0] ??
    null;
  if (!course) return null;
  return (
    <div className="plan-course-list">
      <section className="plan-course-section">
        <div className="plan-course-head">
          <CourseBadge name={course.name} colorSeed={course.id} size={42} />
          <div>
            <h2>{course.name}</h2>
            <div>
              {shortCourseCode(course.code) || "No code"} - {course.tasks.length} steps - {course.confidence} confidence
            </div>
          </div>
        </div>
        <div className="plan-task-list">
          {course.tasks.map((task) => (
            <PlanTaskRow
              key={task.id}
              task={task}
              onToggle={() => onToggleTask(task)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function PlanTaskRow({ task, onToggle }: { task: StudyPlanTask; onToggle: () => void }) {
  return (
    <div className="plan-task" data-done={task.done}>
      <Checkbox checked={task.done} onToggle={onToggle} />
      <div className="plan-task-body">
        <div className="plan-task-top">
          <div className="plan-task-title">{task.title}</div>
          <span className="plan-priority" data-priority={task.priority}>
            {PRIORITY_LABEL[task.priority]}
          </span>
        </div>
        <p>{task.detail}</p>
        <div className="plan-task-reason">{task.reason}</div>
        {task.source_refs.length > 0 && (
          <div className="plan-source-row">
            {task.source_refs.map((source, index) => {
              const href = sourceHref(source.url);
              const label = source.label || source.kind;
              return href ? (
                <a
                  key={`${source.kind}-${index}`}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="plan-source-chip"
                >
                  {label}
                </a>
              ) : (
                <span key={`${source.kind}-${index}`} className="plan-source-chip">
                  {label}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
