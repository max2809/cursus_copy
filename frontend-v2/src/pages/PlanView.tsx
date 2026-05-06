import { useEffect, useMemo, useState } from "react";
import type {
  CourseDeadlines,
  CourseSummary,
  StudyPlanCourse,
  StudyPlanPayload,
  StudyPlanPressurePoint,
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

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function countSteps(plan: StudyPlanPayload | null): number {
  return plan?.courses.reduce((sum, course) => sum + course.tasks.length, 0) ?? 0;
}

function countCompleted(course: StudyPlanCourse): number {
  return course.tasks.filter((task) => task.done).length;
}

function coursePressurePoints(
  plan: StudyPlanPayload,
  canvasCourseId: number,
): StudyPlanPressurePoint[] {
  return plan.pressure_points.filter((point) => point.canvas_course_id === canvasCourseId);
}

function courseSearchText(course: CourseSummary): string {
  return `${course.name} ${course.code ?? ""} ${course.status}`.toLowerCase();
}

export function PlanView({ courses }: Props) {
  const { data, isLoading, error } = useStudyPlan();
  const generatePlan = useGenerateStudyPlan();
  const setTaskDone = useSetStudyPlanTaskDone();
  const [editingCourses, setEditingCourses] = useState(false);
  const [courseSearch, setCourseSearch] = useState("");
  const [expandedCourses, setExpandedCourses] = useState<Set<number>>(new Set());
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
  const selectedKey = (data?.selected_canvas_course_ids ?? [])
    .slice()
    .sort((a, b) => a - b)
    .join(",");

  useEffect(() => {
    if (!data) return;
    setSelected(new Set(data.selected_canvas_course_ids));
  }, [data, selectedKey]);

  const selectedIds = useMemo(
    () =>
      availableCourses
        .filter((course) => selected.has(course.canvas_course_id))
        .map((course) => course.canvas_course_id),
    [availableCourses, selected],
  );
  const selectedCourses = useMemo(
    () => availableCourses.filter((course) => selected.has(course.canvas_course_id)),
    [availableCourses, selected],
  );
  const filteredEditCourses = useMemo(() => {
    const query = courseSearch.trim().toLowerCase();
    if (!query) return availableCourses;
    return availableCourses.filter((course) => courseSearchText(course).includes(query));
  }, [availableCourses, courseSearch]);

  function toggleCourse(canvasCourseId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(canvasCourseId)) next.delete(canvasCourseId);
      else next.add(canvasCourseId);
      return next;
    });
  }

  function toggleExpanded(canvasCourseId: number) {
    setExpandedCourses((prev) => {
      const next = new Set(prev);
      if (next.has(canvasCourseId)) next.delete(canvasCourseId);
      else next.add(canvasCourseId);
      return next;
    });
  }

  async function handleGenerate() {
    if (selectedIds.length === 0) return;
    await generatePlan.mutateAsync({ selectedCanvasCourseIds: selectedIds });
    setEditingCourses(false);
  }

  if (isLoading && !data) {
    return <div className="plan-page"><div className="plan-empty">Loading weekly path...</div></div>;
  }

  if (error) {
    return (
      <div className="plan-page">
        <div className="plan-empty">Could not load the weekly path.</div>
      </div>
    );
  }

  return (
    <div className="plan-page">
      <div className="plan-hero">
        <div>
          <div className="plan-kicker">{formatWindow(plan)}</div>
          <h1 className="plan-title">Weekly learning path</h1>
          <p className="plan-sub">
            {plan
              ? `${plural(plan.courses.length, "course")} - ${plural(countSteps(plan), "step")} - ${plural(plan.pressure_points.length, "deadline")}`
              : "Build a weekly path from your Canvas deadlines and indexed material."}
          </p>
        </div>
        <div className="plan-actions">
          <button
            className={plan ? "plan-secondary-action" : "send-btn"}
            type="button"
            onClick={handleGenerate}
            disabled={generatePlan.isPending || selectedIds.length === 0}
          >
            {plan ? "Regenerate" : "Generate path"}
          </button>
          <button
            className="plan-secondary-action"
            type="button"
            onClick={() => setEditingCourses((value) => !value)}
          >
            {editingCourses ? "Close courses" : "Edit courses"}
          </button>
        </div>
      </div>

      {editingCourses && (
        <CourseEditPanel
          courses={filteredEditCourses}
          courseSearch={courseSearch}
          selected={selected}
          selectedCount={selectedIds.length}
          onCourseSearch={setCourseSearch}
          onToggleCourse={toggleCourse}
          onUpdate={handleGenerate}
          updating={generatePlan.isPending}
        />
      )}

      {!plan ? (
        <div className="plan-empty">
          <h2>Generate this week's path</h2>
          <p>
            Cursus will use your selected courses, Canvas deadlines, and indexed
            material to create a weekly learning path.
          </p>
          {selectedCourses.length > 0 && (
            <div className="plan-selected-summary">
              Selected: {selectedCourses.map((course) => course.name).join(", ")}
            </div>
          )}
        </div>
      ) : (
        <PlanPath
          plan={plan}
          expandedCourses={expandedCourses}
          onToggleCourse={toggleExpanded}
          onToggleTask={(task) =>
            setTaskDone.mutate({ taskId: task.id, done: !task.done })
          }
        />
      )}
    </div>
  );
}

function CourseEditPanel({
  courses,
  courseSearch,
  selected,
  selectedCount,
  onCourseSearch,
  onToggleCourse,
  onUpdate,
  updating,
}: {
  courses: CourseSummary[];
  courseSearch: string;
  selected: Set<number>;
  selectedCount: number;
  onCourseSearch: (value: string) => void;
  onToggleCourse: (canvasCourseId: number) => void;
  onUpdate: () => void;
  updating: boolean;
}) {
  return (
    <section className="plan-edit-panel" aria-label="Edit courses">
      <div className="section-head">
        <h3 className="section-title">Edit courses</h3>
        <span className="count-tag">{selectedCount} selected</span>
      </div>
      <div className="plan-edit-controls">
        <input
          className="mock-input plan-course-search"
          value={courseSearch}
          onChange={(event) => onCourseSearch(event.target.value)}
          placeholder="Search courses"
          type="search"
        />
        <button
          className="send-btn"
          type="button"
          onClick={onUpdate}
          disabled={updating || selectedCount === 0}
        >
          Update path
        </button>
      </div>
      <div className="plan-course-grid">
        {courses.map((course) => {
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
                onChange={() => onToggleCourse(course.canvas_course_id)}
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
      {courses.length === 0 && (
        <div className="plan-empty plan-empty-compact">No courses match this search.</div>
      )}
    </section>
  );
}

function PlanPath({
  plan,
  expandedCourses,
  onToggleCourse,
  onToggleTask,
}: {
  plan: StudyPlanPayload;
  expandedCourses: Set<number>;
  onToggleCourse: (canvasCourseId: number) => void;
  onToggleTask: (task: StudyPlanTask) => void;
}) {
  return (
    <div className="plan-path">
      {plan.courses.map((course) => (
        <PlanCourseSection
          key={course.canvas_course_id}
          course={course}
          pressurePoints={coursePressurePoints(plan, course.canvas_course_id)}
          expanded={expandedCourses.has(course.canvas_course_id)}
          onToggleCourse={() => onToggleCourse(course.canvas_course_id)}
          onToggleTask={onToggleTask}
        />
      ))}
    </div>
  );
}

function PlanCourseSection({
  course,
  pressurePoints,
  expanded,
  onToggleCourse,
  onToggleTask,
}: {
  course: StudyPlanCourse;
  pressurePoints: StudyPlanPressurePoint[];
  expanded: boolean;
  onToggleCourse: () => void;
  onToggleTask: (task: StudyPlanTask) => void;
}) {
  const visibleTasks = expanded ? course.tasks : course.tasks.slice(0, 2);
  const hiddenTaskCount = course.tasks.length - visibleTasks.length;
  const hasSources = course.tasks.some((task) => task.source_refs.length > 0);
  const canExpand = hiddenTaskCount > 0 || hasSources;
  const completed = countCompleted(course);

  return (
    <section className="plan-path-course">
      <div className="plan-path-course-head">
        <CourseBadge name={course.name} colorSeed={course.id} size={42} />
        <div className="plan-path-heading">
          <h2>{course.name}</h2>
          <div className="plan-path-summary">
            {shortCourseCode(course.code) || "No code"} - {completed}/{course.tasks.length} done - {plural(pressurePoints.length, "deadline")}
          </div>
        </div>
        {canExpand && (
          <button
            className="plan-expand"
            type="button"
            onClick={onToggleCourse}
            aria-expanded={expanded}
          >
            {expanded ? `Collapse ${course.name}` : `Expand ${course.name}`}
          </button>
        )}
      </div>

      {pressurePoints.length > 0 && (
        <div className="plan-pressure-inline" aria-label={`${course.name} deadlines`}>
          {pressurePoints.map((point) => (
            <div key={point.id} className="plan-pressure-inline-item">
              <span className="plan-priority" data-priority={point.priority}>
                {PRIORITY_LABEL[point.priority]}
              </span>
              <span>{point.title}</span>
              <span>{formatDue(point.due_at)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="plan-path-preview">
        {visibleTasks.map((task) => (
          <PlanTaskRow
            key={task.id}
            task={task}
            showSources={expanded}
            onToggle={() => onToggleTask(task)}
          />
        ))}
      </div>

      {!expanded && hiddenTaskCount > 0 && (
        <div className="plan-hidden-count">
          {hiddenTaskCount} more step{hiddenTaskCount === 1 ? "" : "s"} in this course.
        </div>
      )}
    </section>
  );
}

function PlanTaskRow({
  task,
  showSources,
  onToggle,
}: {
  task: StudyPlanTask;
  showSources: boolean;
  onToggle: () => void;
}) {
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
        {showSources && <div className="plan-task-reason">{task.reason}</div>}
        {showSources && task.source_refs.length > 0 && (
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
