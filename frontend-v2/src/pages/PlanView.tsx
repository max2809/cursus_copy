import { useMemo } from "react";
import type { BucketKey, CourseDeadlines, Deadline, DeadlineCourse } from "../api/types";
import { useSetDeadlineSubmission } from "../api/queries";
import { Checkbox } from "../components/home/Checkbox";
import { courseColor } from "../components/shell/Sidebar";

interface Props {
  courses: CourseDeadlines[];
}

const BUCKET_LABEL: Record<BucketKey, string> = {
  overdue: "Overdue",
  today: "Today",
  this_week: "This week",
  next_two_weeks: "Next two weeks",
  later: "Later",
  no_due_date: "No due date",
};

const BUCKET_ORDER: BucketKey[] = [
  "overdue",
  "today",
  "this_week",
  "next_two_weeks",
  "later",
  "no_due_date",
];

interface Row {
  deadline: Deadline;
  course: DeadlineCourse;
  courseIndex: number;
  bucket: BucketKey;
}

function aggregate(courses: CourseDeadlines[]): Map<BucketKey, Row[]> {
  const out = new Map<BucketKey, Row[]>();
  for (const k of BUCKET_ORDER) out.set(k, []);
  courses.forEach((c, i) => {
    for (const k of BUCKET_ORDER) {
      for (const d of c.buckets[k] ?? []) {
        out.get(k)!.push({
          deadline: d,
          course: c.course,
          courseIndex: i,
          bucket: k,
        });
      }
    }
  });
  for (const [, rows] of out) {
    rows.sort((a, b) => {
      if (!a.deadline.due_at && !b.deadline.due_at) return 0;
      if (!a.deadline.due_at) return 1;
      if (!b.deadline.due_at) return -1;
      return a.deadline.due_at.localeCompare(b.deadline.due_at);
    });
  }
  return out;
}

function formatDue(iso: string | null): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  return dt.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function PlanView({ courses }: Props) {
  const buckets = useMemo(() => aggregate(courses), [courses]);
  const nonEmpty = BUCKET_ORDER.filter((k) => (buckets.get(k)?.length ?? 0) > 0);
  const setSubmission = useSetDeadlineSubmission();

  return (
    <div style={{ padding: "var(--pad-5) var(--pad-5)", width: "100%", overflowY: "auto", height: "100%" }}>
      <h1
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 44,
          fontStyle: "italic",
          letterSpacing: "-0.02em",
          margin: "0 0 6px",
        }}
      >
        Study plan
      </h1>
      <p style={{ color: "var(--ink-3)", marginTop: 0, marginBottom: "var(--pad-5)" }}>
        Everything coming up across your courses, sorted by urgency.
      </p>

      {nonEmpty.length === 0 ? (
        <div
          style={{
            padding: "var(--pad-5)",
            textAlign: "center",
            border: "1px dashed var(--hair)",
            borderRadius: "var(--r-lg)",
            color: "var(--ink-3)",
          }}
        >
          Nothing scheduled. Hit refresh to sync with Canvas.
        </div>
      ) : (
        nonEmpty.map((k) => (
          <section key={k} style={{ marginBottom: "var(--pad-5)" }}>
            <div className="section-head">
              <h3 className="section-title">{BUCKET_LABEL[k]}</h3>
              <span className="count-tag">{buckets.get(k)!.length}</span>
            </div>
            <div className="upcoming">
              {buckets.get(k)!.map((row) => {
                const color = courseColor(row.course.id, row.courseIndex);
                const due = formatDue(row.deadline.due_at);
                const done = !!row.deadline.submitted;
                return (
                  <div
                    key={row.deadline.id}
                    className="upcoming-item"
                    style={{
                      gridTemplateColumns: "auto 64px 1fr auto auto",
                      textDecoration: "none",
                      color: "inherit",
                      opacity: done ? 0.55 : 1,
                    }}
                  >
                    <Checkbox
                      checked={done}
                      onToggle={() =>
                        setSubmission.mutate({ deadlineId: row.deadline.id, done: !done })
                      }
                    />
                    <div className="upcoming-date">
                      <div
                        className="d"
                        style={{
                          background: color,
                          color: "var(--accent-ink)",
                          borderRadius: 6,
                          width: 28,
                          height: 28,
                          display: "grid",
                          placeItems: "center",
                          fontSize: 14,
                        }}
                      >
                        {row.course.name.charAt(0)}
                      </div>
                      <div className="m" style={{ fontSize: 9 }}>
                        {row.course.code ?? row.course.name.slice(0, 8)}
                      </div>
                    </div>
                    <a
                      href={row.deadline.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="upcoming-body"
                      style={{
                        textDecoration: done ? "line-through" : "none",
                        color: "inherit",
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <div className="title">{row.deadline.title}</div>
                      <div className="sub">
                        {row.course.name}
                        {row.deadline.points_possible != null && (
                          <span> · {row.deadline.points_possible} pts</span>
                        )}
                      </div>
                    </a>
                    <span className="upcoming-type" data-kind={row.deadline.type}>
                      {row.deadline.type}
                    </span>
                    <span className="upcoming-eta">{done ? "done" : due}</span>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
