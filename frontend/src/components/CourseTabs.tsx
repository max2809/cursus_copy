import type { CourseDeadlines } from "../api/types";

interface Props {
  courses: CourseDeadlines[];
  activeCourseId: string | null;
  totalPending: number;
  onChange: (courseId: string | null) => void;
}

interface TabButtonProps {
  active: boolean;
  label: string;
  count: number;
  muted?: boolean;
  onClick: () => void;
}

function TabButton({ active, label, count, muted, onClick }: TabButtonProps) {
  const base =
    "shrink-0 inline-flex items-center gap-2 rounded-pill px-4 py-1.5 text-sm font-medium " +
    "transition-all duration-150 ease-clay border";
  const style = active
    ? "bg-black text-white border-black"
    : `bg-white text-black border-oat hover:shadow-clay-hover ${muted ? "opacity-60" : ""}`;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} ${style}`}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.transform = "translateY(-1px) rotate(-0.5deg)";
      }}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "")}
    >
      <span>{label}</span>
      {count > 0 && (
        <span
          className={`font-mono text-xs ${
            active ? "text-white/80" : "text-warmcharcoal"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export default function CourseTabs({ courses, activeCourseId, totalPending, onChange }: Props) {
  return (
    <div className="sticky top-[73px] z-[5] -mx-6 px-6 py-3 bg-cream/95 backdrop-blur border-b border-oat mb-8">
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        <TabButton
          active={activeCourseId === null}
          label="All"
          count={totalPending}
          onClick={() => onChange(null)}
        />
        {courses.map((entry) => (
          <TabButton
            key={entry.course.id}
            active={activeCourseId === entry.course.id}
            label={entry.course.code ?? entry.course.name}
            count={entry.pending_count}
            muted={entry.pending_count === 0}
            onClick={() => onChange(entry.course.id)}
          />
        ))}
      </div>
    </div>
  );
}
