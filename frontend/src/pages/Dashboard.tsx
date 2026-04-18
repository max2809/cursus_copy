import { useEffect, useMemo } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useDeadlines, useSync } from "../api/queries";
import BucketRow, { BUCKET_CONFIG } from "../components/BucketRow";
import CourseTabs from "../components/CourseTabs";
import { CourseSubTabs, type SubTabKey } from "../components/CourseSubTabs";
import Logo from "../components/Logo";
import { ApiError } from "../api/client";
import { isChatFeatureEnabled } from "../lib/featureFlags";
import { ChatTab } from "../components/chat/ChatTab";
import { MaterialsTab } from "../components/materials/MaterialsTab";
import type { BucketKey, CourseDeadlines, Deadline, DeadlineCourse } from "../api/types";

function lastSynced(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function emptyBuckets(): Record<BucketKey, Deadline[]> {
  return {
    overdue: [], today: [], this_week: [],
    next_two_weeks: [], later: [], no_due_date: [],
  };
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCourseId = searchParams.get("course");
  const chatEnabled = isChatFeatureEnabled();
  const view: SubTabKey = (searchParams.get("view") as SubTabKey) || "deadlines";
  const { data, isLoading, error, refetch } = useDeadlines();
  const sync = useSync();

  function setView(next: SubTabKey) {
    const sp = new URLSearchParams(searchParams);
    sp.set("view", next);
    setSearchParams(sp);
  }

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      navigate("/login", { replace: true });
    }
  }, [error, navigate]);

  // Build "All" view aggregate and a deadline->course lookup.
  const { allBuckets, courseByDeadline } = useMemo(() => {
    const buckets = emptyBuckets();
    const map = new Map<string, DeadlineCourse>();
    if (!data) return { allBuckets: buckets, courseByDeadline: map };
    for (const entry of data.courses) {
      for (const key of Object.keys(buckets) as BucketKey[]) {
        for (const d of entry.buckets[key]) {
          buckets[key].push(d);
          map.set(d.id, entry.course);
        }
      }
    }
    // Within each bucket, sort by due_at ascending (nulls last).
    for (const key of Object.keys(buckets) as BucketKey[]) {
      buckets[key].sort((a, b) => {
        if (!a.due_at && !b.due_at) return 0;
        if (!a.due_at) return 1;
        if (!b.due_at) return -1;
        return a.due_at.localeCompare(b.due_at);
      });
    }
    return { allBuckets: buckets, courseByDeadline: map };
  }, [data]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <span className="label-caps text-warmcharcoal">Loading</span>
          <p className="mt-2 font-mono text-sm text-warmsilver">Fetching your deadlines…</p>
        </div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="rounded-feature border border-oat bg-white shadow-clay p-8 max-w-md text-center">
          <span className="label-caps text-pomegranate-400">Failed to load</span>
          <p className="mt-3 text-warmcharcoal">{String(error)}</p>
          <button onClick={() => refetch()} className="btn-clay mt-6">Try again</button>
        </div>
      </div>
    );
  }

  const courses = data.courses;
  const totalPending = courses.reduce((n, c) => n + c.pending_count, 0);
  const activeCourse: CourseDeadlines | null =
    activeCourseId ? courses.find((c) => c.course.id === activeCourseId) ?? null : null;

  // If the query param points at a course that no longer exists, fall back to All.
  const showAll = !activeCourse;

  const onTabChange = (courseId: string | null) => {
    if (courseId === null) setSearchParams({});
    else setSearchParams({ course: courseId });
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-oat sticky top-0 z-10 bg-cream/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Logo />
          <nav className="flex items-center gap-2">
            <button
              onClick={async () => { await sync.mutateAsync(); await refetch(); }}
              disabled={sync.isPending}
              className="btn-clay-ghost disabled:opacity-60"
            >
              {sync.isPending ? "Syncing…" : "Refresh"}
            </button>
            <Link to="/settings" className="btn-clay-ghost">Settings</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-6">
          <span className="label-caps text-warmcharcoal">
            {showAll ? "Upcoming" : (activeCourse?.course.code ?? "Course")}
          </span>
          <h1 className="text-display-2 mt-2">
            {showAll
              ? (totalPending === 0 ? "Clear decks." : `${totalPending} pending.`)
              : activeCourse?.course.name}
          </h1>
          <p className="mt-2 text-warmcharcoal font-mono text-sm">
            {showAll
              ? `${courses.length} active course${courses.length === 1 ? "" : "s"} · last synced ${lastSynced(data.last_synced_at)}`
              : `${activeCourse?.pending_count ?? 0} pending in this course · last synced ${lastSynced(data.last_synced_at)}`}
          </p>
        </div>

        <CourseTabs
          courses={courses}
          activeCourseId={activeCourse ? activeCourse.course.id : null}
          totalPending={totalPending}
          onChange={onTabChange}
        />

        {activeCourseId && chatEnabled && (
          <CourseSubTabs active={view} onChange={setView} chatEnabled={chatEnabled} />
        )}

        {view === "deadlines" && (
          courses.length === 0 ? (
            <div className="rounded-feature border border-oat border-dashed bg-white p-10 text-center">
              <span className="label-caps text-matcha-600">Nothing to show</span>
              <p className="mt-3 text-card">All caught up across every course.</p>
              <p className="mt-2 text-warmcharcoal text-sm">
                Past-semester items are hidden. Submitted assignments show greyed-out within each course.
                Hit Refresh if you think Canvas has new deadlines.
              </p>
            </div>
          ) : showAll ? (
            BUCKET_CONFIG.map(({ key, label, accent }) => (
              <BucketRow
                key={key}
                label={label}
                accent={accent}
                items={allBuckets[key]}
                getCourseCode={(d) => courseByDeadline.get(d.id)?.code ?? null}
              />
            ))
          ) : (
            BUCKET_CONFIG.map(({ key, label, accent }) => (
              <BucketRow
                key={key}
                label={label}
                accent={accent}
                items={activeCourse!.buckets[key]}
              />
            ))
          )
        )}

        {view === "chat" && activeCourse && (
          <ChatTab
            canvasCourseId={activeCourse.course.canvas_course_id}
            courseName={activeCourse.course.name}
          />
        )}

        {view === "materials" && activeCourse && (
          <MaterialsTab
            canvasCourseId={activeCourse.course.canvas_course_id}
            courseName={activeCourse.course.name}
          />
        )}
      </main>
    </div>
  );
}
