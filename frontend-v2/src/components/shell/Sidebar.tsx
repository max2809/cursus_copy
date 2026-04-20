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

export type NavKey = "home" | "chat" | "plan" | "library";

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

  const hidden = useMemo(
    () => (allCourses ?? []).filter((c) => c.status === "hidden"),
    [allCourses],
  );
  const [showHidden, setShowHidden] = useState(false);

  // Map from course.id → status for visible list (taking vs taken visual)
  const statusById = useMemo(() => {
    const m = new Map<number, CourseStatus>();
    (allCourses ?? []).forEach((c) => m.set(c.canvas_course_id, c.status));
    return m;
  }, [allCourses]);

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
        <div className="nav-section-label">Courses</div>
        <div className="courses-list">
          {courses.map((c, i) => {
            const status = statusById.get(c.course.canvas_course_id) ?? "taking";
            return (
              <CourseChip
                key={c.course.id}
                color={courseColor(c.course.id, i)}
                name={c.course.name}
                code={c.course.code}
                canvasCourseId={c.course.canvas_course_id}
                status={status}
                active={activeCourseId === c.course.id}
                onSelect={() => onCourseSelect(c.course.id)}
                onStatusChange={onCourseStatusChange}
              />
            );
          })}
          {courses.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--ink-3)", padding: "6px 8px" }}>
              No active courses
            </div>
          )}
        </div>

        {hidden.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setShowHidden((v) => !v)}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                color: "var(--ink-3)",
                padding: "6px 8px",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              Hidden ({hidden.length}) {showHidden ? "▾" : "▸"}
            </button>
            {showHidden && (
              <div className="courses-list" style={{ opacity: 0.7 }}>
                {hidden.map((c, i) => (
                  <CourseChip
                    key={c.id}
                    color={courseColor(c.id, i)}
                    name={c.name}
                    code={c.code}
                    canvasCourseId={c.canvas_course_id}
                    status="hidden"
                    active={false}
                    onSelect={() => {
                      // Hidden courses are click-to-nothing until unhidden.
                      onCourseStatusChange?.(c.canvas_course_id, "taking");
                    }}
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

  const statusClass = status === "taken" ? "course-chip-taken" : "";

  const change = (next: CourseStatus) => {
    setMenuOpen(false);
    onStatusChange?.(canvasCourseId, next);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        className={`course-chip ${statusClass}`}
        data-active={active}
        onClick={onSelect}
        type="button"
        style={{ width: "100%" }}
      >
        <span className="dot" style={{ background: color }} />
        <span
          style={{
            flex: 1,
            textAlign: "left",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            opacity: status === "taken" ? 0.7 : 1,
          }}
        >
          {name}
          {status === "taken" && (
            <span
              style={{
                marginLeft: 6,
                fontSize: 9,
                fontWeight: 500,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--ink-3)",
              }}
            >
              taken
            </span>
          )}
        </span>
        {code && <span className="code">{code}</span>}
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
            minWidth: 180,
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
