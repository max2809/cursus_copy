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
  const availableCourses = data?.available_courses ?? fallbackCourses(courses);
  const plan = data?.plan ?? null;
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const selectedKey = (data?.selected_canvas_course_ids ?? [])
    .slice()
    .sort((a, b) => a - b)
    .join(",");

  useEffect(() => {
    if (!data) return;
    setSelected(new Set(data.selected_canvas_course_ids));
  }, [data, selectedKey]);

  const selectedIds = useMemo(
    () => availableCourses
      .filter((course) => selected.has(course.canvas_course_id))
      .map((course) => course.canvas_course_id),
    [availableCourses, selected],
  );

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
          <span className="count-tag">{selectedIds.length} selected</span>
        </div>
        <div className="plan-course-grid">
          {availableCourses.map((course) => {
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
      </section>

      {!plan ? (
        <div className="plan-empty">
          Pick the courses you want included, then generate this week's checklist.
        </div>
      ) : (
        <>
          <PressurePoints plan={plan} />
          <div className="plan-course-list">
            {plan.courses.map((course) => (
              <section key={course.canvas_course_id} className="plan-course-section">
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
                      onToggle={() =>
                        setTaskDone.mutate({ taskId: task.id, done: !task.done })
                      }
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PressurePoints({ plan }: { plan: StudyPlanPayload }) {
  if (plan.pressure_points.length === 0) return null;
  return (
    <section className="plan-pressure">
      <div className="section-head">
        <h3 className="section-title">This Week&apos;s Pressure Points</h3>
        <span className="count-tag">{plan.pressure_points.length}</span>
      </div>
      <div className="plan-pressure-grid">
        {plan.pressure_points.map((point) => (
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
