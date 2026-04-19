export type SubTabKey = "deadlines" | "chat" | "materials";

interface Props {
  active: SubTabKey;
  onChange: (next: SubTabKey) => void;
}

const TABS: { key: SubTabKey; label: string }[] = [
  { key: "deadlines", label: "Deadlines" },
  { key: "chat", label: "Chat" },
  { key: "materials", label: "Materials" },
];

export function CourseSubTabs({ active, onChange }: Props) {
  return (
    <div className="flex gap-2 flex-wrap mb-4">
      {TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={
              "px-4 py-1.5 rounded-pill border-2 border-black text-sm font-medium transition " +
              (isActive
                ? "bg-black text-cream shadow-clay-hover"
                : "bg-oat-light text-black hover:shadow-clay-hover")
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
