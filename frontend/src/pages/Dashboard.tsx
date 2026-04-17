import { useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useDeadlines, useSync } from "../api/queries";
import CourseSection from "../components/CourseSection";
import Logo from "../components/Logo";
import { ApiError } from "../api/client";

function lastSynced(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useDeadlines();
  const sync = useSync();

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      navigate("/login", { replace: true });
    }
  }, [error, navigate]);

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

  return (
    <div className="min-h-screen">
      <header className="border-b border-oat sticky top-0 z-10 bg-cream/95 backdrop-blur">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
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

      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-10">
          <span className="label-caps text-warmcharcoal">Upcoming</span>
          <h1 className="text-display-2 mt-2">
            {totalPending === 0 ? "Clear decks." : `${totalPending} pending.`}
          </h1>
          <p className="mt-2 text-warmcharcoal font-mono text-sm">
            {courses.length} active course{courses.length === 1 ? "" : "s"}
            {" · last synced "}{lastSynced(data.last_synced_at)}
            {" · Europe/Amsterdam"}
          </p>
        </div>

        {courses.length === 0 ? (
          <div className="rounded-feature border border-oat border-dashed bg-white p-10 text-center">
            <span className="label-caps text-matcha-600">Nothing to show</span>
            <p className="mt-3 text-card">All caught up across every course.</p>
            <p className="mt-2 text-warmcharcoal text-sm">
              Past-semester items are hidden. Submitted assignments show greyed-out within each course.
              Hit Refresh if you think Canvas has new deadlines.
            </p>
          </div>
        ) : (
          courses.map((entry) => (
            <CourseSection key={entry.course.id} entry={entry} />
          ))
        )}
      </main>
    </div>
  );
}
