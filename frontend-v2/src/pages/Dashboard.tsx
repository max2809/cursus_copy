import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { useCourses, useDeadlines, useSync, useUpdateCourseStatus } from "../api/queries";
import { ChatPane } from "../components/chat-v2/ChatPane";
import { CoursePane } from "../components/home/CoursePane";
import { MobileNav } from "../components/shell/MobileNav";
import { Sidebar, type NavKey } from "../components/shell/Sidebar";
import { IconMax, IconRefresh, IconSearch } from "../design/icons";
import { PlanView } from "./PlanView";
import { LibraryView } from "./LibraryView";

function getUserEmail(): string | undefined {
  try {
    return localStorage.getItem("cursus_email") ?? undefined;
  } catch {
    return undefined;
  }
}

function initialsOf(email?: string): string {
  if (!email) return "You";
  const name = email.split("@")[0];
  const parts = name.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const navParam = (params.get("nav") as NavKey | null) ?? "home";
  const courseParam = params.get("course");
  const { data, isLoading, error, refetch } = useDeadlines();
  const sync = useSync();
  const courseList = useCourses();
  const updateStatus = useUpdateCourseStatus();
  const [email] = useState<string | undefined>(getUserEmail());
  const [chatWidth, setChatWidth] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("cursus_chat_width"));
      return Number.isFinite(v) && v >= 280 && v <= 900 ? v : 380;
    } catch { return 380; }
  });
  const [chatHidden, setChatHidden] = useState<boolean>(() => {
    try { return localStorage.getItem("cursus_chat_hidden") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("cursus_chat_width", String(chatWidth)); } catch { /* ignore */ }
  }, [chatWidth]);
  useEffect(() => {
    try { localStorage.setItem("cursus_chat_hidden", chatHidden ? "1" : "0"); } catch { /* ignore */ }
  }, [chatHidden]);

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      navigate("/login", { replace: true });
    }
  }, [error, navigate]);

  const courses = data?.courses ?? [];
  const activeCourse = useMemo(() => {
    if (!courseParam) return courses[0] ?? null;
    return courses.find((c) => c.course.id === courseParam) ?? courses[0] ?? null;
  }, [courses, courseParam]);
  const activeCourseId = activeCourse?.course.id ?? null;
  const activeCourseIndex = useMemo(
    () => (activeCourse ? courses.findIndex((c) => c.course.id === activeCourse.course.id) : 0),
    [activeCourse, courses]
  );

  function setNav(n: NavKey) {
    const sp = new URLSearchParams(params);
    sp.set("nav", n);
    setParams(sp);
  }

  function setCourse(id: string) {
    const sp = new URLSearchParams(params);
    sp.set("course", id);
    sp.set("nav", "home");
    setParams(sp);
  }

  if (isLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          color: "var(--ink-3)",
          fontFamily: "var(--font-mono)",
          fontSize: 13,
        }}
      >
        Loading…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          color: "var(--ink)",
          padding: "var(--pad-4)",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 380 }}>
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 42,
              fontStyle: "italic",
              marginBottom: 8,
            }}
          >
            Something went wrong
          </div>
          <div style={{ color: "var(--ink-3)", marginBottom: 20 }}>{String(error)}</div>
          <button className="send-btn" onClick={() => refetch()} type="button">
            Try again
          </button>
        </div>
      </div>
    );
  }

  const userInitials = initialsOf(email);
  const isSyncing = !!data.syncing || !data.last_synced_at;

  const topbar = (
    <div className="topbar">
      <div className="crumbs">
        <span>Cursus</span>
        <span className="crumb-sep">/</span>
        <span className="cur">
          {navParam === "home" && activeCourse
            ? activeCourse.course.name
            : navParam === "chat"
              ? "Ask Cursus"
              : navParam === "plan"
                ? "Study plan"
                : "Library"}
        </span>
      </div>
      <div className="spacer" />
      <button
        className="iconbtn"
        title="Sync Canvas"
        onClick={async () => {
          await sync.mutateAsync();
          await refetch();
        }}
        disabled={sync.isPending}
        type="button"
      >
        <IconRefresh />
      </button>
      <button className="search" disabled title="Search — coming soon" type="button">
        <IconSearch /> Search materials, chats…
        <kbd>⌘K</kbd>
      </button>
      {activeCourse && (
        <button
          className="iconbtn"
          title={navParam === "chat" ? "Back to course" : "Maximize chat"}
          onClick={() => setNav(navParam === "chat" ? "home" : "chat")}
          type="button"
        >
          <IconMax />
        </button>
      )}
    </div>
  );

  const content = (() => {
    if (navParam === "plan") return <PlanView courses={courses} />;
    if (navParam === "library") return <LibraryView courses={courses} />;

    if (navParam === "chat") {
      if (!activeCourse) return <NoCourse />;
      return (
        <div className="workspace chat-maximized" style={{ gridTemplateColumns: "1fr" }}>
          <ChatPane
            canvasCourseId={activeCourse.course.canvas_course_id}
            courseName={activeCourse.course.name}
            userInitials={userInitials}
          />
        </div>
      );
    }

    if (!activeCourse) return <NoCourse />;
    const clampedWidth = Math.max(280, Math.min(900, chatWidth));
    const gridCols = chatHidden
      ? "1fr"
      : `1fr 4px ${clampedWidth}px`;
    return (
      <div className="workspace" style={{ gridTemplateColumns: gridCols, position: "relative" }}>
        <CoursePane
          course={activeCourse}
          courseIndex={activeCourseIndex}
          onMaximize={() => setNav("chat")}
        />
        {!chatHidden && (
          <Resizer
            onDrag={(deltaX) =>
              setChatWidth((w) => Math.max(280, Math.min(900, w - deltaX)))
            }
          />
        )}
        {!chatHidden && (
          <ChatPane
            canvasCourseId={activeCourse.course.canvas_course_id}
            courseName={activeCourse.course.name}
            onCollapse={() => setChatHidden(true)}
            userInitials={userInitials}
          />
        )}
        {chatHidden && (
          <button
            type="button"
            onClick={() => setChatHidden(false)}
            title="Show chat"
            style={{
              position: "absolute",
              right: 16,
              bottom: 16,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              background: "var(--accent)",
              color: "var(--accent-ink)",
              border: "none",
              borderRadius: "var(--r-pill)",
              fontSize: 13,
              fontWeight: 600,
              boxShadow: "var(--shadow-md)",
              cursor: "pointer",
              zIndex: 5,
            }}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5A1.5 1.5 0 0 1 11.5 11H7l-3 2.5V11A1.5 1.5 0 0 1 3 9.5v-5Z" />
            </svg>
            Show chat
          </button>
        )}
      </div>
    );
  })();

  return (
    <div className="app">
      <Sidebar
        activeNav={navParam}
        onNav={setNav}
        courses={courses}
        allCourses={courseList.data}
        activeCourseId={activeCourseId}
        onCourseSelect={setCourse}
        onCourseStatusChange={(canvasCourseId, status) =>
          updateStatus.mutate({ canvasCourseId, status })
        }
        userEmail={email}
      />
      <div className="main">
        {topbar}
        {isSyncing && <SyncingBanner courseCount={courses.length} />}
        <div className="content">{content}</div>
        <MobileNav active={navParam} onNav={setNav} />
      </div>
    </div>
  );
}

function SyncingBanner({ courseCount }: { courseCount: number }) {
  const label =
    courseCount === 0
      ? "Syncing your courses from Canvas…"
      : `Syncing your courses from Canvas… ${courseCount} loaded so far`;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px var(--pad-4)",
        background: "var(--accent-soft)",
        color: "var(--accent)",
        borderBottom: "1px solid var(--hair)",
        fontSize: 13,
        fontWeight: 500,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: "var(--accent)",
          boxShadow: "0 0 0 0 currentColor",
          animation: "sync-pulse 1.4s ease-in-out infinite",
        }}
      />
      <span>{label}</span>
      <style>{`
        @keyframes sync-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.35; transform: scale(0.72); }
        }
      `}</style>
    </div>
  );
}

function Resizer({ onDrag }: { onDrag: (deltaX: number) => void }) {
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false);
  const lastX = useRef(0);

  useEffect(() => {
    if (!active) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - lastX.current;
      lastX.current = e.clientX;
      if (dx !== 0) onDrag(dx);
    };
    const onUp = () => setActive(false);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [active, onDrag]);

  return (
    <div
      onMouseDown={(e) => {
        e.preventDefault();
        lastX.current = e.clientX;
        setActive(true);
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        cursor: "col-resize",
        background: hover || active ? "var(--accent)" : "var(--hair)",
        width: 4,
        transition: "background var(--fast)",
        userSelect: "none",
      }}
      role="separator"
      aria-orientation="vertical"
    />
  );
}

function NoCourse() {
  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        height: "100%",
        padding: "var(--pad-6)",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 420 }}>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 42,
            fontStyle: "italic",
            marginBottom: 12,
            letterSpacing: "-0.02em",
          }}
        >
          No active courses
        </div>
        <div style={{ color: "var(--ink-3)", marginBottom: 16 }}>
          Hit refresh to sync with Canvas, or check that your account has courses with upcoming work.
        </div>
      </div>
    </div>
  );
}
