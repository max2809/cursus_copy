import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { CourseDeadlines, CourseStatus, CourseSummary } from "../../api/types";
import {
  IconChat,
  IconEllipsis,
  IconHome,
  IconLibrary,
  IconPlan,
} from "../../design/icons";

export type NavKey = "home" | "chat" | "plan" | "library" | "courses";

interface Props {
  activeNav: NavKey;
  onNav: (n: NavKey) => void;
  courses: CourseDeadlines[];
  allCourses?: CourseSummary[];
  activeCourseId: string | null;
  onCourseSelect: (id: string) => void;
  onCourseStatusChange?: (canvasCourseId: number, status: CourseStatus) => void;
  userEmail?: string;
}

const COURSE_COLORS = [
  "oklch(72% 0.14 285)",
  "oklch(70% 0.14 30)",
  "oklch(68% 0.13 195)",
  "oklch(70% 0.12 150)",
  "oklch(72% 0.13 60)",
  "oklch(68% 0.13 340)",
];

function courseColor(_id: string, i: number): string {
  return COURSE_COLORS[i % COURSE_COLORS.length];
}

function initialsFrom(email?: string): string {
  if (!email) return "U";
  const name = email.split("@")[0];
  const parts = name.split(/[._-]+/).filter(Boolean);
  const take = (s: string) => s.charAt(0).toUpperCase();
  if (parts.length >= 2) return take(parts[0]) + take(parts[1]);
  return take(name) + (name.charAt(1) ?? "").toUpperCase();
}

export function Sidebar({
  activeNav,
  onNav,
  courses,
  allCourses,
  activeCourseId,
  onCourseSelect,
  onCourseStatusChange,
  userEmail,
}: Props) {
  const navItems: { id: NavKey; label: string; Icon: (p: any) => JSX.Element }[] = [
    { id: "home", label: "Home", Icon: IconHome },
    { id: "chat", label: "Ask Cursus", Icon: IconChat },
    { id: "plan", label: "Study plan", Icon: IconPlan },
    { id: "library", label: "Library", Icon: IconLibrary },
  ];
  const initials = initialsFrom(userEmail);

  // Map from course.id → status so we can split taking vs taken cleanly.
  const statusById = useMemo(() => {
    const m = new Map<number, CourseStatus>();
    (allCourses ?? []).forEach((c) => m.set(c.canvas_course_id, c.status));
    return m;
  }, [allCourses]);

  // Split into taking / taken buckets. Each bucket is alphabetised so
  // within-bucket order doesn't mix taking + taken (fixes "taken course
  // shows up above a currently-taking course").
  const { takingCourses, takenCourses } = useMemo(() => {
    const taking: CourseDeadlines[] = [];
    const taken: CourseDeadlines[] = [];
    for (const c of courses) {
      const s = statusById.get(c.course.canvas_course_id) ?? "taking";
      if (s === "taken") taken.push(c);
      else taking.push(c);
    }
    const byName = (a: CourseDeadlines, b: CourseDeadlines) =>
      a.course.name.localeCompare(b.course.name);
    taking.sort(byName);
    taken.sort(byName);
    return { takingCourses: taking, takenCourses: taken };
  }, [courses, statusById]);

  const [showTaken, setShowTaken] = useState(false);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">C</div>
        <div className="brand-name">Cursus</div>
      </div>

      <div className="nav">
        {navItems.map(({ id, label, Icon }) => (
          <button
            key={id}
            className="nav-item"
            data-active={activeNav === id}
            onClick={() => onNav(id)}
            type="button"
          >
            <Icon /> {label}
          </button>
        ))}
      </div>

      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 8px 4px",
          }}
        >
          <span
            className="nav-section-label"
            style={{ padding: 0, margin: 0 }}
          >
            Courses
          </span>
          <button
            type="button"
            onClick={() => onNav("courses")}
            title="Manage all courses"
            style={{
              background: "transparent",
              border: "none",
              color: activeNav === "courses" ? "var(--accent)" : "var(--ink-3)",
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.02em",
              cursor: "pointer",
              padding: "2px 6px",
              borderRadius: "var(--r-sm)",
            }}
          >
            Manage
          </button>
        </div>
        <div className="courses-list">
          {takingCourses.map((c, i) => (
            <CourseChip
              key={c.course.id}
              color={courseColor(c.course.id, i)}
              name={c.course.name}
              code={c.course.code}
              canvasCourseId={c.course.canvas_course_id}
              status="taking"
              active={activeCourseId === c.course.id}
              onSelect={() => onCourseSelect(c.course.id)}
              onStatusChange={onCourseStatusChange}
            />
          ))}
          {takingCourses.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--ink-3)", padding: "6px 8px" }}>
              No active courses — open Manage to add one.
            </div>
          )}
        </div>

        {takenCourses.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <button
              type="button"
              onClick={() => setShowTaken((v) => !v)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "transparent",
                border: "none",
                color: "var(--ink-3)",
                padding: "6px 8px",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: "pointer",
                borderRadius: "var(--r-sm)",
              }}
            >
              <span>Taken ({takenCourses.length})</span>
              <span
                style={{
                  fontSize: 10,
                  transform: showTaken ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform var(--fast)",
                  display: "inline-block",
                }}
              >
                ▸
              </span>
            </button>
            {showTaken && (
              <div className="courses-list" style={{ marginTop: 2 }}>
                {takenCourses.map((c, i) => (
                  <CourseChip
                    key={c.course.id}
                    color={courseColor(c.course.id, i + takingCourses.length)}
                    name={c.course.name}
                    code={c.course.code}
                    canvasCourseId={c.course.canvas_course_id}
                    status="taken"
                    active={activeCourseId === c.course.id}
                    onSelect={() => onCourseSelect(c.course.id)}
                    onStatusChange={onCourseStatusChange}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="side-foot">
        <div className="avatar">{initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="name" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {userEmail ?? "—"}
          </div>
          <div className="sub">
            <Link to="/settings" style={{ color: "inherit", textDecoration: "none" }}>
              Settings ·
            </Link>{" "}
            EUR
          </div>
        </div>
      </div>
    </aside>
  );
}

interface ChipProps {
  color: string;
  name: string;
  code: string | null;
  canvasCourseId: number;
  status: CourseStatus;
  active: boolean;
  onSelect: () => void;
  onStatusChange?: (canvasCourseId: number, status: CourseStatus) => void;
}

function CourseChip({
  color,
  name,
  code,
  canvasCourseId,
  status,
  active,
  onSelect,
  onStatusChange,
}: ChipProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menuOpen]);

  const change = (next: CourseStatus) => {
    setMenuOpen(false);
    onStatusChange?.(canvasCourseId, next);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        className="course-chip"
        data-active={active}
        onClick={onSelect}
        type="button"
        style={{
          width: "100%",
          alignItems: "flex-start",
          padding: "8px 10px",
        }}
      >
        <span
          className="dot"
          style={{ background: color, marginTop: 5, flexShrink: 0 }}
        />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: 1,
            textAlign: "left",
            opacity: status === "taken" ? 0.7 : 1,
          }}
        >
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 500,
              color: active ? "var(--ink)" : "var(--ink-2)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              display: "block",
            }}
          >
            {name}
          </span>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 10.5,
              color: "var(--ink-3)",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.02em",
            }}
          >
            {code && (
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {code}
              </span>
            )}
            {status === "taken" && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--ink-3)",
                }}
              >
                · taken
              </span>
            )}
          </span>
        </span>
        {onStatusChange && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Course options"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              marginLeft: 4,
              borderRadius: 6,
              color: "var(--ink-3)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <IconEllipsis width={12} height={12} />
          </span>
        )}
      </button>

      {menuOpen && (
        <div
          style={{
            position: "absolute",
            right: 4,
            top: "100%",
            marginTop: 2,
            minWidth: 200,
            background: "var(--bg-elev)",
            border: "1px solid var(--hair)",
            borderRadius: "var(--r-md)",
            boxShadow: "var(--shadow-md)",
            padding: 4,
            zIndex: 30,
          }}
        >
          <MenuItem
            label="Currently taking"
            checked={status === "taking"}
            onClick={() => change("taking")}
          />
          <MenuItem
            label="Already taken"
            checked={status === "taken"}
            onClick={() => change("taken")}
            hint="keeps chat access, skips re-sync"
          />
          <MenuItem
            label="Hide from sidebar"
            checked={status === "hidden"}
            onClick={() => change("hidden")}
            hint="skips all sync + indexing"
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  label,
  checked,
  onClick,
  hint,
}: {
  label: string;
  checked: boolean;
  onClick: () => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "6px 10px",
        border: "none",
        background: checked ? "var(--accent-soft)" : "transparent",
        color: checked ? "var(--accent)" : "var(--ink)",
        borderRadius: "var(--r-sm)",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: checked ? 600 : 500,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>{label}</span>
        {checked && <span style={{ fontSize: 11 }}>✓</span>}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2, fontWeight: 400 }}>
          {hint}
        </div>
      )}
    </button>
  );
}

export { courseColor };
