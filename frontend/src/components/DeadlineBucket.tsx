import DeadlineItem from "./DeadlineItem";
import type { Deadline } from "../api/types";

interface Props {
  label: string;
  items: Deadline[];
  tone?: "neutral" | "urgent" | "today" | "week" | "later" | "muted";
}

const toneStyles: Record<NonNullable<Props["tone"]>, string> = {
  neutral: "bg-white border-oat",
  urgent: "bg-pomegranate-400 border-pomegranate-400 text-white",
  today: "bg-lemon-400 border-lemon-500",
  week: "bg-slushie-500 border-slushie-500",
  later: "bg-matcha-300 border-matcha-300",
  muted: "bg-oat-light border-oat",
};

export default function DeadlineBucket({ label, items, tone = "neutral" }: Props) {
  if (items.length === 0) return null;
  const badgeStyle = toneStyles[tone];
  return (
    <section className="mb-8">
      <div className="flex items-center gap-3 mb-4">
        <span className={`inline-flex items-center rounded-pill px-3 py-1 text-label border ${badgeStyle}`}>
          {label}
        </span>
        <span className="font-mono text-xs text-warmsilver">{items.length}</span>
      </div>
      <div className="space-y-3">
        {items.map((d) => <DeadlineItem key={d.id} d={d} />)}
      </div>
    </section>
  );
}
