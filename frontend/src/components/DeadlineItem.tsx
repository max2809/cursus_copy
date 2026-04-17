import { formatDue, relativeTo } from "../lib/dates";
import type { Deadline } from "../api/types";

const typeLabel: Record<string, string> = {
  assignment: "Assignment",
  quiz: "Quiz",
  exam: "Exam",
  event: "Event",
  other: "Item",
};

interface Props {
  d: Deadline;
  courseCode?: string | null;
}

export default function DeadlineItem({ d, courseCode }: Props) {
  const submitted = d.submitted === true;
  return (
    <a
      href={d.url}
      target="_blank"
      rel="noreferrer"
      className={`block rounded-card border border-oat bg-white px-4 py-3 shadow-clay transition-all duration-200 ease-clay hover:shadow-clay-hover ${
        submitted ? "opacity-60" : ""
      }`}
      style={{ transitionProperty: "box-shadow, transform, opacity" }}
      onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-1px) rotate(-0.4deg)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "")}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="label-caps mb-1 text-warmcharcoal flex items-center gap-2 flex-wrap">
            {courseCode && (
              <span className="inline-flex items-center rounded-sharp bg-cream border border-oat px-1.5 py-[1px] font-mono text-[10px] text-black normal-case tracking-normal">
                {courseCode}
              </span>
            )}
            <span>{typeLabel[d.type] ?? "Item"}</span>
            {submitted && (
              <span className="inline-flex items-center rounded-pill bg-matcha-300 px-2 py-[1px] text-[10px] text-black normal-case tracking-normal">
                Submitted
              </span>
            )}
          </div>
          <div className={`text-feature truncate ${submitted ? "line-through decoration-warmsilver/60" : ""}`}>
            {d.title}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-sm text-warmcharcoal">{formatDue(d.due_at)}</div>
          {d.due_at && <div className="text-xs text-warmsilver mt-0.5">{relativeTo(d.due_at)}</div>}
        </div>
      </div>
    </a>
  );
}
