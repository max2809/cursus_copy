import DeadlineItem from "./DeadlineItem";
import type { BucketKey, Deadline } from "../api/types";

export interface BucketConfigEntry {
  key: BucketKey;
  label: string;
  accent: string;
}

export const BUCKET_CONFIG: BucketConfigEntry[] = [
  { key: "overdue",        label: "Overdue",        accent: "bg-pomegranate-400 text-white" },
  { key: "today",          label: "Today",          accent: "bg-lemon-400 text-black" },
  { key: "this_week",      label: "This week",      accent: "bg-slushie-500 text-black" },
  { key: "next_two_weeks", label: "Next 2 weeks",   accent: "bg-ube-300 text-black" },
  { key: "later",          label: "Later",          accent: "bg-matcha-300 text-black" },
  { key: "no_due_date",    label: "No due date",    accent: "bg-oat-light text-warmcharcoal" },
];

interface Props {
  label: string;
  accent: string;
  items: Deadline[];
  getCourseCode?: (d: Deadline) => string | null | undefined;
}

export default function BucketRow({ label, accent, items, getCourseCode }: Props) {
  if (items.length === 0) return null;
  return (
    <div className="mb-6 last:mb-0">
      <div className="flex items-center gap-3 mb-3">
        <span className={`inline-flex items-center rounded-pill px-3 py-[3px] text-label ${accent}`}>
          {label}
        </span>
        <span className="font-mono text-xs text-warmsilver">{items.length}</span>
      </div>
      <div className="space-y-2">
        {items.map((d) => (
          <DeadlineItem key={d.id} d={d} courseCode={getCourseCode?.(d) ?? null} />
        ))}
      </div>
    </div>
  );
}
