import { Link, useLocation } from "react-router-dom";
import type { CourseDeadlines } from "../../api/types";
import {
  IconHome,
  IconChat,
  IconPlan,
  IconLibrary,
} from "../../design/icons";

export type NavKey = "home" | "chat" | "plan" | "library";

interface Props {
  activeNav: NavKey;
  onNav: (n: NavKey) => void;
  courses: CourseDeadlines[];
  activeCourseId: string | null;
  onCourseSelect: (id: string) => void;
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
  activeCourseId,
  onCourseSelect,
  userEmail,
}: Props) {
  const navItems: { id: NavKey; label: string; Icon: (p: any) => JSX.Element }[] = [
    { id: "home", label: "Home", Icon: IconHome },
    { id: "chat", label: "Ask Cursus", Icon: IconChat },
    { id: "plan", label: "Study plan", Icon: IconPlan },
    { id: "library", label: "Library", Icon: IconLibrary },
  ];
  const initials = initialsFrom(userEmail);
  const location = useLocation();
  void location; // present for future deep-link support

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
          {courses.map((c, i) => (
            <button
              key={c.course.id}
              className="course-chip"
              data-active={activeCourseId === c.course.id}
              onClick={() => onCourseSelect(c.course.id)}
              type="button"
            >
              <span className="dot" style={{ background: courseColor(c.course.id, i) }} />
              <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis" }}>
                {c.course.name}
              </span>
              {c.course.code && <span className="code">{c.course.code}</span>}
            </button>
          ))}
          {courses.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--ink-3)", padding: "6px 8px" }}>
              No active courses
            </div>
          )}
        </div>
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

export { courseColor };
