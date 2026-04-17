import { formatDue, relativeTo } from "../lib/dates";
import type { Deadline } from "../api/types";

const typeLabel: Record<string, string> = {
  assignment: "Assignment",
  quiz: "Quiz",
  exam: "Exam",
  event: "Event",
  other: "Item",
};

export default function DeadlineItem({ d }: { d: Deadline }) {
  return (
    <a
      href={d.url}
      target="_blank"
      rel="noreferrer"
      className="block card-clay hover:shadow-clay-hover transition-all duration-200 ease-clay"
      style={{ transitionProperty: "box-shadow, transform" }}
      onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-2px) rotate(-0.5deg)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "")}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="label-caps mb-1 text-warmcharcoal">
            {d.course?.code ?? d.course?.name ?? "Uncategorised"} · {typeLabel[d.type] ?? "Item"}
          </div>
          <div className="text-feature truncate">{d.title}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-sm text-warmcharcoal">{formatDue(d.due_at)}</div>
          {d.due_at && <div className="text-xs text-warmsilver mt-0.5">{relativeTo(d.due_at)}</div>}
        </div>
      </div>
    </a>
  );
}
