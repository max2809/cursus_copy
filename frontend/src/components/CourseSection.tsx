import DeadlineItem from "./DeadlineItem";
import type { BucketKey, CourseDeadlines, Deadline } from "../api/types";

const BUCKET_CONFIG: Array<{
  key: BucketKey;
  label: string;
  accent: string;
}> = [
  { key: "overdue",        label: "Overdue",        accent: "bg-pomegranate-400 text-white" },
  { key: "today",          label: "Today",          accent: "bg-lemon-400 text-black" },
  { key: "this_week",      label: "This week",      accent: "bg-slushie-500 text-black" },
  { key: "next_two_weeks", label: "Next 2 weeks",   accent: "bg-ube-300 text-black" },
  { key: "later",          label: "Later",          accent: "bg-matcha-300 text-black" },
  { key: "no_due_date",    label: "No due date",    accent: "bg-oat-light text-warmcharcoal" },
];

function BucketRow({ label, accent, items }: { label: string; accent: string; items: Deadline[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-4 last:mb-0">
      <div className="flex items-center gap-3 mb-2">
        <span className={`inline-flex items-center rounded-pill px-3 py-[3px] text-label ${accent}`}>
          {label}
        </span>
        <span className="font-mono text-xs text-warmsilver">{items.length}</span>
      </div>
      <div className="space-y-2">
        {items.map((d) => <DeadlineItem key={d.id} d={d} />)}
      </div>
    </div>
  );
}

export default function CourseSection({ entry }: { entry: CourseDeadlines }) {
  const { course, buckets, pending_count } = entry;
  const totalCount = Object.values(buckets).reduce((n, arr) => n + arr.length, 0);
  const isDone = pending_count === 0 && totalCount > 0;

  return (
    <section className={`mb-8 rounded-feature border border-oat bg-white p-6 ${isDone ? "opacity-70" : ""}`}>
      <header className="flex items-baseline justify-between gap-4 mb-5 pb-4 border-b border-oat">
        <div className="min-w-0">
          <span className="label-caps text-warmcharcoal">
            {course.code ?? "Course"}
          </span>
          <h2 className="text-card mt-1 truncate">{course.name}</h2>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-sm">
            {pending_count > 0 ? (
              <span className="text-black">{pending_count} pending</span>
            ) : (
              <span className="text-matcha-600">All caught up</span>
            )}
          </div>
          <div className="font-mono text-xs text-warmsilver mt-0.5">
            {totalCount} total
          </div>
        </div>
      </header>

      {BUCKET_CONFIG.map(({ key, label, accent }) => (
        <BucketRow key={key} label={label} accent={accent} items={buckets[key]} />
      ))}
    </section>
  );
}
