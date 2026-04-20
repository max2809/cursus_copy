import { useEffect, useMemo, useState } from "react";
import type { CourseStatus, CourseSummary } from "../api/types";
import { useCourses, useUpdateCourseStatus } from "../api/queries";
import { courseColor } from "../components/shell/Sidebar";

const STATUS_LABEL: Record<CourseStatus, string> = {
  taking: "Currently taking",
  taken: "Already taken",
  hidden: "Hidden",
};

const STATUS_ORDER: CourseStatus[] = ["taking", "taken", "hidden"];

// Per-status color tokens used on the pill toggles + count summary.
// taking  = accent (Erasmus green); taken = warm orange; hidden = muted.
interface StatusTokens {
  fg: string;
  bg: string;
  border: string;
}
const STATUS_TOKENS: Record<CourseStatus, StatusTokens> = {
  taking: {
    fg: "var(--accent)",
    bg: "var(--accent-soft)",
    border: "var(--accent)",
  },
  taken: {
    fg: "oklch(55% 0.14 50)",
    bg: "oklch(95% 0.04 50)",
    border: "oklch(70% 0.14 50)",
  },
  hidden: {
    fg: "var(--ink-2)",
    bg: "var(--bg-sunken)",
    border: "var(--hair-2)",
  },
};

const EXIT_MS = 260;

export function CoursesView() {
  const { data, isLoading, error } = useCourses();
  const updateStatus = useUpdateCourseStatus();
  const [query, setQuery] = useState("");
  // course.id → status it's leaving FROM. Only the row rendered under that
  // section gets the animation; once the refetch lands and the course moves
  // to its new section, the entry is stale and ignored by the render.
  const [leaving, setLeaving] = useState<Map<string, CourseStatus>>(new Map());

  function requestChange(c: CourseSummary, next: CourseStatus) {
    if (c.status === next) return;
    const from = c.status;
    setLeaving((prev) => new Map(prev).set(c.id, from));
    window.setTimeout(() => {
      updateStatus.mutate({ canvasCourseId: c.canvas_course_id, status: next });
    }, EXIT_MS);
  }

  // Sweep stale leaving marks after the refetch lands. A row is "stale" once
  // its current status in the data no longer matches the from-status it was
  // leaving — i.e. the course has moved to its new section and there is
  // nothing left to animate. Happens a tick after data changes so the
  // "match" render has already committed.
  useEffect(() => {
    if (!data || leaving.size === 0) return;
    setLeaving((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [id, from] of prev) {
        const c = data.find((x) => x.id === id);
        if (!c || c.status !== from) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [data, leaving]);

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
      <style>{`
        @keyframes course-row-leave {
          0%   { opacity: 1; transform: translateY(0); max-height: 80px; }
          100% { opacity: 0; transform: translateY(24px); max-height: 0; border-bottom-width: 0; padding-top: 0; padding-bottom: 0; }
        }
        .course-row-leaving {
          animation: course-row-leave ${EXIT_MS}ms cubic-bezier(.4,0,.2,1) forwards;
          overflow: hidden;
          pointer-events: none;
        }
      `}</style>

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
          <strong style={{ color: STATUS_TOKENS.taking.fg }}>{counts.taking}</strong>{" "}
          taking
        </span>
        <span>·</span>
        <span>
          <strong style={{ color: STATUS_TOKENS.taken.fg }}>{counts.taken}</strong>{" "}
          taken
        </span>
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
                      leaving={leaving.has(c.id)}
                      onChange={(next) => requestChange(c, next)}
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
  leaving: boolean;
  onChange: (next: CourseStatus) => void;
}

function CourseRow({ course, color, isLast, leaving, onChange }: RowProps) {
  return (
    <div
      className={leaving ? "course-row-leaving" : undefined}
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
        {STATUS_ORDER.map((s) => {
          const active = course.status === s;
          const tok = STATUS_TOKENS[s];
          return (
            <button
              key={s}
              type="button"
              onClick={() => onChange(s)}
              title={STATUS_LABEL[s]}
              style={{
                padding: "5px 12px",
                border: `1px solid ${active ? tok.border : "var(--hair)"}`,
                background: active ? tok.bg : "transparent",
                color: active ? tok.fg : "var(--ink-3)",
                fontSize: 11,
                fontWeight: active ? 600 : 500,
                letterSpacing: "0.02em",
                borderRadius: "var(--r-pill)",
                cursor: "pointer",
                textTransform: "capitalize",
                transition: "all var(--fast)",
              }}
            >
              {s}
            </button>
          );
        })}
      </div>
    </div>
  );
}
