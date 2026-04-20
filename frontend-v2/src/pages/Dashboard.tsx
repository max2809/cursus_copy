import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { useDeadlines, useSync } from "../api/queries";
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
  const [email] = useState<string | undefined>(getUserEmail());

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
            maximized
            onMaximize={() => setNav("home")}
            userInitials={userInitials}
          />
        </div>
      );
    }

    if (!activeCourse) return <NoCourse />;
    return (
      <div className="workspace">
        <CoursePane
          course={activeCourse}
          courseIndex={activeCourseIndex}
          onMaximize={() => setNav("chat")}
        />
        <ChatPane
          canvasCourseId={activeCourse.course.canvas_course_id}
          courseName={activeCourse.course.name}
          onMaximize={() => setNav("chat")}
          userInitials={userInitials}
        />
      </div>
    );
  })();

  return (
    <div className="app">
      <Sidebar
        activeNav={navParam}
        onNav={setNav}
        courses={courses}
        activeCourseId={activeCourseId}
        onCourseSelect={setCourse}
        userEmail={email}
      />
      <div className="main">
        {topbar}
        <div className="content">{content}</div>
        <MobileNav active={navParam} onNav={setNav} />
      </div>
    </div>
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
