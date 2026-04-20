import { useMemo, useState } from "react";
import type { CourseStatus, CourseSummary } from "../api/types";
import { useCourses, useUpdateCourseStatus } from "../api/queries";
import { courseColor } from "../components/shell/Sidebar";

const STATUS_LABEL: Record<CourseStatus, string> = {
  taking: "Currently taking",
  taken: "Already taken",
  hidden: "Hidden",
};

const STATUS_ORDER: CourseStatus[] = ["taking", "taken", "hidden"];

export function CoursesView() {
  const { data, isLoading, error } = useCourses();
  const updateStatus = useUpdateCourseStatus();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = data ?? [];
    return q
      ? list.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            (c.code ?? "").toLowerCase().includes(q),
        )
      : list;
  }, [data, query]);

  const grouped = useMemo(() => {
    const g: Record<CourseStatus, CourseSummary[]> = {
      taking: [],
      taken: [],
      hidden: [],
    };
    filtered.forEach((c) => g[c.status].push(c));
    for (const s of STATUS_ORDER) {
      g[s].sort((a, b) => a.name.localeCompare(b.name));
    }
    return g;
  }, [filtered]);

  const counts: Record<CourseStatus, number> = {
    taking: (data ?? []).filter((c) => c.status === "taking").length,
    taken: (data ?? []).filter((c) => c.status === "taken").length,
    hidden: (data ?? []).filter((c) => c.status === "hidden").length,
  };

  return (
    <div
      style={{
        padding: "var(--pad-5) var(--pad-5)",
        width: "100%",
        overflowY: "auto",
        height: "100%",
      }}
    >
      <h1
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 44,
          fontStyle: "italic",
          letterSpacing: "-0.02em",
          margin: "0 0 6px",
        }}
      >
        All courses
      </h1>
      <p style={{ color: "var(--ink-3)", marginTop: 0, marginBottom: "var(--pad-4)" }}>
        Every Canvas course tied to your account. Currently-taking courses sync +
        index and appear in the sidebar. Already-taken courses stay chat-searchable
        but don't re-sync. Hidden ones are skipped everywhere.
      </p>

      <div
        style={{
          display: "flex",
          gap: "var(--pad-3)",
          marginBottom: "var(--pad-4)",
          alignItems: "center",
          flexWrap: "wrap",
          fontSize: 12,
          color: "var(--ink-3)",
          fontFamily: "var(--font-mono)",
        }}
      >
        <span>
          <strong style={{ color: "var(--accent)" }}>{counts.taking}</strong> taking
        </span>
        <span>·</span>
        <span>{counts.taken} taken</span>
        <span>·</span>
        <span>{counts.hidden} hidden</span>
        <div style={{ flex: 1 }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          style={{
            minWidth: 180,
            padding: "6px 12px",
            border: "1px solid var(--hair)",
            borderRadius: "var(--r-pill)",
            background: "var(--bg-elev)",
            color: "var(--ink)",
            fontSize: 13,
            outline: "none",
          }}
        />
      </div>

      {isLoading && (
        <div style={{ color: "var(--ink-3)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
          Loading courses…
        </div>
      )}
      {error && (
        <div style={{ color: "var(--ink-3)" }}>Couldn't load courses: {String(error)}</div>
      )}

      {!isLoading && !error && (
        <>
          {STATUS_ORDER.map((status) => {
            const rows = grouped[status];
            if (rows.length === 0) return null;
            return (
              <section key={status} style={{ marginBottom: "var(--pad-5)" }}>
                <div
                  className="nav-section-label"
                  style={{ marginBottom: 8, padding: 0 }}
                >
                  {STATUS_LABEL[status]} ({rows.length})
                </div>
                <div
                  style={{
                    border: "1px solid var(--hair)",
                    borderRadius: "var(--r-lg)",
                    overflow: "hidden",
                    background: "var(--bg-elev)",
                  }}
                >
                  {rows.map((c, i) => (
                    <CourseRow
                      key={c.id}
                      course={c}
                      color={courseColor(c.id, i)}
                      isLast={i === rows.length - 1}
                      onChange={(next) =>
                        updateStatus.mutate({
                          canvasCourseId: c.canvas_course_id,
                          status: next,
                        })
                      }
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {filtered.length === 0 && (data?.length ?? 0) > 0 && (
            <div
              style={{
                padding: "var(--pad-5)",
                textAlign: "center",
                border: "1px dashed var(--hair)",
                borderRadius: "var(--r-lg)",
                color: "var(--ink-3)",
              }}
            >
              No courses match "{query}".
            </div>
          )}
          {(data?.length ?? 0) === 0 && (
            <div
              style={{
                padding: "var(--pad-5)",
                textAlign: "center",
                border: "1px dashed var(--hair)",
                borderRadius: "var(--r-lg)",
                color: "var(--ink-3)",
              }}
            >
              No courses synced yet. Hit refresh after connecting your Canvas token.
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface RowProps {
  course: CourseSummary;
  color: string;
  isLast: boolean;
  onChange: (next: CourseStatus) => void;
}

function CourseRow({ course, color, isLast, onChange }: RowProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        alignItems: "center",
        gap: "var(--pad-3)",
        padding: "12px var(--pad-4)",
        borderBottom: isLast ? "none" : "1px solid var(--hair)",
        opacity: course.status === "hidden" ? 0.55 : 1,
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 3,
          background: color,
          flexShrink: 0,
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--ink)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {course.name}
        </div>
        {course.code && (
          <div
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              fontFamily: "var(--font-mono)",
              marginTop: 2,
            }}
          >
            {course.code}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {STATUS_ORDER.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            title={STATUS_LABEL[s]}
            style={{
              padding: "5px 12px",
              border: `1px solid ${course.status === s ? "var(--accent)" : "var(--hair)"}`,
              background:
                course.status === s ? "var(--accent-soft)" : "transparent",
              color: course.status === s ? "var(--accent)" : "var(--ink-3)",
              fontSize: 11,
              fontWeight: course.status === s ? 600 : 500,
              letterSpacing: "0.02em",
              borderRadius: "var(--r-pill)",
              cursor: "pointer",
              textTransform: "capitalize",
              transition: "all var(--fast)",
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
