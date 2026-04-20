import { useEffect, useMemo, useState } from "react";
import { listMaterials } from "../api/materials";
import type { CourseDeadlines, MaterialItem } from "../api/types";
import { courseColor } from "../lib/course";

interface Props {
  courses: CourseDeadlines[];
}

interface Row {
  material: MaterialItem;
  courseName: string;
  courseCode: string | null;
  courseColor: string;
}

const FILTERS = ["All", "Canvas", "Uploads", "Links"] as const;
type Filter = (typeof FILTERS)[number];

function kindOf(m: MaterialItem): Exclude<Filter, "All"> {
  if (m.source === "upload") return "Uploads";
  if (m.source === "url") return "Links";
  return "Canvas";
}

function extension(filename: string): string {
  const i = filename.lastIndexOf(".");
  if (i <= 0) return "DOC";
  return filename.slice(i + 1).toUpperCase();
}

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n}b`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}kb`;
  return `${(n / (1024 * 1024)).toFixed(1)}mb`;
}

function relativeDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "2-digit" });
}

export function LibraryView({ courses }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(
      courses.map(async (c) => {
        try {
          const r = await listMaterials(c.course.canvas_course_id);
          return r.materials.map((m): Row => ({
            material: m,
            courseName: c.course.name,
            courseCode: c.course.code,
            courseColor: courseColor(c.course.id),
          }));
        } catch {
          return [] as Row[];
        }
      })
    ).then((all) => {
      if (cancelled) return;
      const flat = all.flat();
      flat.sort((a, b) => {
        const ta = a.material.updated_at ?? "";
        const tb = b.material.updated_at ?? "";
        return tb.localeCompare(ta);
      });
      setRows(flat);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [courses]);

  const filtered = useMemo(() => {
    let out = rows;
    if (filter !== "All") out = out.filter((r) => kindOf(r.material) === filter);
    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter(
        (r) =>
          r.material.filename.toLowerCase().includes(q) ||
          r.courseName.toLowerCase().includes(q)
      );
    }
    return out;
  }, [rows, filter, query]);

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
        Library
      </h1>
      <p style={{ color: "var(--ink-3)", marginTop: 0, marginBottom: "var(--pad-4)" }}>
        All materials indexed across your courses.
      </p>

      <div
        style={{
          display: "flex",
          gap: "var(--pad-2)",
          marginBottom: "var(--pad-3)",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div className="mat-filters">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className="mat-filter"
              data-active={filter === f}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          style={{
            flex: 1,
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

      {loading ? (
        <div style={{ color: "var(--ink-3)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
          Loading materials…
        </div>
      ) : filtered.length === 0 ? (
        <div
          style={{
            padding: "var(--pad-5)",
            textAlign: "center",
            border: "1px dashed var(--hair)",
            borderRadius: "var(--r-lg)",
            color: "var(--ink-3)",
          }}
        >
          No materials match.
        </div>
      ) : (
        <div className="mat-list">
          {filtered.map((r) => {
            const m = r.material;
            const tag = kindOf(m);
            const ext = extension(m.filename);
            const indexed = m.indexed_at != null;
            return (
              <div key={m.id} className="mat-row">
                <span className="mat-type" data-kind={tag.toLowerCase()}>
                  {ext}
                </span>
                <span className="mat-title">{m.filename}</span>
                <span
                  className="mat-tag"
                  style={{
                    background: r.courseColor,
                    color: "var(--accent-ink)",
                    borderColor: "transparent",
                  }}
                >
                  {r.courseCode ?? r.courseName}
                </span>
                <span className="mat-size">{formatBytes(m.size_bytes)}</span>
                <span className="mat-added">{relativeDate(m.updated_at)}</span>
                <span
                  className="mat-ingested"
                  title={indexed ? "Indexed" : "Indexing…"}
                  style={{ color: indexed ? "var(--accent)" : "var(--ink-4)" }}
                >
                  ●
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
