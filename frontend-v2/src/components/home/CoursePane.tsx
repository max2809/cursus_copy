import { useEffect, useMemo, useState } from "react";
import type { CourseDeadlines, Deadline, MaterialItem } from "../../api/types";
import { listMaterials, deleteMaterial, refreshMaterials } from "../../api/materials";
import { useSetDeadlineSubmission } from "../../api/queries";
import { IconMax, IconRefresh, IconTrash, IconPlus } from "../../design/icons";
import { courseColor } from "../shell/Sidebar";
import { AddMaterialModal } from "../materials/AddMaterialModal";
import { addUrlMaterial, uploadMaterial } from "../../api/materials";
import { Checkbox } from "./Checkbox";

interface Props {
  course: CourseDeadlines;
  courseIndex: number;
  onAskInChat?: (prompt: string) => void;
  onMaximize?: () => void;
  maximized?: boolean;
}

function kindOf(d: Deadline): "quiz" | "exam" | "assignment" | "event" {
  if (d.type === "quiz") return "quiz";
  if (d.type === "exam") return "exam";
  if (d.type === "assignment") return "assignment";
  return "event";
}

function formatDate(iso: string): { d: string; m: string } {
  const dt = new Date(iso);
  const d = String(dt.getDate()).padStart(2, "0");
  const m = dt.toLocaleString("en-US", { month: "short" });
  return { d, m };
}

function etaFromNow(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const mins = Math.round((t - now) / 60000);
  if (mins < 0) return `${Math.abs(Math.round(mins / 60))}h overdue`;
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

function flattenUpcoming(course: CourseDeadlines): Deadline[] {
  const order = ["overdue", "today", "this_week", "next_two_weeks", "later"] as const;
  const out: Deadline[] = [];
  for (const k of order) {
    for (const d of course.buckets[k] ?? []) {
      out.push(d);
    }
  }
  // Pending first, submitted after — within each group, the buckets preserve urgency order.
  return out.sort((a, b) => Number(!!a.submitted) - Number(!!b.submitted));
}

const MAT_FILTERS = ["All", "Canvas", "Uploads", "Links"] as const;
type MatFilter = (typeof MAT_FILTERS)[number];

function materialKind(m: MaterialItem): Exclude<MatFilter, "All"> {
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
  const t = new Date(iso);
  return t.toLocaleString("en-US", { month: "short", day: "2-digit" });
}

export function CoursePane({
  course,
  courseIndex,
  onAskInChat,
  onMaximize,
  maximized,
}: Props) {
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [filter, setFilter] = useState<MatFilter>("All");
  const [addOpen, setAddOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const setSubmission = useSetDeadlineSubmission();
  const canvasId = course.course.canvas_course_id;

  async function reload() {
    const r = await listMaterials(canvasId);
    setMaterials(r.materials);
  }

  useEffect(() => {
    reload();
  }, [canvasId]);

  useEffect(() => {
    const pending = materials.some((m) => m.indexed_at === null && m.index_error === null);
    if (!pending) return;
    const id = setInterval(reload, 5000);
    return () => clearInterval(id);
  }, [materials.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const r = await refreshMaterials(canvasId);
      setMaterials(r.materials);
    } finally {
      setRefreshing(false);
    }
  }

  const upcoming = useMemo(() => flattenUpcoming(course).slice(0, 6), [course]);
  const filteredMaterials = useMemo(() => {
    if (filter === "All") return materials;
    return materials.filter((m) => materialKind(m) === filter);
  }, [materials, filter]);

  const color = courseColor(course.course.id, courseIndex);

  return (
    <div className="course-pane">
      <div className="course-head">
        <div className="course-glyph" style={{ background: color }}>
          {course.course.name.charAt(0)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="course-title">{course.course.name}</h1>
          <div className="course-meta">
            {course.course.code && <span className="code-pill">{course.course.code}</span>}
            <span>{course.pending_count} pending</span>
            <span className="dotsep" />
            <span>
              {materials.length} material{materials.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        {onMaximize && (
          <button
            className="iconbtn"
            title={maximized ? "Restore" : "Focus chat"}
            onClick={onMaximize}
            type="button"
          >
            <IconMax />
          </button>
        )}
      </div>

      <div className="section-head">
        <h3 className="section-title">Upcoming</h3>
      </div>
      <div className="upcoming">
        {upcoming.length === 0 ? (
          <div
            style={{
              padding: "var(--pad-4)",
              textAlign: "center",
              color: "var(--ink-3)",
              fontSize: 13,
              border: "1px dashed var(--hair)",
              borderRadius: "var(--r-md)",
            }}
          >
            Nothing pending.
          </div>
        ) : (
          upcoming.map((d) => {
            const kind = kindOf(d);
            const parts = d.due_at ? formatDate(d.due_at) : { d: "—", m: "" };
            const eta = d.due_at ? etaFromNow(d.due_at) : "no due date";
            const done = !!d.submitted;
            return (
              <div
                key={d.id}
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
                    setSubmission.mutate({ deadlineId: d.id, done: !d.submitted })
                  }
                />
                <div className="upcoming-date">
                  <div className="d">{parts.d}</div>
                  <div className="m">{parts.m}</div>
                </div>
                <a
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="upcoming-body"
                  style={{ textDecoration: "none", color: "inherit", minWidth: 0 }}
                >
                  <div
                    className="title"
                    style={{ textDecoration: done ? "line-through" : "none" }}
                  >
                    {d.title}
                  </div>
                  <div className="sub">
                    {d.points_possible != null ? `${d.points_possible} pts` : kind}
                    {d.manually_submitted && !d.submitted ? " · marked done" : null}
                  </div>
                </a>
                <span className="upcoming-type" data-kind={kind}>
                  {kind}
                </span>
                <span className="upcoming-eta">{done ? "done" : eta}</span>
              </div>
            );
          })
        )}
      </div>

      <div className="section-head">
        <h3 className="section-title">
          Course materials <span className="count-tag">{filteredMaterials.length}</span>
        </h3>
        <div className="mat-tools">
          <div className="mat-filters">
            {MAT_FILTERS.map((f) => (
              <button
                key={f}
                className="mat-filter"
                data-active={filter === f}
                onClick={() => setFilter(f)}
                type="button"
              >
                {f}
              </button>
            ))}
          </div>
          <button
            className="iconbtn"
            title="Download all Canvas files as zip"
            onClick={async () => {
              if (downloading) return;
              setDownloading(true);
              try {
                const base =
                  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
                  "http://localhost:8000";
                const resp = await fetch(
                  `${base}/api/courses/${canvasId}/materials/download`,
                  { credentials: "include" },
                );
                if (!resp.ok) {
                  const text = await resp.text().catch(() => "");
                  alert(`Download failed (${resp.status}): ${text || resp.statusText}`);
                  return;
                }
                const blob = await resp.blob();
                const cd = resp.headers.get("content-disposition") ?? "";
                const match = cd.match(/filename="?([^"]+)"?/i);
                const filename = match?.[1] ?? `${course.course.name}.zip`;
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
              } catch (err) {
                alert(`Download error: ${err}`);
              } finally {
                setDownloading(false);
              }
            }}
            disabled={downloading}
            type="button"
          >
            {downloading ? (
              <span style={{ fontSize: 11 }}>…</span>
            ) : (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10" />
              </svg>
            )}
          </button>
          <button
            className="iconbtn"
            title="Refresh"
            onClick={handleRefresh}
            disabled={refreshing}
            type="button"
          >
            <IconRefresh />
          </button>
          <button
            className="iconbtn"
            title="Add material"
            onClick={() => setAddOpen(true)}
            type="button"
          >
            <IconPlus />
          </button>
        </div>
      </div>
      <div className="mat-list">
        {filteredMaterials.length === 0 ? (
          <div
            style={{
              padding: "var(--pad-4)",
              textAlign: "center",
              color: "var(--ink-3)",
              fontSize: 13,
              border: "1px dashed var(--hair)",
              borderRadius: "var(--r-md)",
            }}
          >
            No materials in this filter.
          </div>
        ) : (
          filteredMaterials.map((m) => {
            const ext = extension(m.filename);
            const tag = materialKind(m);
            const indexed = m.indexed_at != null;
            const errored = m.index_error != null;
            return (
              <div
                key={m.id}
                className="mat-row"
                onClick={() => onAskInChat?.(`Summarize ${m.filename}`)}
                role="button"
                tabIndex={0}
              >
                <span className="mat-type" data-kind={tag.toLowerCase()}>
                  {ext}
                </span>
                <span className="mat-title">{m.filename}</span>
                <span className="mat-tag">{tag}</span>
                <span className="mat-size">{formatBytes(m.size_bytes)}</span>
                <span className="mat-added">{relativeDate(m.updated_at)}</span>
                <span
                  className="mat-ingested"
                  title={
                    errored
                      ? `Index error: ${m.index_error}`
                      : indexed
                        ? "Indexed & ready for chat"
                        : "Indexing…"
                  }
                  style={{
                    color: errored
                      ? "var(--ink-4)"
                      : indexed
                        ? "var(--accent)"
                        : "var(--ink-4)",
                    opacity: indexed ? 1 : 0.5,
                  }}
                >
                  ●
                </span>
                {m.source === "canvas" ? (
                  <button
                    className="iconbtn"
                    title={`Download ${m.filename}`}
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const base =
                        (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
                        "http://localhost:8000";
                      try {
                        const resp = await fetch(
                          `${base}/api/courses/${canvasId}/materials/${m.id}/download`,
                          { credentials: "include" },
                        );
                        if (!resp.ok) {
                          alert(`Download failed (${resp.status})`);
                          return;
                        }
                        const blob = await resp.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = m.filename;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(url);
                      } catch (err) {
                        alert(`Download error: ${err}`);
                      }
                    }}
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
                      <path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10" />
                    </svg>
                  </button>
                ) : null}
                {m.source === "upload" || m.source === "url" ? (
                  <button
                    className="iconbtn"
                    title="Delete"
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm(`Delete ${m.filename}?`)) return;
                      await deleteMaterial(canvasId, m.id);
                      await reload();
                    }}
                  >
                    <IconTrash />
                  </button>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <AddMaterialModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onFile={async (f: File) => {
          await uploadMaterial(canvasId, f);
          await reload();
        }}
        onUrl={async (u: string) => {
          await addUrlMaterial(canvasId, u);
          await reload();
        }}
      />
    </div>
  );
}
