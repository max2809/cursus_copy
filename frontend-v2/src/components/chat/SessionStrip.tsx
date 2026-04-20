import type { SessionSummary } from "../../api/types";

interface Props {
  sessions: SessionSummary[];
  activeId: string | null;
  onPick: (id: string) => void;
  onNew: () => void;
}

export function SessionStrip({ sessions, activeId, onPick, onNew }: Props) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      <button
        type="button"
        onClick={onNew}
        className="shrink-0 px-3 py-1.5 rounded-pill border-2 border-black bg-matcha-200 text-sm font-medium"
      >
        + New chat
      </button>
      {sessions.map((s) => {
        const isActive = s.id === activeId;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s.id)}
            className={
              "shrink-0 px-3 py-1.5 rounded-pill border-2 border-black text-sm truncate max-w-[16ch] " +
              (isActive ? "bg-black text-cream" : "bg-oat-light")
            }
            title={s.title}
          >
            {s.title || "Untitled"}
          </button>
        );
      })}
    </div>
  );
}
